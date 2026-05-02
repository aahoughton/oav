import { quoteString } from "../codegen/index.js";
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
  ctx.emitError("leaf", ctx.leafErrorExpr(quoteString(code), message, paramsObj));
}

/**
 * The JSON Schema `multipleOf` keyword. Data must be divisible by the schema
 * value (without floating-point remainder).
 *
 * The check compares `data / divisor` against its nearest integer with a
 * relative epsilon so valid multiples aren't rejected when the division
 * produces a non-terminating binary fraction. IEEE-754 rounding error
 * grows roughly with magnitude, so a flat tolerance is wrong at both
 * ends: a value like `143.48 / 0.01` drifts by about `1.82e-12`, while
 * values near `1` stay within `1e-14`. Scaling by `Number.EPSILON *
 * max(1, |q|, |divisor|)` gives each multiple of `divisor` the same
 * proportional slack without letting true non-multiples sneak through.
 *
 * @public
 */
export const multipleOfKeyword: KeywordDefinition = {
  keyword: "multipleOf",
  vocabulary: CORE_VALIDATION_VOCAB,
  compile(ctx: KeywordCompileContext): void {
    const divisor = ctx.schema as number;
    const q = ctx.gen.scope.name("q");
    const tol = ctx.gen.scope.name("tol");
    // 16 * Number.EPSILON ≈ 3.55e-15; at |q| = 1e15 that admits ~3.55
    // units, which is still far less than one divisor's worth for any
    // reasonable spec value. The `divisor` factor keeps the tolerance
    // proportional when the spec uses tiny divisors (e.g. 1e-7).
    const tolExpr = `16 * Number.EPSILON * Math.max(1, Math.abs(${q}), Math.abs(${divisor}))`;
    ctx.gen.if(numberGuard(ctx.data), () => {
      ctx.gen.const(q, `${ctx.data} / ${divisor}`);
      ctx.gen.const(tol, tolExpr);
      ctx.gen.if(`Math.abs(${q} - Math.round(${q})) > ${tol}`, () => {
        ctx.emitError(
          "leaf",
          ctx.leafErrorExpr(
            quoteString("multipleOf"),
            `\`must be a multiple of ${divisor}\``,
            `{ multipleOf: ${divisor}, actual: ${ctx.data} }`,
          ),
        );
      });
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
