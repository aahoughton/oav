import { NAMES, quoteString } from "../codegen/index.js";
import type { SchemaOrBoolean } from "@oav/core";
import type { KeywordCompileContext, KeywordDefinition } from "./types.js";

const APPLICATOR_VOCAB = "https://json-schema.org/draft/2020-12/vocab/applicator";

/**
 * The `allOf` keyword. Every subschema must validate. Children of the
 * produced error are the failing conjuncts.
 *
 * @public
 */
export const allOfKeyword: KeywordDefinition = {
  keyword: "allOf",
  vocabulary: APPLICATOR_VOCAB,
  applicator: true,
  compile(ctx: KeywordCompileContext): void {
    const schemas = ctx.schema as SchemaOrBoolean[];
    if (schemas.length === 0) return;
    const errsVar = ctx.gen.scope.name("allOfErrs");
    ctx.gen.const(errsVar, "[]");
    schemas.forEach((sub) => {
      const fn = ctx.subschema(sub);
      const errVar = ctx.gen.scope.name("e");
      ctx.gen.const(errVar, `${fn}(${ctx.data}, ${ctx.path})`);
      ctx.gen.if(`${errVar} !== null`, (g) => g.line(`${errsVar}.push(${errVar});`));
    });
    const n = schemas.length;
    ctx.gen.if(`${errsVar}.length > 0`, (g) => {
      g.line(
        `${ctx.errors}.push(${NAMES.DEPS}.createBranchError(` +
          `${quoteString("allOf")}, ${ctx.path}, ` +
          `\`must satisfy all ${n} schemas (\${${errsVar}.length} failed)\`, ` +
          `${errsVar}, { total: ${n}, failed: ${errsVar}.length }));`,
      );
    });
  },
};

/**
 * The `anyOf` keyword. At least one subschema must validate. Children of the
 * produced error (emitted only when NONE match) are the branch errors.
 *
 * @public
 */
export const anyOfKeyword: KeywordDefinition = {
  keyword: "anyOf",
  vocabulary: APPLICATOR_VOCAB,
  applicator: true,
  compile(ctx: KeywordCompileContext): void {
    const schemas = ctx.schema as SchemaOrBoolean[];
    if (schemas.length === 0) return;
    const errsVar = ctx.gen.scope.name("anyOfErrs");
    const matched = ctx.gen.scope.name("matched");
    ctx.gen.const(errsVar, "[]");
    ctx.gen.let(matched, "false");
    schemas.forEach((sub) => {
      const fn = ctx.subschema(sub);
      const errVar = ctx.gen.scope.name("e");
      ctx.gen.const(errVar, `${fn}(${ctx.data}, ${ctx.path})`);
      ctx.gen.if(
        `${errVar} === null`,
        (g) => g.line(`${matched} = true;`),
        (g) => g.line(`${errsVar}.push(${errVar});`),
      );
    });
    const n = schemas.length;
    ctx.gen.if(`!${matched}`, (g) => {
      g.line(
        `${ctx.errors}.push(${NAMES.DEPS}.createBranchError(` +
          `${quoteString("anyOf")}, ${ctx.path}, ` +
          `\`must match at least one of ${n} schemas\`, ` +
          `${errsVar}, { total: ${n} }));`,
      );
    });
  },
};

/**
 * The `oneOf` keyword. Exactly one subschema must validate. Children of the
 * produced error are the per-branch failures.
 *
 * @public
 */
export const oneOfKeyword: KeywordDefinition = {
  keyword: "oneOf",
  vocabulary: APPLICATOR_VOCAB,
  applicator: true,
  compile(ctx: KeywordCompileContext): void {
    const schemas = ctx.schema as SchemaOrBoolean[];
    if (schemas.length === 0) return;
    const errsVar = ctx.gen.scope.name("oneOfErrs");
    const matchCount = ctx.gen.scope.name("matched");
    ctx.gen.const(errsVar, "[]");
    ctx.gen.let(matchCount, "0");
    schemas.forEach((sub) => {
      const fn = ctx.subschema(sub);
      const errVar = ctx.gen.scope.name("e");
      ctx.gen.const(errVar, `${fn}(${ctx.data}, ${ctx.path})`);
      ctx.gen.if(
        `${errVar} === null`,
        (g) => g.line(`${matchCount} += 1;`),
        (g) => g.line(`${errsVar}.push(${errVar});`),
      );
    });
    const n = schemas.length;
    ctx.gen.if(`${matchCount} !== 1`, (g) => {
      g.line(
        `${ctx.errors}.push(${NAMES.DEPS}.createBranchError(` +
          `${quoteString("oneOf")}, ${ctx.path}, ` +
          `\`must match exactly one of ${n} schemas (matched \${${matchCount}})\`, ` +
          `${errsVar}, { total: ${n}, matchCount: ${matchCount} }));`,
      );
    });
  },
};

/**
 * The `not` keyword. Data must NOT validate against the subschema.
 *
 * @public
 */
