import { NAMES, quoteString } from "../codegen/index.js";
import type { KeywordCompileContext, KeywordDefinition } from "./types.js";
import { CORE_VALIDATION_VOCAB } from "./vocabulary-uris.js";

function numberGuard(dataExpr: string): string {
  return `typeof ${dataExpr} === "number" && Number.isFinite(${dataExpr})`;
}

function emitNumericError(
  ctx: KeywordCompileContext,
  code: string,
  message: string,
  paramsObj: string,
): void {
  ctx.emitError(
    "leaf",
    `${NAMES.DEPS}.createLeafError(` +
      `${quoteString(code)}, ${ctx.path}, ${message}, ${paramsObj})`,
  );
}

/**
 * The JSON Schema `multipleOf` keyword. Data must be divisible by the schema
 * value (without floating-point remainder).
 *
 * @public
 */
export const multipleOfKeyword: KeywordDefinition = {
  keyword: "multipleOf",
  vocabulary: CORE_VALIDATION_VOCAB,
  compile(ctx: KeywordCompileContext): void {
    const divisor = ctx.schema as number;
    ctx.gen.if(`${numberGuard(ctx.data)} && (${ctx.data} / ${divisor}) % 1 !== 0`, () => {
      ctx.emitError(
        "leaf",
        `${NAMES.DEPS}.createLeafError(` +
          `${quoteString("multipleOf")}, ${ctx.path}, ` +
          `\`must be a multiple of ${divisor}\`, ` +
          `{ multipleOf: ${divisor}, actual: ${ctx.data} })`,
      );
    });
  },
};

/**
 * The JSON Schema `maximum` keyword. Data must be <= the schema value.
 *
 * @public
 */
export const maximumKeyword: KeywordDefinition = {
  keyword: "maximum",
  vocabulary: CORE_VALIDATION_VOCAB,
  compile(ctx: KeywordCompileContext): void {
    const limit = ctx.schema as number;
    ctx.gen.if(`${numberGuard(ctx.data)} && ${ctx.data} > ${limit}`, () => {
      emitNumericError(
        ctx,
        "maximum",
        `\`must be <= ${limit}\``,
        `{ maximum: ${limit}, actual: ${ctx.data} }`,
      );
    });
  },
};

/**
 * The JSON Schema `exclusiveMaximum` keyword. Data must be < the schema value.
 *
 * @public
 */
export const exclusiveMaximumKeyword: KeywordDefinition = {
  keyword: "exclusiveMaximum",
  vocabulary: CORE_VALIDATION_VOCAB,
  compile(ctx: KeywordCompileContext): void {
    const limit = ctx.schema as number;
    ctx.gen.if(`${numberGuard(ctx.data)} && ${ctx.data} >= ${limit}`, () => {
      emitNumericError(
        ctx,
        "exclusiveMaximum",
        `\`must be < ${limit}\``,
        `{ exclusiveMaximum: ${limit}, actual: ${ctx.data} }`,
      );
    });
  },
};

/**
 * The JSON Schema `minimum` keyword. Data must be >= the schema value.
 *
 * @public
 */
export const minimumKeyword: KeywordDefinition = {
  keyword: "minimum",
  vocabulary: CORE_VALIDATION_VOCAB,
  compile(ctx: KeywordCompileContext): void {
    const limit = ctx.schema as number;
    ctx.gen.if(`${numberGuard(ctx.data)} && ${ctx.data} < ${limit}`, () => {
      emitNumericError(
        ctx,
        "minimum",
        `\`must be >= ${limit}\``,
        `{ minimum: ${limit}, actual: ${ctx.data} }`,
      );
    });
  },
};

/**
 * The JSON Schema `exclusiveMinimum` keyword. Data must be > the schema value.
 *
 * @public
 */
export const exclusiveMinimumKeyword: KeywordDefinition = {
  keyword: "exclusiveMinimum",
  vocabulary: CORE_VALIDATION_VOCAB,
  compile(ctx: KeywordCompileContext): void {
    const limit = ctx.schema as number;
    ctx.gen.if(`${numberGuard(ctx.data)} && ${ctx.data} <= ${limit}`, () => {
      emitNumericError(
        ctx,
        "exclusiveMinimum",
        `\`must be > ${limit}\``,
        `{ exclusiveMinimum: ${limit}, actual: ${ctx.data} }`,
      );
    });
  },
};
