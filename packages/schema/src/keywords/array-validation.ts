import { NAMES, quoteString } from "../codegen/index.js";
import type { KeywordCompileContext, KeywordDefinition } from "./types.js";
import { CORE_VALIDATION_VOCAB } from "./vocabulary-uris.js";

/**
 * The JSON Schema `maxItems` keyword. Array data must have at most N items.
 *
 * @public
 */
export const maxItemsKeyword: KeywordDefinition = {
  keyword: "maxItems",
  vocabulary: CORE_VALIDATION_VOCAB,
  compile(ctx: KeywordCompileContext): void {
    const limit = ctx.schema as number;
    ctx.gen.if(`Array.isArray(${ctx.data}) && ${ctx.data}.length > ${limit}`, () => {
      ctx.pushError(
        `${NAMES.DEPS}.createLeafError(` +
          `${quoteString("maxItems")}, ${ctx.path}, ` +
          `\`must have at most ${limit} items\`, ` +
          `{ maxItems: ${limit}, actual: ${ctx.data}.length })`,
      );
    });
  },
};

/**
 * The JSON Schema `minItems` keyword. Array data must have at least N items.
 *
 * @public
 */
export const minItemsKeyword: KeywordDefinition = {
  keyword: "minItems",
  vocabulary: CORE_VALIDATION_VOCAB,
  compile(ctx: KeywordCompileContext): void {
    const limit = ctx.schema as number;
    ctx.gen.if(`Array.isArray(${ctx.data}) && ${ctx.data}.length < ${limit}`, () => {
      ctx.pushError(
        `${NAMES.DEPS}.createLeafError(` +
          `${quoteString("minItems")}, ${ctx.path}, ` +
          `\`must have at least ${limit} items\`, ` +
          `{ minItems: ${limit}, actual: ${ctx.data}.length })`,
      );
    });
  },
};

/**
 * The JSON Schema `uniqueItems` keyword. When set to `true`, every array
 * item must be pairwise not-deep-equal.
 *
 * @public
 */
export const uniqueItemsKeyword: KeywordDefinition = {
  keyword: "uniqueItems",
  vocabulary: CORE_VALIDATION_VOCAB,
  compile(ctx: KeywordCompileContext): void {
    if (ctx.schema !== true) return;
    const i = ctx.gen.scope.name("i");
    const j = ctx.gen.scope.name("j");
    const dup = ctx.gen.scope.name("dup");
    ctx.gen.if(`Array.isArray(${ctx.data})`, (g) => {
      g.let(dup, "null");
      g.line(`outer_${dup}: for (let ${i} = 0; ${i} < ${ctx.data}.length; ${i} += 1) {`);
      g.indent();
      g.line(`for (let ${j} = ${i} + 1; ${j} < ${ctx.data}.length; ${j} += 1) {`);
      g.indent();
      g.if(`${NAMES.DEPS}.deepEqual(${ctx.data}[${i}], ${ctx.data}[${j}])`, (gi) => {
        gi.line(`${dup} = { a: ${i}, b: ${j} };`);
        gi.line(`break outer_${dup};`);
      });
      g.dedent();
      g.line(`}`);
      g.dedent();
      g.line(`}`);
      g.if(`${dup} !== null`, () => {
        ctx.pushError(
          `${NAMES.DEPS}.createLeafError(` +
            `${quoteString("uniqueItems")}, ${ctx.path}, ` +
            `\`must have unique items (indices \${${dup}.a} and \${${dup}.b} are equal)\`, ` +
            `{ duplicates: [${dup}.a, ${dup}.b] })`,
        );
      });
    });
  },
};
