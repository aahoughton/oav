import { NAMES, quoteString } from "../codegen/index.js";
import type { JsonValue } from "@oav/core";
import type { KeywordCompileContext, KeywordDefinition } from "./types.js";
import { CORE_VALIDATION_VOCAB } from "./vocabulary-uris.js";

/**
 * The JSON Schema 2020-12 `enum` keyword. Data must be deep-equal to one of
 * the listed values.
 *
 * @public
 */
export const enumKeyword: KeywordDefinition = {
  keyword: "enum",
  vocabulary: CORE_VALIDATION_VOCAB,
  compile(ctx: KeywordCompileContext): void {
    const values = ctx.schema as JsonValue[];
    const valuesLit = JSON.stringify(values);
    const valuesVar = ctx.hoistConstant(valuesLit, "enumValues");
    const matched = ctx.gen.scope.name("matched");
    ctx.gen.let(matched, "false");
    ctx.gen.forOf("candidate", valuesVar, (g) => {
      g.if(`${NAMES.DEPS}.deepEqual(${ctx.data}, candidate)`, (gi) => {
        gi.line(`${matched} = true;`);
        gi.line("break;");
      });
    });
    ctx.gen.if(`!${matched}`, () => {
      ctx.emitError(
        "leaf",
        ctx.leafErrorExpr(
          quoteString("enum"),
          `"must be one of the allowed values"`,
          `{ allowed: ${valuesLit}, actual: ${ctx.data} }`,
        ),
      );
    });
  },
};

/**
 * The JSON Schema 2020-12 `const` keyword. Data must be deep-equal to the
 * provided constant.
 *
 * @public
 */
export const constKeyword: KeywordDefinition = {
  keyword: "const",
  vocabulary: CORE_VALIDATION_VOCAB,
  compile(ctx: KeywordCompileContext): void {
    const value = ctx.schema as JsonValue;
    const valueLit = JSON.stringify(value);
    ctx.gen.if(`!${NAMES.DEPS}.deepEqual(${ctx.data}, ${valueLit})`, () => {
      ctx.emitError(
        "leaf",
        ctx.leafErrorExpr(
          quoteString("const"),
          `"must equal the expected constant"`,
          `{ expected: ${valueLit}, actual: ${ctx.data} }`,
        ),
      );
    });
  },
};
