import type { SchemaObject, SchemaOrBoolean } from "@oav/core";
import { NAMES, pathJoinExpr, rawExpr, type CodeGen } from "../codegen/index.js";
import type {
  ErrorKind,
  KeywordCompileContext,
  KeywordDefinition,
  ValidateSubschemaOptions,
} from "./types.js";

/**
 * Inputs accepted by {@link createKeywordContext}. The compiler assembles
 * these from its own state — keyword authors never construct them directly.
 *
 * @public
 */
export interface KeywordContextInputs {
  gen: CodeGen;
  schema: unknown;
  parentSchema: SchemaObject;
  data: string;
  path: string;
  errors: string;
  compileSubschema: (schema: SchemaOrBoolean) => string;
  resolveRef: (ref: string) => string;
  evaluatedPropertiesVar?: string | null;
  evaluatedItemsVar?: string | null;
  /**
   * When `true`, a finite `maxErrors` was configured and push / loop
   * sites should emit the extra budget checks. When `false`, emit plain
   * `errors.push(x)` / unchecked loops — zero runtime overhead.
   */
  gated?: boolean;
  /**
   * When `true`, predicate mode is active: the generated function
   * returns `boolean`, not `ValidationError | null`. Every
   * error-emission site collapses to `return false;` and the
   * error-expression argument is discarded.
   */
  predicate?: boolean;
  /**
   * The compiler's full keyword registry. Used by
   * {@link KeywordCompileContext.validateSubschema} to inline a
   * subschema's single keyword directly instead of compiling it to a
   * fresh function. Optional: when omitted, subschema emission always
   * takes the function-call path.
   */
  byKeyword?: ReadonlyMap<string, KeywordDefinition>;
  /**
   * Depth counter for recursive multi-keyword inlining. Callers never
   * set this directly — the context threads it through
   * {@link KeywordCompileContext.validateSubschema} so deeply-nested
   * inline chains eventually fall back to the function-call path
   * rather than blowing up the compiled source.
   */
  inlineDepth?: number;
  /**
   * Callback for hoisting a schema-derived constant out of the
   * validator body to the module-level prelude. See
   * {@link KeywordCompileContext.hoistConstant}.
   */
  hoistConstant?: (expr: string, prefix?: string) => string;
}

/**
 * Construct a {@link KeywordCompileContext} from compiler-supplied inputs.
 *
 * @param inputs - Compiler state + keyword's own schema slice.
 * @returns A narrow, read-only context that keyword compile functions see.
 *
 * @example
 * ```ts
 * const ctx = createKeywordContext({ gen, schema: "number", parentSchema: ... });
 * typeKeyword.compile(ctx);
 * ```
 *
 * @public
 */
/**
 * Keywords that produce at most one error per application and have no
 * nested subschemas. When a subschema contains exactly one of these
 * keywords and nothing else that can emit errors, we can emit its
 * validation code inline in the enclosing function instead of
 * compiling it to a separate function — saving the per-call dispatch
 * cost and, more importantly, the eager `[...path, seg]` allocation
 * that function boundaries force.
 *
 * @internal
 */
const INLINEABLE_SINGLE_KEYWORDS = new Set([
  "type",
  "const",
  "enum",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "multipleOf",
  "minLength",
  "maxLength",
  "pattern",
  "format",
  "minItems",
  "maxItems",
  "uniqueItems",
  "minProperties",
  "maxProperties",
]);

/**
 * Keys that force us to the function-call path regardless of the
 * {@link KeywordDefinition.applicator} flag. These are keywords whose
 * correctness depends on per-function state that the inline path
 * cannot supply:
 *
 * - `$ref` / `$dynamicRef` need a named function for cycle handling;
 *   bringing them into the inline body would lose the compiled-for
 *   cache that breaks cycles.
 *
 * The unevaluated-keys keywords (`unevaluatedProperties`,
 * `unevaluatedItems`) also need per-function state, but they are
 * already tagged `applicator: true` so the applicator check below
 * catches them — no need to list them here.
 */
const INLINE_DISQUALIFIERS = new Set(["$ref", "$dynamicRef"]);

/**
 * Applicator-keyword names not backed by their own {@link KeywordDefinition}
 * but which the inliner must still treat as applicators. `if` owns
 * `then` / `else` via the `implements` list; a schema that mentions
 * them in isolation (without `if`) should still fall back to the
 * function-call path rather than being treated as empty.
 */
