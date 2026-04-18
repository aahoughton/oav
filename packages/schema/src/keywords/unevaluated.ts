import { NAMES, quoteString } from "../codegen/index.js";
import type { SchemaOrBoolean } from "@oav/core";
import type { KeywordCompileContext, KeywordDefinition } from "./types.js";

const APPLICATOR_VOCAB = "https://json-schema.org/draft/2020-12/vocab/applicator";
const UNEVALUATED_VOCAB = "https://json-schema.org/draft/2020-12/vocab/unevaluated";

function isObjectGuard(dataExpr: string): string {
  return `typeof ${dataExpr} === "object" && ${dataExpr} !== null && !Array.isArray(${dataExpr})`;
}

/**
 * The `unevaluatedProperties` keyword. Validates every property NOT already
 * evaluated by sibling keywords (`properties`, `patternProperties`,
 * `additionalProperties`) against the given subschema.
 *
 * @remarks
 * Evaluation reporting across `allOf`/`anyOf`/`oneOf` boundaries is NOT
 * propagated — subschemas validated through composition keywords are
 * compiled into separate functions that do not touch the enclosing
 * `evaluatedProperties` set. This covers the common case but may produce
 * false-positive errors for schemas that rely on composition to satisfy
 * `unevaluatedProperties`. Upgrading this to full dynamic evaluation would
 * require returning both errors and evaluation-sets from every subschema
 * call.
 *
 * @public
 */
export const unevaluatedPropertiesKeyword: KeywordDefinition = {
  keyword: "unevaluatedProperties",
  vocabulary: UNEVALUATED_VOCAB,
  applicator: true,
  compile(ctx: KeywordCompileContext): void {
    const sub = ctx.schema as SchemaOrBoolean;
    const evaluatedVar = ctx.evaluatedPropertiesVar;
    if (evaluatedVar === null) return;
    ctx.gen.if(isObjectGuard(ctx.data), (g) => {
      const key = g.scope.name("k");
      g.forIn(key, ctx.data, (gi) => {
        gi.if(`${evaluatedVar}.has(${key})`, (gii) => gii.line("continue;"));
        if (sub === true) {
          return;
        }
        if (sub === false) {
          ctx.pushError(
            `${NAMES.DEPS}.createLeafError(` +
              `${quoteString("unevaluatedProperties")}, [...${ctx.path}, ${key}], ` +
              `\`property "\${${key}}" is not evaluated by the schema\`, ` +
              `{ unexpected: ${key} })`,
          );
          ctx.emitBudgetBreak();
          return;
        }
        ctx.emitSubschemaValidation(sub, `${ctx.data}[${key}]`, `[...${ctx.path}, ${key}]`);
        ctx.emitBudgetBreak();
      });
    });
  },
  evaluates: { properties: true },
};

/**
 * The `unevaluatedItems` keyword. Validates every array index NOT already
 * evaluated by sibling keywords (`prefixItems`, `items`, `contains`) against
 * the given subschema.
 *
 * @remarks
 * See {@link unevaluatedPropertiesKeyword} for a note on composition.
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
          return;
        }
        if (sub === false) {
          ctx.pushError(
            `${NAMES.DEPS}.createLeafError(` +
              `${quoteString("unevaluatedItems")}, [...${ctx.path}, ${i}], ` +
              `"item is not evaluated by the schema", ` +
              `{ index: ${i} })`,
          );
          ctx.emitBudgetBreak();
          return;
        }
        ctx.emitSubschemaValidation(sub, `${ctx.data}[${i}]`, `[...${ctx.path}, ${i}]`);
        ctx.emitBudgetBreak();
      });
    });
  },
  evaluates: { items: true },
};

/**
 * The OpenAPI 3.1 `discriminator` object. When present alongside `oneOf`,
 * the validator reads the named property, looks it up in `mapping`, and
 * validates the data against ONLY the selected branch — producing a
 * single-branch failure tree rather than N branches.
 *
 * @remarks
 * When `discriminator` is present the normal `oneOf` pathway is suppressed
 * via the `implements` field.
 *
 * @public
 */
export const discriminatorKeyword: KeywordDefinition = {
  keyword: "discriminator",
  vocabulary: APPLICATOR_VOCAB,
  applicator: true,
  implements: ["oneOf", "anyOf"],
  compile(ctx: KeywordCompileContext): void {
    const disc = ctx.schema as { propertyName: string; mapping?: Record<string, string> };
    const propertyName = disc.propertyName;
    const mapping = disc.mapping ?? {};
    const branches = ctx.parentSchema.oneOf ?? ctx.parentSchema.anyOf;
    if (!branches) return;

    const nameToIndex = new Map<string, number>();
    branches.forEach((branch, i) => {
      if (typeof branch === "object" && branch !== null) {
        const ref = (branch as { $ref?: string }).$ref;
        if (ref !== undefined) {
          const last = ref.split("/").pop();
          if (last !== undefined) nameToIndex.set(last, i);
        }
      }
    });
    for (const [mapName, refPath] of Object.entries(mapping)) {
      const last = refPath.split("/").pop();
      if (last !== undefined) {
        const fromRef = nameToIndex.get(last);
        if (fromRef !== undefined) nameToIndex.set(mapName, fromRef);
      }
      const direct = branches.findIndex((b) => {
        if (typeof b !== "object" || b === null) return false;
        const ref = (b as { $ref?: string }).$ref;
        return ref === refPath;
      });
      if (direct >= 0) nameToIndex.set(mapName, direct);
    }

    const discFns: Array<{ value: string; fn: string }> = [];
    for (const [value, index] of nameToIndex) {
      const branch = branches[index];
      if (branch === undefined) continue;
      const fn = ctx.subschema(branch);
      discFns.push({ value, fn });
    }

    const propLit = quoteString(propertyName);
    ctx.gen.if(
      `typeof ${ctx.data} === "object" && ${ctx.data} !== null && !Array.isArray(${ctx.data})`,
      (g) => {
        const discVal = g.scope.name("disc");
        g.const(discVal, `${ctx.data}[${propLit}]`);
        g.if(
          `typeof ${discVal} !== "string"`,
          () => {
            ctx.pushError(
              `${NAMES.DEPS}.createLeafError(` +
                `${quoteString("discriminator")}, [...${ctx.path}, ${propLit}], ` +
                `\`discriminator property "${propertyName}" must be a string\`, ` +
                `{ propertyName: ${propLit} })`,
            );
          },
          (gi) => {
            // Discriminator routes to ONE branch. If it returns an error,
            // that's already a counted leaf from the sub-validator — lift
            // it (don't re-count). If the discriminator value matches no
            // branch, THAT error is a fresh leaf — gate it.
            const switchLines = discFns
              .map(
                ({ value, fn }) =>
                  `      case ${quoteString(value)}: { const e = ${fn}(${ctx.data}, ${ctx.path}); if (e !== null) ${ctx.liftErrorStmt("e")} break; }`,
              )
              .join("\n");
            gi.line(`switch (${discVal}) {`);
            gi.line(switchLines);
            gi.line(
              `      default: ${ctx.pushErrorStmt(
                `${NAMES.DEPS}.createLeafError(` +
                  `${quoteString("discriminator")}, [...${ctx.path}, ${propLit}], ` +
                  `\`discriminator value "\${${discVal}}" does not match any branch\`, ` +
                  `{ propertyName: ${propLit}, value: ${discVal} })`,
              )}`,
            );
            gi.line(`    }`);
          },
        );
      },
    );
  },
};
