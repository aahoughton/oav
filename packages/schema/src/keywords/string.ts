import { NAMES, quoteString } from "../codegen/index.js";
import type { KeywordCompileContext, KeywordDefinition } from "./types.js";
import { CORE_VALIDATION_VOCAB, FORMAT_ASSERTION_VOCAB, FORMAT_VOCAB } from "./vocabulary-uris.js";

/**
 * The JSON Schema `maxLength` keyword. String data must have at most N
 * (UTF-16 code-unit-safe) characters.
 *
 * @public
 */
export const maxLengthKeyword: KeywordDefinition = {
  keyword: "maxLength",
  vocabulary: CORE_VALIDATION_VOCAB,
  compile(ctx: KeywordCompileContext): void {
    const limit = ctx.schema as number;
    const lenExpr = codePointLengthExpr(ctx.data);
    ctx.gen.if(`typeof ${ctx.data} === "string" && ${lenExpr} > ${limit}`, () => {
      ctx.emitError(
        "leaf",
        ctx.leafErrorExpr(
          quoteString("maxLength"),
          `\`must have at most ${limit} characters\``,
          `{ maxLength: ${limit}, actual: ${lenExpr} }`,
        ),
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
  vocabulary: CORE_VALIDATION_VOCAB,
  compile(ctx: KeywordCompileContext): void {
    const limit = ctx.schema as number;
    const lenExpr = codePointLengthExpr(ctx.data);
    ctx.gen.if(`typeof ${ctx.data} === "string" && ${lenExpr} < ${limit}`, () => {
      ctx.emitError(
        "leaf",
        ctx.leafErrorExpr(
          quoteString("minLength"),
          `\`must have at least ${limit} characters\``,
          `{ minLength: ${limit}, actual: ${lenExpr} }`,
        ),
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
  vocabulary: CORE_VALIDATION_VOCAB,
  compile(ctx: KeywordCompileContext): void {
    const source = ctx.schema as string;
    const patternVar = ctx.gen.scope.name("pattern");
    const patternLit = quoteString(source);
    ctx.gen.line(`const ${patternVar} = ${NAMES.DEPS}.compilePattern(${patternLit});`);
    ctx.gen.if(`typeof ${ctx.data} === "string" && !${patternVar}.test(${ctx.data})`, () => {
      ctx.emitError(
        "leaf",
        ctx.leafErrorExpr(
          quoteString("pattern"),
          `\`must match pattern ${escapeMessage(source)}\``,
          `{ pattern: ${patternLit}, actual: ${ctx.data} }`,
        ),
      );
    });
  },
};

/**
 * The JSON Schema 2020-12 `format` keyword, annotation-only mode. Matches
 * the spec default: `format` is a structural hint, not an assertion. Use
 * {@link formatAssertionKeyword} (or the OpenAPI validator) to actually
 * reject malformed strings.
 *
 * @public
 */
export const formatKeyword: KeywordDefinition = {
  keyword: "format",
  vocabulary: FORMAT_VOCAB,
  compile(): void {
    // format-annotation mode: emit no runtime check.
  },
};

/**
 * The JSON Schema 2020-12 `format` keyword, assertion mode. When a
 * validator is registered for the named format, the string must pass it.
 * Callers activate this by including {@link formatAssertionVocabulary}
 * ahead of {@link formatVocabulary}.
 *
 * @public
 */
export const formatAssertionKeyword: KeywordDefinition = {
  keyword: "format",
  vocabulary: FORMAT_ASSERTION_VOCAB,
  compile(ctx: KeywordCompileContext): void {
    const formatName = ctx.schema as string;
    const formatLit = quoteString(formatName);
    const fnVar = ctx.gen.scope.name("fmt");
    ctx.gen.const(fnVar, `${NAMES.DEPS}.formats.get(${formatLit})`);
    ctx.gen.if(
      `typeof ${ctx.data} === "string" && ${fnVar} !== undefined && !${fnVar}(${ctx.data})`,
      () => {
        ctx.emitError(
          "leaf",
          ctx.leafErrorExpr(
            quoteString("format"),
            `\`must match format ${escapeMessage(formatName)}\``,
            `{ format: ${formatLit}, actual: ${ctx.data} }`,
          ),
        );
      },
    );
  },
};

/**
 * Emit an expression that returns the Unicode code-point count of a string.
 * JSON Schema 2020-12 §6.3 specifies that `minLength` / `maxLength` count
 * code points, so surrogate pairs (emoji, astral CJK, ...) count as one.
 * Spreading a string invokes its `[Symbol.iterator]`, which yields code
 * points — not the UTF-16 code units that `str.length` returns.
 */
function codePointLengthExpr(dataExpr: string): string {
  return `[...${dataExpr}].length`;
}

function escapeMessage(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/`/g, "\\`").replace(/\$\{/g, "\\${");
}
