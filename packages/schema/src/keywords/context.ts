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
