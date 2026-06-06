import { NAMES, quoteString } from "../codegen/index.js";
import { buildTypeMismatchCondition } from "./type-predicates.js";
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
      ctx.emitError(
        "leaf",
        ctx.leafErrorExpr(
          quoteString("type"),
          JSON.stringify(`must be ${formatTypeList(expected)}`),
          `{ expected: ${expectedLit}, actual: ${actualExpr} }`,
        ),
      );
    });
  },
};

function formatTypeList(types: string[]): string {
  if (types.length === 1) return types[0] ?? "";
  if (types.length === 2) return `${types[0]} or ${types[1]}`;
  return types.slice(0, -1).join(", ") + `, or ${types.at(-1)}`;
}
