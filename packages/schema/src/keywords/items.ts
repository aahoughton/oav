import { NAMES, quoteString } from "../codegen/index.js";
import type { SchemaOrBoolean } from "@oav/core";
import type { KeywordCompileContext, KeywordDefinition } from "./types.js";
import { APPLICATOR_VOCAB } from "./vocabulary-uris.js";

/**
 * The `prefixItems` keyword. Validates the first N items of an array against
 * a tuple of subschemas.
 *
 * @public
 */
export const prefixItemsKeyword: KeywordDefinition = {
  keyword: "prefixItems",
  vocabulary: APPLICATOR_VOCAB,
  applicator: true,
  compile(ctx: KeywordCompileContext): void {
    const schemas = ctx.schema as SchemaOrBoolean[];
    if (schemas.length === 0) return;
    ctx.gen.if(`Array.isArray(${ctx.data})`, (g) => {
      schemas.forEach((sub, i) => {
        g.if(`${ctx.data}.length > ${i}`, (gi) => {
          ctx.validateSubschema(sub, `${ctx.data}[${i}]`, { segment: String(i) });
          if (ctx.evaluatedItemsVar !== null) {
            gi.line(`${ctx.evaluatedItemsVar}.add(${i});`);
          }
        });
      });
    });
  },
  evaluates: { items: true },
};

/**
 * The `items` keyword. Validates every array item AFTER the prefixItems
 * window (or every item if no prefixItems).
 *
 * @public
 */
export const itemsKeyword: KeywordDefinition = {
  keyword: "items",
  vocabulary: APPLICATOR_VOCAB,
  applicator: true,
  compile(ctx: KeywordCompileContext): void {
    const subSchema = ctx.schema as SchemaOrBoolean;
    const prefixLen = ctx.parentSchema.prefixItems?.length ?? 0;
    const start = prefixLen;
    ctx.gen.if(`Array.isArray(${ctx.data})`, (g) => {
      const i = g.scope.name("i");
      g.line(`for (let ${i} = ${start}; ${i} < ${ctx.data}.length; ${i} += 1) {`);
      g.indent();
      if (subSchema === true) {
        if (ctx.evaluatedItemsVar !== null) {
          g.line(`${ctx.evaluatedItemsVar}.add(${i});`);
        }
      } else if (subSchema === false) {
        ctx.withPathSegment(i, () => {
          ctx.emitError(
            "leaf",
            `${NAMES.DEPS}.createLeafError(` +
              `${quoteString("items")}, ${ctx.path}, ` +
              `"no additional items allowed", {})`,
          );
        });
      } else {
        ctx.validateSubschema(subSchema, `${ctx.data}[${i}]`, { segment: i });
        if (ctx.evaluatedItemsVar !== null) {
          g.line(`${ctx.evaluatedItemsVar}.add(${i});`);
        }
      }
      ctx.emitBudgetBreak();
      g.dedent();
      g.line(`}`);
    });
  },
  evaluates: { items: true },
};

/**
 * The `contains` keyword. The array must have at least `minContains`
 * (default 1) and at most `maxContains` items matching the subschema.
 *
 * Dispatches for `minContains` and `maxContains` are suppressed — this
 * keyword handles them.
 *
 * @public
 */
export const containsKeyword: KeywordDefinition = {
  keyword: "contains",
  vocabulary: APPLICATOR_VOCAB,
  applicator: true,
  implements: ["minContains", "maxContains"],
  compile(ctx: KeywordCompileContext): void {
    const subSchema = ctx.schema as SchemaOrBoolean;
    const fn = ctx.compileSubschema(subSchema);
    const min = ctx.parentSchema.minContains ?? 1;
    const max = ctx.parentSchema.maxContains;
    ctx.gen.if(`Array.isArray(${ctx.data})`, (g) => {
      const count = g.scope.name("count");
      const matchedIdx = g.scope.name("matched");
      g.let(count, "0");
      g.const(matchedIdx, "[]");
      const i = g.scope.name("i");
      g.forRange(i, `${ctx.data}.length`, (gi) => {
        const errVar = gi.scope.name("e");
        ctx.withPathSegment(i, () => {
          gi.const(errVar, `${fn}(${ctx.data}[${i}], ${ctx.path})`);
        });
        gi.if(`${errVar} === null`, (gii) => {
          gii.line(`${count} += 1;`);
          gii.line(`${matchedIdx}.push(${i});`);
          if (ctx.evaluatedItemsVar !== null) {
            gii.line(`${ctx.evaluatedItemsVar}.add(${i});`);
          }
        });
      });
      if (min > 0) {
        g.if(`${count} < ${min}`, () => {
          ctx.emitError(
            "leaf",
            `${NAMES.DEPS}.createLeafError(` +
              `${quoteString("contains")}, ${ctx.path}, ` +
              `\`must contain at least ${min} matching item(s) (found \${${count}})\`, ` +
              `{ minContains: ${min}, actual: ${count} })`,
          );
        });
      }
      if (max !== undefined) {
        g.if(`${count} > ${max}`, () => {
          ctx.emitError(
            "leaf",
            `${NAMES.DEPS}.createLeafError(` +
              `${quoteString("maxContains")}, ${ctx.path}, ` +
              `\`must contain at most ${max} matching item(s) (found \${${count}})\`, ` +
              `{ maxContains: ${max}, actual: ${count} })`,
          );
        });
      }
    });
  },
  evaluates: { items: true },
};
