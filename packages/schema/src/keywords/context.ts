import type { SchemaObject, SchemaOrBoolean } from "@oav/core";
import { NAMES, quoteString, type CodeGen } from "../codegen/index.js";
import type { EmitErrorParams, KeywordCompileContext } from "./types.js";

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
  subschema: (schema: SchemaOrBoolean) => string;
  resolveRef: (ref: string) => string;
  markPropertyEvaluated?: (nameExpr: string) => void;
  markItemEvaluated?: (indexExpr: string) => void;
  evaluatedPropertiesVar?: string | null;
  evaluatedItemsVar?: string | null;
  /**
   * When `true`, a finite `maxErrors` was configured and push / loop
   * sites should emit the extra budget checks. When `false`, emit plain
   * `errors.push(x)` / unchecked loops — zero runtime overhead.
   */
  gated?: boolean;
  /**
   * The compiler's full keyword registry. Used by
   * {@link KeywordCompileContext.emitSubschemaValidation} to inline a
   * subschema's single keyword directly instead of compiling it to a
   * fresh function. Optional: when omitted, subschema emission always
   * takes the function-call path.
   */
  byKeyword?: ReadonlyMap<string, { compile: (ctx: KeywordCompileContext) => void }>;
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
 * Schema keys that are purely informational / metadata and can coexist
 * with an inlineable keyword without disqualifying the schema.
 */
const IGNORABLE_KEYS = new Set([
  "$comment",
  "$schema",
  "title",
  "description",
  "default",
  "examples",
  "readOnly",
  "writeOnly",
  "deprecated",
]);

/**
 * Keys that force us to the function-call path.
 *
 * - `$ref` / `$dynamicRef` need a named function for cycle handling;
 *   bringing them into the inline body would lose the
 *   compiled-for cache that breaks cycles.
 * - `unevaluatedProperties` / `unevaluatedItems` require a per-function
 *   evaluated-keys / evaluated-indices Set. That set is initialised
 *   at function-body entry in the compiler; the inline path doesn't
 *   own its own function body, so the inlined keyword would run with
 *   no set to consult and silently no-op. Safer to compile as a
 *   function so the setup happens naturally.
 */
const INLINE_DISQUALIFIERS = new Set([
  "$ref",
  "$dynamicRef",
  "unevaluatedProperties",
  "unevaluatedItems",
]);

/**
 * Applicator keywords — when a multi-keyword subschema contains any of
 * these, we prefer the function-call path over inlining. Two reasons:
 *
 * 1. The function's body is then hot-called N times from a loop, which
 *    V8 monomorphises and JIT-specialises well. Inlining a long body
 *    into the loop makes the loop body too large for the same
 *    optimisations and measurably slows array-heavy workloads.
 * 2. Applicators have their own inlining logic internally (for their
 *    subschemas). We still inline those single-keyword property/item
 *    schemas under the enclosing function.
 */