export const notKeyword: KeywordDefinition = {
  keyword: "not",
  vocabulary: APPLICATOR_VOCAB,
  applicator: true,
  compile(ctx: KeywordCompileContext): void {
    const sub = ctx.schema as SchemaOrBoolean;
    const fn = ctx.subschema(sub);
    const errVar = ctx.gen.scope.name("notErr");
    ctx.gen.const(errVar, `${fn}(${ctx.data}, ${ctx.path})`);
    ctx.gen.if(`${errVar} === null`, (g) => {
      g.line(
        `${ctx.errors}.push(${NAMES.DEPS}.createLeafError(` +
          `${quoteString("not")}, ${ctx.path}, ` +
          `"must NOT match the schema", {}));`,
      );
    });
  },
};

/**
 * The `if` / `then` / `else` triplet. Handled as one keyword because the
 * three are semantically coupled: `if` branches into `then` (on match) or
 * `else` (on mismatch), and `if` itself emits no errors.
 *
 * @public
 */
export const ifThenElseKeyword: KeywordDefinition = {
  keyword: "if",
  vocabulary: APPLICATOR_VOCAB,
  applicator: true,
  implements: ["then", "else"],
  compile(ctx: KeywordCompileContext): void {
    const ifSchema = ctx.schema as SchemaOrBoolean;
    const thenSchema = ctx.parentSchema.then;
    const elseSchema = ctx.parentSchema.else;
    const ifFn = ctx.subschema(ifSchema);
    const ifErr = ctx.gen.scope.name("ifErr");
    ctx.gen.const(ifErr, `${ifFn}(${ctx.data}, ${ctx.path})`);
    ctx.gen.if(
      `${ifErr} === null`,
      (g) => {
        if (thenSchema !== undefined) {
          const tFn = ctx.subschema(thenSchema);
          const tErr = g.scope.name("thenErr");
          g.const(tErr, `${tFn}(${ctx.data}, ${ctx.path})`);
          g.if(`${tErr} !== null`, (gi) => gi.line(`${ctx.errors}.push(${tErr});`));
        }
      },
      (g) => {
        if (elseSchema !== undefined) {
          const eFn = ctx.subschema(elseSchema);
          const eErr = g.scope.name("elseErr");
          g.const(eErr, `${eFn}(${ctx.data}, ${ctx.path})`);
          g.if(`${eErr} !== null`, (gi) => gi.line(`${ctx.errors}.push(${eErr});`));
        }
      },
    );
  },
};

/**
 * The `dependentSchemas` keyword. When a given property is present, the
 * whole object is validated against the dependent subschema.
 *
 * @public
 */
export const dependentSchemasKeyword: KeywordDefinition = {
  keyword: "dependentSchemas",
  vocabulary: APPLICATOR_VOCAB,
  applicator: true,
  compile(ctx: KeywordCompileContext): void {
    const deps = ctx.schema as Record<string, SchemaOrBoolean>;
    ctx.gen.if(
      `typeof ${ctx.data} === "object" && ${ctx.data} !== null && !Array.isArray(${ctx.data})`,
      (g) => {
        for (const name of Object.keys(deps)) {
          const sub = deps[name];
          if (sub === undefined) continue;
          const fn = ctx.subschema(sub);
          const keyLit = quoteString(name);
          g.if(`Object.prototype.hasOwnProperty.call(${ctx.data}, ${keyLit})`, (gi) => {
            const errVar = gi.scope.name("e");
            gi.const(errVar, `${fn}(${ctx.data}, ${ctx.path})`);
            gi.if(`${errVar} !== null`, (gii) => gii.line(`${ctx.errors}.push(${errVar});`));
          });
        }
      },
    );
  },
};

/**
 * The `dependentRequired` keyword. When a given property is present, each
 * listed companion property must also be present.
 *
 * @public
 */
export const dependentRequiredKeyword: KeywordDefinition = {
  keyword: "dependentRequired",
  vocabulary: APPLICATOR_VOCAB,
  compile(ctx: KeywordCompileContext): void {
    const deps = ctx.schema as Record<string, string[]>;
    ctx.gen.if(
      `typeof ${ctx.data} === "object" && ${ctx.data} !== null && !Array.isArray(${ctx.data})`,
      (g) => {
        for (const trigger of Object.keys(deps)) {
          const required = deps[trigger];
          if (required === undefined) continue;
          const triggerLit = quoteString(trigger);
          g.if(`Object.prototype.hasOwnProperty.call(${ctx.data}, ${triggerLit})`, (gi) => {
            for (const prop of required) {
              const propLit = quoteString(prop);
              gi.if(`!Object.prototype.hasOwnProperty.call(${ctx.data}, ${propLit})`, (gii) => {
                gii.line(
                  `${ctx.errors}.push(${NAMES.DEPS}.createLeafError(` +
                    `${quoteString("dependentRequired")}, [...${ctx.path}, ${propLit}], ` +
                    `\`property "${prop}" is required when "${trigger}" is present\`, ` +
                    `{ trigger: ${triggerLit}, missing: ${propLit} }));`,
                );
              });
            }
          });
        }
      },
    );
  },
};
