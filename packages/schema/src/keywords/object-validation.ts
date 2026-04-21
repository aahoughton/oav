import { NAMES, quoteString } from "../codegen/index.js";
import type { KeywordCompileContext, KeywordDefinition } from "./types.js";
import { CORE_VALIDATION_VOCAB } from "./vocabulary-uris.js";

function isObjectGuard(dataExpr: string): string {
  return `typeof ${dataExpr} === "object" && ${dataExpr} !== null && !Array.isArray(${dataExpr})`;
}

function keyCountExpr(dataExpr: string): string {
  return `Object.keys(${dataExpr}).length`;
}

/**
 * The JSON Schema `maxProperties` keyword.
 *
 * @public
 */
export const maxPropertiesKeyword: KeywordDefinition = {
  keyword: "maxProperties",
  vocabulary: CORE_VALIDATION_VOCAB,
  compile(ctx: KeywordCompileContext): void {
    const limit = ctx.schema as number;
    const count = ctx.gen.scope.name("count");
    ctx.gen.if(isObjectGuard(ctx.data), (g) => {
      g.const(count, keyCountExpr(ctx.data));
      g.if(`${count} > ${limit}`, () => {
        ctx.emitError(
          "leaf",
          `${NAMES.DEPS}.createLeafError(` +
            `${quoteString("maxProperties")}, ${ctx.path}, ` +
            `\`must have at most ${limit} properties\`, ` +
            `{ maxProperties: ${limit}, actual: ${count} })`,
        );
      });
    });
  },
};

/**
 * The JSON Schema `minProperties` keyword.
 *
 * @public
 */
export const minPropertiesKeyword: KeywordDefinition = {
  keyword: "minProperties",
  vocabulary: CORE_VALIDATION_VOCAB,
  compile(ctx: KeywordCompileContext): void {
    const limit = ctx.schema as number;
    const count = ctx.gen.scope.name("count");
    ctx.gen.if(isObjectGuard(ctx.data), (g) => {
      g.const(count, keyCountExpr(ctx.data));
      g.if(`${count} < ${limit}`, () => {
        ctx.emitError(
          "leaf",
          `${NAMES.DEPS}.createLeafError(` +
            `${quoteString("minProperties")}, ${ctx.path}, ` +
            `\`must have at least ${limit} properties\`, ` +
            `{ minProperties: ${limit}, actual: ${count} })`,
        );
      });
    });
  },
};

/**
 * The JSON Schema `required` keyword. Object data must declare every name
 * in the array. Produces one error per missing property so consumers see a
 * complete report.
 *
 * @public
 */
export const requiredKeyword: KeywordDefinition = {
  keyword: "required",
  vocabulary: CORE_VALIDATION_VOCAB,
  compile(ctx: KeywordCompileContext): void {
    const required = ctx.schema as string[];
    if (required.length === 0) return;
    const requiredVar = ctx.hoistConstant(JSON.stringify(required), "required");
    const missingVar = ctx.gen.scope.name("missing");
    ctx.gen.if(isObjectGuard(ctx.data), (g) => {
      g.const(missingVar, "[]");
      g.forOf("_req", requiredVar, (gi) => {
        gi.if(`!Object.prototype.hasOwnProperty.call(${ctx.data}, _req)`, (gii) => {
          gii.line(`${missingVar}.push(_req);`);
        });
      });
      g.if(`${missingVar}.length > 0`, (gi) => {
        gi.forOf("_m", missingVar, () => {
          ctx.withPathSegment("_m", (base, seg) => {
            ctx.emitError(
              "leaf",
              `${NAMES.DEPS}.createLeafError(` +
                `${quoteString("required")}, ${base}, ` +
                `\`must have required property "\${_m}"\`, ` +
                `{ missing: _m }, ${seg})`,
            );
          });
          ctx.emitBudgetBreak();
        });
      });
    });
  },
};
