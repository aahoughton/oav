import { nonNegativeIntegerLiteral, quoteString } from "../codegen/index.js";
import type { KeywordCompileContext, KeywordDefinition } from "./types.js";
import { CORE_VALIDATION_VOCAB } from "./vocabulary-uris.js";

function isObjectGuard(dataExpr: string): string {
  return `typeof ${dataExpr} === "object" && ${dataExpr} !== null && !Array.isArray(${dataExpr})`;
}

/**
 * The object-shape guard, computed once per validator-function scope and
 * shared across every object keyword on the same schema (`type`,
 * `required`, `properties`, `additionalProperties`, ...). Without this
 * each keyword re-emits the guard inline, repeating the `Array.isArray`
 * call per keyword on every object that reaches them. See
 * {@link KeywordCompileContext.scopeLocal}.
 */
function objectGuardVar(ctx: KeywordCompileContext): string {
  return ctx.scopeLocal(`isObject:${ctx.data}`, isObjectGuard(ctx.data), "obj");
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
    const limit = nonNegativeIntegerLiteral(ctx.schema, "maxProperties");
    const count = ctx.gen.scope.name("count");
    ctx.gen.if(objectGuardVar(ctx), (g) => {
      g.const(count, keyCountExpr(ctx.data));
      g.if(`${count} > ${limit}`, () => {
        ctx.emitError(
          "leaf",
          ctx.leafErrorExpr(
            quoteString("maxProperties"),
            `\`must have at most ${limit} properties\``,
            `{ maxProperties: ${limit}, actual: ${count} }`,
          ),
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
    const limit = nonNegativeIntegerLiteral(ctx.schema, "minProperties");
    const count = ctx.gen.scope.name("count");
    ctx.gen.if(objectGuardVar(ctx), (g) => {
      g.const(count, keyCountExpr(ctx.data));
      g.if(`${count} < ${limit}`, () => {
        ctx.emitError(
          "leaf",
          ctx.leafErrorExpr(
            quoteString("minProperties"),
            `\`must have at least ${limit} properties\``,
            `{ minProperties: ${limit}, actual: ${count} }`,
          ),
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
    if (ctx.predicate) {
      ctx.gen.if(objectGuardVar(ctx), (g) => {
        g.forOf("_req", requiredVar, (gi) => {
          gi.line(`if (!Object.prototype.hasOwnProperty.call(${ctx.data}, _req)) return false;`);
        });
      });
      return;
    }
    // Single pass: emit one leaf per missing key directly from the
    // membership scan. The errors come out in `required`-array order
    // (the scan order), which is the same order the previous
    // collect-into-`missing`-then-replay form produced, and the budget
    // break lands after the same key, so the error tree and truncation
    // flag are unchanged. The intermediate `missing` array is just gone.
    ctx.gen.if(objectGuardVar(ctx), (g) => {
      g.forOf("_req", requiredVar, (gi) => {
        gi.if(`!Object.prototype.hasOwnProperty.call(${ctx.data}, _req)`, () => {
          ctx.emitError(
            "leaf",
            ctx.leafErrorExpr(
              quoteString("required"),
              `\`must have required property "\${_req}"\``,
              `{ missing: _req }`,
              ["_req"],
            ),
          );
          ctx.emitBudgetBreak();
        });
      });
    });
  },
};
