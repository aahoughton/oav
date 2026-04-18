import { NAMES, quoteString } from "../codegen/index.js";
import type { JsonValue } from "@oav/core";
import type { KeywordCompileContext, KeywordDefinition } from "./types.js";

const CORE_VOCAB = "https://json-schema.org/draft/2020-12/vocab/validation";

/**
 * The JSON Schema 2020-12 `enum` keyword. Data must be deep-equal to one of
 * the listed values.
 *
 * @public
 */
export const enumKeyword: KeywordDefinition = {
  keyword: "enum",
  vocabulary: CORE_VOCAB,
  compile(ctx: KeywordCompileContext): void {
    const values = ctx.schema as JsonValue[];
    const valuesLit = JSON.stringify(values);
    const valuesVar = ctx.gen.scope.name("enumValues");
    ctx.gen.const(valuesVar, valuesLit);
    const matched = ctx.gen.scope.name("matched");
    ctx.gen.let(matched, "false");
    ctx.gen.forOf("candidate", valuesVar, (g) => {
      g.if(`${NAMES.DEPS}.deepEqual(${ctx.data}, candidate)`, (gi) => {
        gi.line(`${matched} = true;`);
        gi.line("break;");
      });
    });
    ctx.gen.if(`!${matched}`, () => {
      ctx.pushError(
        `${NAMES.DEPS}.createLeafError(` +
          `${quoteString("enum")}, ${ctx.path}, ` +
          `"must be one of the allowed values", ` +
          `{ allowed: ${valuesLit}, actual: ${ctx.data} })`,
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
  vocabulary: CORE_VOCAB,
  compile(ctx: KeywordCompileContext): void {
    const value = ctx.schema as JsonValue;
    const valueLit = JSON.stringify(value);
    ctx.gen.if(`!${NAMES.DEPS}.deepEqual(${ctx.data}, ${valueLit})`, () => {
      ctx.pushError(
        `${NAMES.DEPS}.createLeafError(` +
          `${quoteString("const")}, ${ctx.path}, ` +
          `"must equal the expected constant", ` +
          `{ expected: ${valueLit}, actual: ${ctx.data} })`,
      );
    });
  },
};
