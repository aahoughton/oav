import { NAMES, quoteString } from "../codegen/index.js";
import type { SchemaOrBoolean } from "@oav/core";
import type { KeywordCompileContext, KeywordDefinition } from "./types.js";

const APPLICATOR_VOCAB = "https://json-schema.org/draft/2020-12/vocab/applicator";

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
        const fn = ctx.subschema(sub);
        g.if(`${ctx.data}.length > ${i}`, (gi) => {
          const errVar = gi.scope.name("e");
          gi.const(errVar, `${fn}(${ctx.data}[${i}], [...${ctx.path}, ${i}])`);
          gi.if(`${errVar} !== null`, (gii) => gii.line(`${ctx.errors}.push(${errVar});`));
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
        g.line(
          `${ctx.errors}.push(${NAMES.DEPS}.createLeafError(` +
            `${quoteString("items")}, [...${ctx.path}, ${i}], ` +
            `"no additional items allowed", {}));`,
        );
      } else {
        const fn = ctx.subschema(subSchema);
        const errVar = g.scope.name("e");
        g.const(errVar, `${fn}(${ctx.data}[${i}], [...${ctx.path}, ${i}])`);
        g.if(`${errVar} !== null`, (gi) => gi.line(`${ctx.errors}.push(${errVar});`));
        if (ctx.evaluatedItemsVar !== null) {
          g.line(`${ctx.evaluatedItemsVar}.add(${i});`);
        }
      }
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
    const fn = ctx.subschema(subSchema);
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
        gi.const(errVar, `${fn}(${ctx.data}[${i}], [...${ctx.path}, ${i}])`);
        gi.if(`${errVar} === null`, (gii) => {
          gii.line(`${count} += 1;`);
          gii.line(`${matchedIdx}.push(${i});`);
          if (ctx.evaluatedItemsVar !== null) {
            gii.line(`${ctx.evaluatedItemsVar}.add(${i});`);
          }
        });
      });
      if (min > 0) {
        g.if(`${count} < ${min}`, (gi) => {
          gi.line(
            `${ctx.errors}.push(${NAMES.DEPS}.createLeafError(` +
              `${quoteString("contains")}, ${ctx.path}, ` +
              `\`must contain at least ${min} matching item(s) (found \${${count}})\`, ` +
              `{ minContains: ${min}, actual: ${count} }));`,
          );
        });
      }
      if (max !== undefined) {
        g.if(`${count} > ${max}`, (gi) => {
          gi.line(
            `${ctx.errors}.push(${NAMES.DEPS}.createLeafError(` +
              `${quoteString("maxContains")}, ${ctx.path}, ` +
              `\`must contain at most ${max} matching item(s) (found \${${count}})\`, ` +
              `{ maxContains: ${max}, actual: ${count} }));`,
          );
        });
      }
    });
  },
  evaluates: { items: true },
};
