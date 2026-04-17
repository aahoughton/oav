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
  markPropertyEvaluated?: (nameExpr: string) => void;
  markItemEvaluated?: (indexExpr: string) => void;
  evaluatedPropertiesVar?: string | null;
  evaluatedItemsVar?: string | null;
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

  return {
    gen: inputs.gen,
    schema: inputs.schema,
    parentSchema: inputs.parentSchema,
    data: inputs.data,
    path: inputs.path,
    errors: inputs.errors,
    subschema: inputs.subschema,
    evaluatedPropertiesVar,
    evaluatedItemsVar,
    markPropertyEvaluated,
    markItemEvaluated,
    error: (params: EmitErrorParams) => emitError(inputs, params),
  };
}

function emitError(inputs: KeywordContextInputs, params: EmitErrorParams): void {
  const path = params.pathExpr ?? inputs.path;
  const paramsObj = renderParamsLiteral(params.params);
  const children = params.childrenExpr ?? "[]";
  const message = renderMessage(params.message);
  const codeLiteral = quoteString(params.code);
  const call =
    `${inputs.errors}.push(` +
    `${NAMES.DEPS}.createError({ code: ${codeLiteral}, path: ${path}, message: ${message},` +
    ` params: ${paramsObj}, children: ${children} })` +
    `);`;
  inputs.gen.line(call);
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