const STANDALONE_APPLICATOR_FALLBACKS = new Set(["then", "else"]);

function isApplicatorKey(
  byKeyword: ReadonlyMap<string, KeywordDefinition> | undefined,
  k: string,
): boolean {
  if (byKeyword === undefined) return false;
  if (byKeyword.get(k)?.applicator === true) return true;
  return STANDALONE_APPLICATOR_FALLBACKS.has(k);
}

/**
 * Ceiling on how deep a chain of multi-keyword inlinings we'll follow
 * before falling back to function-call compilation. Protects against
 * pathologically self-referential schemas and bounds code bloat.
 */
const MAX_INLINE_DEPTH = 6;

/**
 * Above this many non-informational keys, a subschema's contribution
 * to the caller's inline body is judged too large; compile it as a
 * function instead.
 */
const MAX_INLINE_KEYWORDS = 10;

export function createKeywordContext(inputs: KeywordContextInputs): KeywordCompileContext {
  const evaluatedPropertiesVar = inputs.evaluatedPropertiesVar ?? null;
  const evaluatedItemsVar = inputs.evaluatedItemsVar ?? null;
  const gated = inputs.gated ?? false;
  const predicate = inputs.predicate ?? false;
  // Fall back to a local-scope const when no compiler-provided hoist sink
  // is threaded in (for tests or out-of-tree callers that build a
  // context directly). In that case the "hoisted" value just lives in
  // the current validator body — correct but not optimized.
  let localHoistCounter = 0;
  const hoistConstant =
    inputs.hoistConstant ??
    ((expr: string, prefix = "C"): string => {
      const name = `${prefix}_local${localHoistCounter}`;
      localHoistCounter += 1;
      inputs.gen.const(name, expr);
      return name;
    });

  const errorStatement = (kind: ErrorKind, errExpr: string): string => {
    if (predicate) {
      // Predicate mode: we don't construct an error tree, so any
      // error-emission site just short-circuits. The `errExpr` is
      // intentionally discarded — its `ctx.path` / `createLeafError`
      // references never reach the generated source.
      void kind;
      void errExpr;
      return "return false;";
    }
    if (kind === "leaf") return emitPushStatement(inputs.errors, errExpr, gated);
    // kind === "lift": already-counted sub-validator result being
    // propagated, or a branch wrapper around already-counted children.
    // Never interacts with the budget.
    return `(${inputs.errors} ??= []).push(${errExpr});`;
  };
  const emitError = (kind: ErrorKind, errExpr: string): void => {
    inputs.gen.line(errorStatement(kind, errExpr));
  };
  const budgetBreakStatement = (): string =>
    // Predicate mode never fills an error budget; its loops short-
    // circuit with `return false;` directly. Returning `""` keeps
    // existing `emitBudgetBreak()` callers a no-op.
    predicate || !gated
      ? ""
      : `if (${NAMES.DEPS}.errorsRemaining <= 0) { ${NAMES.DEPS}.truncated = true; break; }`;
  const emitBudgetBreak = (): void => {
    const stmt = budgetBreakStatement();
    if (stmt !== "") inputs.gen.line(stmt);
  };

  // No runtime mutation — on the happy path the segment is invisible.
  // `body` receives the base path and the segment separately so error
  // constructors can pass them as distinct arguments to
  // `createLeafError` / `createBranchError` (the runtime allocates the
  // extended path array once, inside the helper, on the error path).
  // Predicate mode doesn't emit errors, so the values go unused in
  // that mode — we pass them anyway for a stable API.
  const withPathSegment = (
    segmentExpr: string,
    body: (basePath: string, segExpr: string) => void,
  ): void => {
    body(inputs.path, segmentExpr);
  };

  const inlineDepth = inputs.inlineDepth ?? 0;

  /**
   * Try to inline a subschema's keywords directly into the current
   * function body. Returns `true` iff the inline path was taken;
   * callers fall back to compiling a named function on `false`.
   *
   * Three classes of inline:
   * - Empty / pure-metadata schema → no-op.
   * - Single-keyword from the safe whitelist → one keyword's code
   *   emitted directly. Tree shape preserved (keyword emits at most
   *   one error).
   * - Multi-keyword without $ref and under the size/depth ceilings →
   *   emit every keyword's code, then (if >1 error actually fired)
   *   wrap the new errors in a "schema" branch to match the tree
   *   shape of the would-be function's `wrapErrors` return value.
   */
  const tryInline = (schema: SchemaObject, dataExpr: string, pathOverride?: string): boolean => {
    const path = pathOverride ?? inputs.path;
    if (inputs.byKeyword === undefined) return false;
    const allKeys = Object.keys(schema);
    const validationKeys: string[] = [];
    for (const k of allKeys) {
      // Annotation keywords (title, description, $comment, etc.) are
      // registered with `annotation: true` and emit no code — safe to
      // skip. Unknown keys fall through to `validationKeys` so the
      // inliner conservatively refuses to inline them, which matches
      // the old behaviour for pre-`annotation`-flag unknowns.
      if (inputs.byKeyword.get(k)?.annotation === true) continue;
      if (INLINE_DISQUALIFIERS.has(k)) return false;
      validationKeys.push(k);
    }
    if (validationKeys.length === 0) return true; // empty-ish schema — nothing to emit

    // Single-keyword: simplest case — whitelist match, no wrapping needed.
    if (validationKeys.length === 1) {
      const k = validationKeys[0]!;
      if (!INLINEABLE_SINGLE_KEYWORDS.has(k)) return false;
      const kw = inputs.byKeyword.get(k);
      if (kw === undefined) return false;
      const innerCtx = createKeywordContext({
        gen: inputs.gen,
        schema: (schema as Record<string, unknown>)[k],
        parentSchema: schema,
        data: dataExpr,
        path,
        errors: inputs.errors,
        compileSubschema: inputs.compileSubschema,
        resolveRef: inputs.resolveRef,
        evaluatedPropertiesVar: null,
        evaluatedItemsVar: null,
        gated,
        predicate,
        byKeyword: inputs.byKeyword,
        inlineDepth: inlineDepth + 1,
        hoistConstant: inputs.hoistConstant,
      });
      kw.compile(innerCtx);
      return true;
    }

    // Multi-keyword inline is limited to pure-leaf combinations
    // (type + required + bounds, etc.). Schemas that contain any
    // applicator are left to the function-call path — the per-call
    // dispatch pays for itself on hot loops because V8 monomorphises
    // the function better than it can optimise a massive inlined
    // loop body.
    if (validationKeys.some((k) => isApplicatorKey(inputs.byKeyword, k))) return false;
    if (validationKeys.length > MAX_INLINE_KEYWORDS) return false;
    if (inlineDepth >= MAX_INLINE_DEPTH) return false;

    // Snapshot the errors array length; if >1 new error fires, wrap
    // the new ones in a "schema" branch so the tree shape matches a
    // named function's `wrapErrors` output. Predicate mode skips the
    // snapshot/wrap entirely — inlined keywords return `false` on
    // failure so there's nothing to wrap.
    const startVar = predicate ? null : inputs.gen.scope.name("_start");
    // errors may be null (lazy allocation). Treat null as length-0 for
    // the snapshot; the wrap check below also guards against null.
    if (startVar !== null)
      inputs.gen.const(startVar, `${inputs.errors} === null ? 0 : ${inputs.errors}.length`);

    // Keyword ordering mirrors the compiler's top-level dispatch: run
    // validation keywords first (leaf checks) in their defined vocab
    // order, then applicators, then unevaluated — this matches what
    // `compileSchemaKeywords` does for function-compiled subschemas.
    const present = new Set(validationKeys);
    const runOrder: string[] = [];
    for (const [name] of inputs.byKeyword) {
      if (present.has(name)) runOrder.push(name);
    }

    const seen = new Set<string>();
    for (const kwName of runOrder) {
      if (seen.has(kwName)) continue;
      const kw = inputs.byKeyword.get(kwName);
      if (kw === undefined) continue;
      seen.add(kwName);
      // Skip keywords this keyword implements, as the main compile loop does.
      const kwDef = kw as { compile: (ctx: KeywordCompileContext) => void; implements?: string[] };
      if (kwDef.implements) for (const impl of kwDef.implements) seen.add(impl);
      const innerCtx = createKeywordContext({
        gen: inputs.gen,
        schema: (schema as Record<string, unknown>)[kwName],
        parentSchema: schema,
        data: dataExpr,
        path,
        errors: inputs.errors,
        compileSubschema: inputs.compileSubschema,
        resolveRef: inputs.resolveRef,
        evaluatedPropertiesVar: null,
        evaluatedItemsVar: null,
        gated,
        predicate,
        byKeyword: inputs.byKeyword,
        inlineDepth: inlineDepth + 1,
        hoistConstant: inputs.hoistConstant,
      });
      kw.compile(innerCtx);
    }

    // Wrap if >1 new error actually fired — error-tree mode only.
    // errors may still be null here if no keyword pushed anything (or
    // only the budget got exhausted without pushing); the null-check
    // short-circuits the wrap.
    if (startVar !== null) {
      const wrappedVar = inputs.gen.scope.name("_wrapped");
      inputs.gen.if(
        `${inputs.errors} !== null && ${inputs.errors}.length - ${startVar} > 1`,
        () => {
          inputs.gen.const(wrappedVar, `${inputs.errors}.splice(${startVar})`);
          inputs.gen.line(
            `${inputs.errors}.push(${NAMES.DEPS}.createBranchError(` +
              `"schema", ${path}, "schema validation failed", ${wrappedVar}));`,
          );
        },
      );
    }

    return true;
  };

  const validateSubschema = (
    schema: SchemaOrBoolean,
    dataExpr: string,
    options?: ValidateSubschemaOptions,
  ): void => {
    const segment = options?.segment;
    // Inline path uses a lazy extended-path expression — only evaluated
    // when an error actually fires. Function-call fallback keeps the
    // classic push/pop-then-call shape because the callee reads the
    // (mutated) shared array directly, avoiding a per-call array
    // allocation for the extended path.
    if (schema === true) return;
    if (schema === false) {
      if (predicate) {
        inputs.gen.line("return false;");
        return;
      }
      // Use the runtime's `extraSegment` parameter so the extended
      // path array is built once inside createLeafError rather than
      // pre-materialized at the call site and then re-snapshotted.
      const falseErr =
        segment !== undefined
          ? `${NAMES.DEPS}.createLeafError("false", ${inputs.path}, ` +
            `"schema is false, nothing is valid", {}, ${segment})`
          : `${NAMES.DEPS}.createLeafError("false", ${inputs.path}, ` +
            `"schema is false, nothing is valid")`;
      emitError("leaf", falseErr);
      return;
    }
    const inlineExtPath =
      segment !== undefined ? pathJoinExpr(inputs.path, [rawExpr(segment)]) : undefined;
    if (tryInline(schema, dataExpr, inlineExtPath)) return;
    // Function-call fallback — push/pop around the call so the callee
    // sees the extended path via the shared array (no per-call
    // allocation just to pass a path).
    const fn = inputs.compileSubschema(schema);
    if (predicate) {
      inputs.gen.line(`if (!${fn}(${dataExpr})) return false;`);
      return;
    }
    if (segment !== undefined) {
      inputs.gen.line(`${inputs.path}.push(${segment});`);
    }
    const errVar = inputs.gen.scope.name("e");
    inputs.gen.const(errVar, `${fn}(${dataExpr}, ${inputs.path})`);
    inputs.gen.if(`${errVar} !== null`, () => {
      emitError("lift", errVar);
    });
    if (segment !== undefined) {
      inputs.gen.line(`${inputs.path}.pop();`);
    }
  };

  return {
    gen: inputs.gen,
    schema: inputs.schema,
    parentSchema: inputs.parentSchema,
    data: inputs.data,
    path: inputs.path,
    errors: inputs.errors,
    compileSubschema: inputs.compileSubschema,
    resolveRef: inputs.resolveRef,
    evaluatedPropertiesVar,
    evaluatedItemsVar,
    gated,
    predicate,
    errorStatement,
    emitError,
    budgetBreakStatement,
    emitBudgetBreak,
    withPathSegment,
    validateSubschema,
    hoistConstant,
  };
}

/**
 * Build a JS statement that pushes a single {@link ValidationError}
 * expression into the errors accumulator, optionally honouring the
 * `maxErrors` budget when `gated` is `true`. Callers of this helper
 * pass it to {@link CodeGen.line} or embed it into a generated block.
 *
 * @internal
 */
export function emitPushStatement(errorsVar: string, errExpr: string, gated: boolean): string {
  if (!gated) return `(${errorsVar} ??= []).push(${errExpr});`;
  return (
    `if (${NAMES.DEPS}.errorsRemaining > 0) { (${errorsVar} ??= []).push(${errExpr}); ${NAMES.DEPS}.errorsRemaining -= 1; }` +
    ` else { ${NAMES.DEPS}.truncated = true; }`
  );
}
