import { NAMES, quoteString } from "../codegen/index.js";
import type { SchemaOrBoolean } from "@oav/core";
import type { KeywordCompileContext, KeywordDefinition } from "./types.js";
import { UNEVALUATED_VOCAB } from "./vocabulary-uris.js";

/**
 * The `unevaluatedProperties` keyword. Validates every property NOT already
 * evaluated by sibling keywords (`properties`, `patternProperties`,
 * `additionalProperties`) or by any composition keyword (`allOf`,
 * `anyOf`, `oneOf`, `$ref`, `if`/`then`/`else`, `dependentSchemas`) in the
 * enclosing scope, against the given subschema. Annotations from failing
 * subschemas are discarded per the 2020-12 spec.
 *
 * @public
 */
export const unevaluatedPropertiesKeyword: KeywordDefinition = {
  keyword: "unevaluatedProperties",
  vocabulary: UNEVALUATED_VOCAB,
  applicator: true,
  typeGate: "object",
  compile(ctx: KeywordCompileContext): void {
    const sub = ctx.schema as SchemaOrBoolean;
    const evaluatedVar = ctx.evaluatedPropertiesVar;
    if (evaluatedVar === null) return;
    ctx.typeGate("object", (g) => {
      const key = g.scope.name("k");
      g.forIn(key, ctx.data, (gi) => {
        gi.if(`${evaluatedVar}.has(${key})`, (gii) => gii.line("continue;"));
        if (sub === true) {
          gi.line(`${evaluatedVar}.add(${key});`);
          return;
        }
        if (sub === false) {
          ctx.withPathSegment(key, () => {
            // Offending key name lives in params.unexpected; dropping
            // it from the message turns the emitted string into a
            // constant literal.
            ctx.emitError(
              "leaf",
              `${NAMES.DEPS}.createLeafError(` +
                `${quoteString("unevaluatedProperties")}, ${ctx.path}, ` +
                `"property is not evaluated by the schema", ` +
                `{ unexpected: ${key} })`,
            );
          });
          ctx.emitBudgetBreak();
          return;
        }
        ctx.validateSubschema(sub, `${ctx.data}[${key}]`, { segment: key });
        ctx.emitBudgetBreak();
      });
    });
  },
  evaluates: { properties: true },
};

/**
 * The `unevaluatedItems` keyword. Validates every array index NOT already
 * evaluated by sibling keywords (`prefixItems`, `items`, `contains`) or by
 * any composition keyword in the enclosing scope, against the given
 * subschema.
 *
 * @public
 */
export const unevaluatedItemsKeyword: KeywordDefinition = {
  keyword: "unevaluatedItems",
  vocabulary: UNEVALUATED_VOCAB,
  applicator: true,
  compile(ctx: KeywordCompileContext): void {
    const sub = ctx.schema as SchemaOrBoolean;
    const evaluatedVar = ctx.evaluatedItemsVar;
    if (evaluatedVar === null) return;
    ctx.gen.if(`Array.isArray(${ctx.data})`, (g) => {
      const i = g.scope.name("i");
      g.forRange(i, `${ctx.data}.length`, (gi) => {
        gi.if(`${evaluatedVar}.has(${i})`, (gii) => gii.line("continue;"));
        if (sub === true) {
          gi.line(`${evaluatedVar}.add(${i});`);
          return;
        }
        if (sub === false) {
          ctx.withPathSegment(i, () => {
            ctx.emitError(
              "leaf",
              `${NAMES.DEPS}.createLeafError(` +
                `${quoteString("unevaluatedItems")}, ${ctx.path}, ` +
                `"item is not evaluated by the schema", ` +
                `{ index: ${i} })`,
            );
          });
          ctx.emitBudgetBreak();
          return;
        }
        ctx.validateSubschema(sub, `${ctx.data}[${i}]`, { segment: i });
        ctx.emitBudgetBreak();
      });
    });
  },
  evaluates: { items: true },
};