const APPLICATOR_KEYS = new Set([
  "properties",
  "patternProperties",
  "additionalProperties",
  "propertyNames",
  "items",
  "prefixItems",
  "contains",
  "allOf",
  "anyOf",
  "oneOf",
  "not",
  "if",
  "then",
  "else",
  "dependentSchemas",
  "discriminator",
]);

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
  const markPropertyEvaluated =
    inputs.markPropertyEvaluated ??
    ((nameExpr: string): void => {
      if (evaluatedPropertiesVar !== null) {
        inputs.gen.line(`${evaluatedPropertiesVar}.add(${nameExpr});`);
      }
    });
  const markItemEvaluated =
    inputs.markItemEvaluated ??
    ((indexExpr: string): void => {
      if (evaluatedItemsVar !== null) {
        inputs.gen.line(`${evaluatedItemsVar}.add(${indexExpr});`);
      }
    });

  // Gated push — for freshly-minted leaf errors. Counts against the budget.
  const pushErrorStmt = (errExpr: string): string =>
    emitPushStatement(inputs.errors, errExpr, gated);
  const pushError = (errExpr: string): void => {
    inputs.gen.line(pushErrorStmt(errExpr));
  };
  // Unconditional push — for errors already counted elsewhere: sub-validator
  // results being propagated up the tree, and branch wrappers that just
  // contain already-counted children.
  const liftErrorStmt = (errExpr: string): string => `${inputs.errors}.push(${errExpr});`;
  const liftError = (errExpr: string): void => {
    inputs.gen.line(liftErrorStmt(errExpr));
  };
  const budgetBreakStmt = (): string =>
    gated
      ? `if (${NAMES.DEPS}.errorsRemaining <= 0) { ${NAMES.DEPS}.truncated = true; break; }`
      : "";
  const emitBudgetBreak = (): void => {
    const stmt = budgetBreakStmt();
    if (stmt !== "") inputs.gen.line(stmt);
  };

  // Push a path segment onto the shared mutable path array, run `body`,
  // then pop. Runtime helpers (`createError`, `createLeafError`,
  // `createBranchError`) snapshot `path` at error-creation time, so
  // errors emitted inside `body` keep the correct path after the pop.
  const withPathSegment = (segmentExpr: string, body: () => void): void => {
    inputs.gen.line(`${inputs.path}.push(${segmentExpr});`);
    body();
    inputs.gen.line(`${inputs.path}.pop();`);
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
  const tryInline = (schema: SchemaObject, dataExpr: string): boolean => {
    if (inputs.byKeyword === undefined) return false;
    const allKeys = Object.keys(schema);
    const validationKeys: string[] = [];
    for (const k of allKeys) {
      if (IGNORABLE_KEYS.has(k)) continue;
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
        path: inputs.path,
        errors: inputs.errors,
        subschema: inputs.subschema,
        resolveRef: inputs.resolveRef,
        evaluatedPropertiesVar: null,
        evaluatedItemsVar: null,
        gated,
        byKeyword: inputs.byKeyword,
        inlineDepth: inlineDepth + 1,
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
    if (validationKeys.some((k) => APPLICATOR_KEYS.has(k))) return false;
    if (validationKeys.length > MAX_INLINE_KEYWORDS) return false;
    if (inlineDepth >= MAX_INLINE_DEPTH) return false;

    // Snapshot the errors array length; if >1 new error fires, wrap
    // the new ones in a "schema" branch so the tree shape matches a
    // named function's `wrapErrors` output.
    const startVar = inputs.gen.scope.name("_start");
    inputs.gen.const(startVar, `${inputs.errors}.length`);

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
        path: inputs.path,
        errors: inputs.errors,
        subschema: inputs.subschema,
        resolveRef: inputs.resolveRef,
        evaluatedPropertiesVar: null,
        evaluatedItemsVar: null,
        gated,
        byKeyword: inputs.byKeyword,
        inlineDepth: inlineDepth + 1,
      });
      kw.compile(innerCtx);
    }

    // Wrap if >1 new error actually fired.
    const wrappedVar = inputs.gen.scope.name("_wrapped");
    inputs.gen.if(`${inputs.errors}.length - ${startVar} > 1`, () => {
      inputs.gen.const(wrappedVar, `${inputs.errors}.splice(${startVar})`);
      inputs.gen.line(
        `${inputs.errors}.push(${NAMES.DEPS}.createBranchError(` +
          `"schema", ${inputs.path}, "schema validation failed", ${wrappedVar}));`,
      );
    });

    return true;
  };

  const emitSubschemaValidation = (
    schema: SchemaOrBoolean,
    dataExpr: string,
    segmentExpr?: string,
  ): void => {
    const emitInner = (): void => {
      if (schema === true) return;
      if (schema === false) {
        const falseErr =
          `${NAMES.DEPS}.createLeafError("false", ${inputs.path}, ` +
          `"schema is false, nothing is valid")`;
        inputs.gen.line(emitPushStatement(inputs.errors, falseErr, gated));
        return;
      }
      if (tryInline(schema, dataExpr)) return;
      // Fall back: compile subschema to a named function and call it
      // with the SHARED path. The sub-function's error emissions
      // snapshot the path before committing it to ValidationError, so
      // the shared-array reuse is safe.
      const fn = inputs.subschema(schema);
      const errVar = inputs.gen.scope.name("e");
      inputs.gen.const(errVar, `${fn}(${dataExpr}, ${inputs.path})`);
      inputs.gen.if(`${errVar} !== null`, () => {
        inputs.gen.line(`${inputs.errors}.push(${errVar});`);
      });
    };
    if (segmentExpr === undefined) {
      emitInner();
    } else {
      withPathSegment(segmentExpr, emitInner);
    }
  };

  return {
    gen: inputs.gen,
    schema: inputs.schema,
    parentSchema: inputs.parentSchema,
    data: inputs.data,
    path: inputs.path,
    errors: inputs.errors,
    subschema: inputs.subschema,
    resolveRef: inputs.resolveRef,
    evaluatedPropertiesVar,
    evaluatedItemsVar,
    markPropertyEvaluated,
    markItemEvaluated,
    gated,
    pushErrorStmt,
    pushError,
    liftErrorStmt,
    liftError,
    budgetBreakStmt,
    emitBudgetBreak,
    withPathSegment,
    emitSubschemaValidation,
    error: (params: EmitErrorParams) => emitError(inputs, params, gated),
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
  if (!gated) return `${errorsVar}.push(${errExpr});`;
  return (
    `if (${NAMES.DEPS}.errorsRemaining > 0) { ${errorsVar}.push(${errExpr}); ${NAMES.DEPS}.errorsRemaining -= 1; }` +
    ` else { ${NAMES.DEPS}.truncated = true; }`
  );
}

function emitError(inputs: KeywordContextInputs, params: EmitErrorParams, gated: boolean): void {
  const path = params.pathExpr ?? inputs.path;
  const paramsObj = renderParamsLiteral(params.params);
  const children = params.childrenExpr ?? "[]";
  const message = renderMessage(params.message);
  const codeLiteral = quoteString(params.code);
  const errExpr =
    `${NAMES.DEPS}.createError({ code: ${codeLiteral}, path: ${path}, message: ${message},` +
    ` params: ${paramsObj}, children: ${children} })`;
  inputs.gen.line(emitPushStatement(inputs.errors, errExpr, gated));
}

function renderMessage(message: string): string {
  if (message.startsWith("`") && message.endsWith("`")) return message;
  if (message.startsWith("'") || message.startsWith('"')) return message;
  return `\`${message}\``;
}

function renderParamsLiteral(params: Record<string, string> | undefined): string {
  if (!params) return "{}";
  const entries = Object.keys(params).map((key) => {
    const value = params[key] ?? "undefined";
    const safeKey = /^[A-Za-z_$][\w$]*$/.test(key) ? key : quoteString(key);
    return `${safeKey}: ${value}`;
  });
  return `{ ${entries.join(", ")} }`;
}
