import { NAMES, quoteString } from "../codegen/index.js";
import type { SchemaOrBoolean } from "@oav/core";
import type { KeywordCompileContext, KeywordDefinition } from "./types.js";

const APPLICATOR_VOCAB = "https://json-schema.org/draft/2020-12/vocab/applicator";

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
        const subFn = ctx.subschema(subSchema);
        const keyLit = quoteString(name);
        g.if(`Object.prototype.hasOwnProperty.call(${ctx.data}, ${keyLit})`, (gi) => {
          const errVar = gi.scope.name("e");
          gi.const(errVar, `${subFn}(${ctx.data}[${keyLit}], [...${ctx.path}, ${keyLit}])`);
          gi.if(`${errVar} !== null`, (gii) => {
            gii.line(`${ctx.errors}.push(${errVar});`);
          });
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
      const subs: Array<{ regex: string; fn: string }> = entries.map((pattern) => {
        const subSchema = patterns[pattern];
        if (subSchema === undefined) return { regex: quoteString(pattern), fn: "" };
        const fn = ctx.subschema(subSchema);
        const patternLit = quoteString(pattern);
        const regexVar = g.scope.name("re");
        g.line(
          `let ${regexVar} = ${NAMES.DEPS}.patterns.get(${patternLit}); ` +
            `if (${regexVar} === undefined) { ${regexVar} = new RegExp(${patternLit}, "u"); ${NAMES.DEPS}.patterns.set(${patternLit}, ${regexVar}); }`,
        );
        return { regex: regexVar, fn };
      });
      const keyVar = g.scope.name("key");
      g.forIn(keyVar, ctx.data, (gi) => {
        for (const { regex, fn } of subs) {
          if (fn === "") continue;
          gi.if(`${regex}.test(${keyVar})`, (gii) => {
            const errVar = gii.scope.name("e");
            gii.const(errVar, `${fn}(${ctx.data}[${keyVar}], [...${ctx.path}, ${keyVar}])`);
            gii.if(`${errVar} !== null`, (giii) => {
              giii.line(`${ctx.errors}.push(${errVar});`);
            });
            if (ctx.evaluatedPropertiesVar !== null) {
              gii.line(`${ctx.evaluatedPropertiesVar}.add(${keyVar});`);
            }
          });
        }
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
        g.line(
          `let ${v} = ${NAMES.DEPS}.patterns.get(${lit}); ` +
            `if (${v} === undefined) { ${v} = new RegExp(${lit}, "u"); ${NAMES.DEPS}.patterns.set(${lit}, ${v}); }`,
        );
        patternVars.push(v);
      }
      const known = g.scope.name("known");
      g.const(known, `new Set(${knownSet})`);
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
          gi.line(
            `${ctx.errors}.push(${NAMES.DEPS}.createLeafError(` +
              `${quoteString("additionalProperties")}, [...${ctx.path}, ${key}], ` +
              `\`additional property "\${${key}}" is not allowed\`, ` +
              `{ unexpected: ${key} }));`,
          );
          return;
        }
        const fn = ctx.subschema(subSchema);
        const errVar = gi.scope.name("e");
        gi.const(errVar, `${fn}(${ctx.data}[${key}], [...${ctx.path}, ${key}])`);
        gi.if(`${errVar} !== null`, (gii) => gii.line(`${ctx.errors}.push(${errVar});`));
        if (ctx.evaluatedPropertiesVar !== null) {
          gi.line(`${ctx.evaluatedPropertiesVar}.add(${key});`);
        }
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
    const fn = ctx.subschema(subSchema);
    ctx.gen.if(isObjectGuard(ctx.data), (g) => {
      const key = g.scope.name("key");
      g.forIn(key, ctx.data, (gi) => {
        const errVar = gi.scope.name("e");
        gi.const(errVar, `${fn}(${key}, [...${ctx.path}, ${key}])`);
        gi.if(`${errVar} !== null`, (gii) => gii.line(`${ctx.errors}.push(${errVar});`));
      });
    });
  },
};
