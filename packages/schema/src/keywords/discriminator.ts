import { NAMES, quoteString } from "../codegen/index.js";
import type { KeywordCompileContext, KeywordDefinition } from "./types.js";
import { APPLICATOR_VOCAB } from "./vocabulary-uris.js";

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
      const fn = ctx.compileSubschema(branch);
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
            if (ctx.predicate) {
              g.line("return false;");
              return;
            }
            ctx.withPathSegment(propLit, () => {
              ctx.emitError(
                "leaf",
                `${NAMES.DEPS}.createLeafError(` +
                  `${quoteString("discriminator")}, ${ctx.path}, ` +
                  `\`discriminator property "${propertyName}" must be a string\`, ` +
                  `{ propertyName: ${propLit} })`,
              );
            });
          },
          (gi) => {
            if (ctx.predicate) {
              // Predicate mode switch: each case calls its branch and
              // propagates a false return; default returns false.
              gi.line(`switch (${discVal}) {`);
              for (const { value, fn } of discFns) {
                gi.line(
                  `      case ${quoteString(value)}: if (!${fn}(${ctx.data})) return false; break;`,
                );
              }
              gi.line(`      default: return false;`);
              gi.line(`    }`);
              return;
            }
            // Discriminator routes to ONE branch. If it returns an error,
            // that's already a counted leaf from the sub-validator — lift
            // it (don't re-count). If the discriminator value matches no
            // branch, THAT error is a fresh leaf — gate it.
            const switchLines = discFns
              .map(
                ({ value, fn }) =>
                  `      case ${quoteString(value)}: { const e = ${fn}(${ctx.data}, ${ctx.path}); if (e !== null) ${ctx.errorStatement("lift", "e")} break; }`,
              )
              .join("\n");
            gi.line(`switch (${discVal}) {`);
            gi.line(switchLines);
            gi.line(`      default: {`);
            ctx.withPathSegment(propLit, () => {
              gi.line(
                ctx.errorStatement(
                  "leaf",
                  `${NAMES.DEPS}.createLeafError(` +
                    `${quoteString("discriminator")}, ${ctx.path}, ` +
                    `"discriminator value does not match any branch", ` +
                    `{ propertyName: ${propLit}, value: ${discVal} })`,
                ),
              );
            });
            gi.line(`      }`);
            gi.line(`    }`);
          },
        );
      },
    );
  },
};
