import { NAMES, quoteString } from "../codegen/index.js";
import type { SchemaOrBoolean } from "@oav/core";
import type { KeywordCompileContext, KeywordDefinition } from "./types.js";
import { APPLICATOR_VOCAB } from "./vocabulary-uris.js";

function isObjectGuard(dataExpr: string): string {
  return `typeof ${dataExpr} === "object" && ${dataExpr} !== null && !Array.isArray(${dataExpr})`;
}

/**
 * The `properties` keyword. For each named property present in the data,
 * validate its value against the corresponding subschema.
 *
 * @public
 */
export const propertiesKeyword: KeywordDefinition = {
  keyword: "properties",
  vocabulary: APPLICATOR_VOCAB,
  applicator: true,
  compile(ctx: KeywordCompileContext): void {
    const props = ctx.schema as Record<string, SchemaOrBoolean>;
    ctx.gen.if(isObjectGuard(ctx.data), (g) => {
      for (const name of Object.keys(props)) {
        const subSchema = props[name];
        if (subSchema === undefined) continue;
        const keyLit = quoteString(name);
        g.if(`Object.prototype.hasOwnProperty.call(${ctx.data}, ${keyLit})`, (gi) => {
          ctx.validateSubschema(subSchema, `${ctx.data}[${keyLit}]`, { segment: keyLit });
          if (ctx.evaluatedPropertiesVar !== null) {
            gi.line(`${ctx.evaluatedPropertiesVar}.add(${keyLit});`);
          }
        });
      }
    });
  },
  evaluates: { properties: true },
};

/**
 * The `patternProperties` keyword. Keys matching each regex are validated
 * against the corresponding subschema. A single key may match multiple
 * patterns and be validated against each.
 *
 * @public
 */
export const patternPropertiesKeyword: KeywordDefinition = {
  keyword: "patternProperties",
  vocabulary: APPLICATOR_VOCAB,
  applicator: true,
  compile(ctx: KeywordCompileContext): void {
    const patterns = ctx.schema as Record<string, SchemaOrBoolean>;
    const entries = Object.keys(patterns);
    if (entries.length === 0) return;
    ctx.gen.if(isObjectGuard(ctx.data), (g) => {
      const subs: Array<{ regex: string; sub: SchemaOrBoolean | undefined }> = entries.map(
        (pattern) => {
          const subSchema = patterns[pattern];
          const patternLit = quoteString(pattern);
          const regexVar = g.scope.name("re");
          g.line(`const ${regexVar} = ${NAMES.DEPS}.compilePattern(${patternLit});`);
          return { regex: regexVar, sub: subSchema };
        },
      );
      const keyVar = g.scope.name("key");
      g.forIn(keyVar, ctx.data, (gi) => {
        for (const { regex, sub } of subs) {
          if (sub === undefined) continue;
          gi.if(`${regex}.test(${keyVar})`, (gii) => {
            ctx.validateSubschema(sub, `${ctx.data}[${keyVar}]`, { segment: keyVar });
            if (ctx.evaluatedPropertiesVar !== null) {
              gii.line(`${ctx.evaluatedPropertiesVar}.add(${keyVar});`);
            }
          });
        }
        ctx.emitBudgetBreak();
      });
    });
  },
  evaluates: { properties: true },
};

/**
 * The `additionalProperties` keyword. Validates every property NOT covered
 * by `properties` or `patternProperties` against the given subschema.
 *
 * @public
 */
export const additionalPropertiesKeyword: KeywordDefinition = {
  keyword: "additionalProperties",
  vocabulary: APPLICATOR_VOCAB,
  applicator: true,
  compile(ctx: KeywordCompileContext): void {
    const subSchema = ctx.schema as SchemaOrBoolean;
    const knownProps = Object.keys(ctx.parentSchema.properties ?? {});
    const patterns = Object.keys(ctx.parentSchema.patternProperties ?? {});
    const knownSet = knownProps.length > 0 ? JSON.stringify(knownProps) : "[]";
    const patternVars: string[] = [];
    ctx.gen.if(isObjectGuard(ctx.data), (g) => {
      for (const p of patterns) {
        const v = g.scope.name("re");
        const lit = quoteString(p);
        g.line(`const ${v} = ${NAMES.DEPS}.compilePattern(${lit});`);
        patternVars.push(v);
      }
      const known = ctx.hoistConstant(`new Set(${knownSet})`, "known");
      const key = g.scope.name("key");
      g.forIn(key, ctx.data, (gi) => {
        gi.if(`${known}.has(${key})`, (gii) => gii.line("continue;"));
        for (const v of patternVars) {
          gi.if(`${v}.test(${key})`, (gii) => gii.line("continue;"));
        }
        if (subSchema === true) {
          if (ctx.evaluatedPropertiesVar !== null) {
            gi.line(`${ctx.evaluatedPropertiesVar}.add(${key});`);
          }
          return;
        }
        if (subSchema === false) {
          ctx.withPathSegment(key, (base, seg) => {
            ctx.emitError(
              "leaf",
              `${NAMES.DEPS}.createLeafError(` +
                `${quoteString("additionalProperties")}, ${base}, ` +
                `\`additional property "\${${key}}" is not allowed\`, ` +
                `{ unexpected: ${key} }, ${seg})`,
            );
          });
          ctx.emitBudgetBreak();
          return;
        }
        ctx.validateSubschema(subSchema, `${ctx.data}[${key}]`, { segment: key });
        if (ctx.evaluatedPropertiesVar !== null) {
          gi.line(`${ctx.evaluatedPropertiesVar}.add(${key});`);
        }
        ctx.emitBudgetBreak();
      });
    });
  },
  evaluates: { properties: true },
};

/**
 * The `propertyNames` keyword. Each key name is validated as a string
 * against the given subschema.
 *
 * @public
 */
export const propertyNamesKeyword: KeywordDefinition = {
  keyword: "propertyNames",
  vocabulary: APPLICATOR_VOCAB,
  applicator: true,
  compile(ctx: KeywordCompileContext): void {
    const subSchema = ctx.schema as SchemaOrBoolean;
    ctx.gen.if(isObjectGuard(ctx.data), (g) => {
      const key = g.scope.name("key");
      g.forIn(key, ctx.data, () => {
        ctx.validateSubschema(subSchema, key, { segment: key });
        ctx.emitBudgetBreak();
      });
    });
  },
};
