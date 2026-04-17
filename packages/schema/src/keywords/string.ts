import { NAMES, quoteString } from "../codegen/index.js";
import type { KeywordCompileContext, KeywordDefinition } from "./types.js";

const CORE_VOCAB = "https://json-schema.org/draft/2020-12/vocab/validation";
const FORMAT_VOCAB = "https://json-schema.org/draft/2020-12/vocab/format-annotation";

/**
 * The JSON Schema `maxLength` keyword. String data must have at most N
 * (UTF-16 code-unit-safe) characters.
 *
 * @public
 */
export const maxLengthKeyword: KeywordDefinition = {
  keyword: "maxLength",
  vocabulary: CORE_VOCAB,
  compile(ctx: KeywordCompileContext): void {
    const limit = ctx.schema as number;
    const lenExpr = codeUnitLengthExpr(ctx.data);
    ctx.gen.if(`typeof ${ctx.data} === "string" && ${lenExpr} > ${limit}`, (g) => {
      g.line(
        `${ctx.errors}.push(${NAMES.DEPS}.createLeafError(` +
          `${quoteString("maxLength")}, ${ctx.path}, ` +
          `\`must have at most ${limit} characters\`, ` +
          `{ maxLength: ${limit}, actual: ${lenExpr} }));`,
      );
    });
  },
};

/**
 * The JSON Schema `minLength` keyword. String data must have at least N
 * characters.
 *
 * @public
 */
export const minLengthKeyword: KeywordDefinition = {
  keyword: "minLength",
  vocabulary: CORE_VOCAB,
  compile(ctx: KeywordCompileContext): void {
    const limit = ctx.schema as number;
    const lenExpr = codeUnitLengthExpr(ctx.data);
    ctx.gen.if(`typeof ${ctx.data} === "string" && ${lenExpr} < ${limit}`, (g) => {
      g.line(
        `${ctx.errors}.push(${NAMES.DEPS}.createLeafError(` +
          `${quoteString("minLength")}, ${ctx.path}, ` +
          `\`must have at least ${limit} characters\`, ` +
          `{ minLength: ${limit}, actual: ${lenExpr} }));`,
      );
    });
  },
};

/**
 * The JSON Schema `pattern` keyword. String data must match the ECMA-262
 * regex given as the schema value.
 *
 * @public
 */
export const patternKeyword: KeywordDefinition = {
  keyword: "pattern",
  vocabulary: CORE_VOCAB,
  compile(ctx: KeywordCompileContext): void {
    const source = ctx.schema as string;
    const patternVar = ctx.gen.scope.name("pattern");
    const patternLit = quoteString(source);
    ctx.gen.line(
      `let ${patternVar} = ${NAMES.DEPS}.patterns.get(${patternLit});` +
        ` if (${patternVar} === undefined) { ${patternVar} = new RegExp(${patternLit}, "u"); ${NAMES.DEPS}.patterns.set(${patternLit}, ${patternVar}); }`,
    );
    ctx.gen.if(`typeof ${ctx.data} === "string" && !${patternVar}.test(${ctx.data})`, (g) => {
      g.line(
        `${ctx.errors}.push(${NAMES.DEPS}.createLeafError(` +
          `${quoteString("pattern")}, ${ctx.path}, ` +
          `\`must match pattern ${escapeMessage(source)}\`, ` +
          `{ pattern: ${patternLit}, actual: ${ctx.data} }));`,
      );
    });
  },
};

/**
 * The JSON Schema `format` keyword (format-annotation vocabulary). By
 * default, `format` is assertive here: if a validator is registered for the
 * named format, the string must pass it.
 *
 * @public
 */
export const formatKeyword: KeywordDefinition = {
  keyword: "format",
  vocabulary: FORMAT_VOCAB,
  compile(ctx: KeywordCompileContext): void {
    const formatName = ctx.schema as string;
    const formatLit = quoteString(formatName);
    const fnVar = ctx.gen.scope.name("fmt");
    ctx.gen.const(fnVar, `${NAMES.DEPS}.formats.get(${formatLit})`);
    ctx.gen.if(
      `typeof ${ctx.data} === "string" && ${fnVar} !== undefined && !${fnVar}(${ctx.data})`,
      (g) => {
        g.line(
          `${ctx.errors}.push(${NAMES.DEPS}.createLeafError(` +
            `${quoteString("format")}, ${ctx.path}, ` +
            `\`must match format ${escapeMessage(formatName)}\`, ` +
            `{ format: ${formatLit}, actual: ${ctx.data} }));`,
        );
      },
    );
  },
};

/**
 * UTF-16 code-point-safe string length. JSON Schema specifies character
 * (code point) counts, so surrogate pairs count as one.
 */
function codeUnitLengthExpr(dataExpr: string): string {
  return `[...${dataExpr}].length`;
}

function escapeMessage(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}
