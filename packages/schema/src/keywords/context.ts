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

  const tryInline = (schema: SchemaObject, dataExpr: string, pathExpr: string): boolean => {
    if (inputs.byKeyword === undefined) return false;
    const allKeys = Object.keys(schema);
    let validationKey: string | undefined;
    for (const k of allKeys) {
      if (IGNORABLE_KEYS.has(k)) continue;
      if (validationKey !== undefined) return false; // more than one validation key
      validationKey = k;
    }
    if (validationKey === undefined) return true; // empty-ish schema — nothing to emit
    if (!INLINEABLE_SINGLE_KEYWORDS.has(validationKey)) return false;
    const kw = inputs.byKeyword.get(validationKey);
    if (kw === undefined) return false;
    // Compile the single keyword inline with the caller's errors accumulator
    // and overridden data/path expressions.
    const innerCtx = createKeywordContext({
      gen: inputs.gen,
      schema: (schema as Record<string, unknown>)[validationKey],
      parentSchema: schema,
      data: dataExpr,
      path: pathExpr,
      errors: inputs.errors,
      subschema: inputs.subschema,
      resolveRef: inputs.resolveRef,
      evaluatedPropertiesVar: null,
      evaluatedItemsVar: null,
      gated,
      byKeyword: inputs.byKeyword,
    });
    kw.compile(innerCtx);
    return true;
  };

  const emitSubschemaValidation = (
    schema: SchemaOrBoolean,
    dataExpr: string,
    pathExpr: string,
  ): void => {
    if (schema === true) return;
    if (schema === false) {
      const falseErr =
        `${NAMES.DEPS}.createLeafError("false", ${pathExpr}, ` +
        `"schema is false, nothing is valid")`;
      inputs.gen.line(emitPushStatement(inputs.errors, falseErr, gated));
      return;
    }
    if (tryInline(schema, dataExpr, pathExpr)) return;
    // Fall back: compile subschema to a named function and call it.
    const fn = inputs.subschema(schema);
    const errVar = inputs.gen.scope.name("e");
    inputs.gen.const(errVar, `${fn}(${dataExpr}, ${pathExpr})`);
    inputs.gen.if(`${errVar} !== null`, () => {
      inputs.gen.line(`${inputs.errors}.push(${errVar});`);
    });
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
