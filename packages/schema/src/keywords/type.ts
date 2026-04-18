import { NAMES, quoteString } from "../codegen/index.js";
import type { KeywordCompileContext, KeywordDefinition } from "./types.js";
import { CORE_VALIDATION_VOCAB } from "./vocabulary-uris.js";

/**
 * The JSON Schema 2020-12 `type` keyword. Accepts a single type name or an
 * array of names; a value validates if its JSON type matches at least one.
 *
 * @public
 */
export const typeKeyword: KeywordDefinition = {
  keyword: "type",
  vocabulary: CORE_VALIDATION_VOCAB,
  compile(ctx: KeywordCompileContext): void {
    const expected = Array.isArray(ctx.schema) ? (ctx.schema as string[]) : [ctx.schema as string];
    const condition = buildTypeMismatchCondition(ctx.data, expected);
    ctx.gen.if(condition, () => {
      const expectedLit = JSON.stringify(expected);
      const actualExpr = `${NAMES.DEPS}.typeOf(${ctx.data})`;
      ctx.pushError(
        `${NAMES.DEPS}.createLeafError(` +
          `${quoteString("type")}, ${ctx.path}, ` +
          `"must be " + ${JSON.stringify(formatTypeList(expected))}, ` +
          `{ expected: ${expectedLit}, actual: ${actualExpr} })`,
      );
    });
  },
};

function buildTypeMismatchCondition(dataExpr: string, expected: string[]): string {
  const predicates = expected.map((t) => typePredicate(dataExpr, t));
  const anyMatch = predicates.join(" || ");
  return `!(${anyMatch})`;
}

function typePredicate(dataExpr: string, typeName: string): string {
  switch (typeName) {
    case "null":
      return `${dataExpr} === null`;
    case "boolean":
      return `typeof ${dataExpr} === "boolean"`;
    case "string":
      return `typeof ${dataExpr} === "string"`;
    case "array":
      return `Array.isArray(${dataExpr})`;
    case "object":
      return `(typeof ${dataExpr} === "object" && ${dataExpr} !== null && !Array.isArray(${dataExpr}))`;
    case "number":
      return `(typeof ${dataExpr} === "number" && Number.isFinite(${dataExpr}))`;
    case "integer":
      return `(typeof ${dataExpr} === "number" && Number.isFinite(${dataExpr}) && Number.isInteger(${dataExpr}))`;
    default:
      return `false`;
  }
}

function formatTypeList(types: string[]): string {
  if (types.length === 1) return types[0] ?? "";
  if (types.length === 2) return `${types[0]} or ${types[1]}`;
  return types.slice(0, -1).join(", ") + `, or ${types.at(-1)}`;
}
