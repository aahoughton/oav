import { quoteString } from "../codegen/index.js";
import type { SchemaOrBoolean } from "@oav/core";
import type { KeywordCompileContext, KeywordDefinition } from "./types.js";
import { APPLICATOR_VOCAB } from "./vocabulary-uris.js";

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
    const outProps = ctx.evaluatedPropertiesVar;
    const outItems = ctx.evaluatedItemsVar;
    // Tree mode collects per-branch errors; predicate short-circuits
    // on first failure so there's nothing to collect.
    const errsVar = ctx.predicate ? null : ctx.gen.scope.name("allOfErrs");
    if (errsVar !== null) ctx.gen.const(errsVar, "[]");
    schemas.forEach((sub) => {
      ctx.compileAndCallSubschema(sub, {
        data: ctx.data,
        onPass: (g, bProps, bItems) => {
          if (outProps !== null && bProps !== null) {
            g.line(`for (const k of ${bProps}) ${outProps}.add(k);`);
          }
          if (outItems !== null && bItems !== null) {
            g.line(`for (const k of ${bItems}) ${outItems}.add(k);`);
          }
        },
        onFail: (g, errVar) => {
          if (errVar === null) g.line("return false;");
          else g.line(`${errsVar}.push(${errVar});`);
        },
      });
    });
    if (errsVar !== null) {
      const n = schemas.length;
      ctx.gen.if(`${errsVar}.length > 0`, () => {
        ctx.emitError(
          "lift",
          ctx.branchErrorExpr(
            quoteString("allOf"),
            `\`must satisfy all ${n} schemas (\${${errsVar}.length} failed)\``,
            errsVar,
            `{ total: ${n}, failed: ${errsVar}.length }`,
          ),
        );
      });
    }
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
    const outProps = ctx.evaluatedPropertiesVar;
    const outItems = ctx.evaluatedItemsVar;
    const matched = ctx.gen.scope.name("matched");
    ctx.gen.let(matched, "false");
    // Tree mode collects per-branch errors for the final anyOf node;
    // predicate returns false after the loop if none matched.
    const errsVar = ctx.predicate ? null : ctx.gen.scope.name("anyOfErrs");
    if (errsVar !== null) ctx.gen.const(errsVar, "[]");
    schemas.forEach((sub) => {
      ctx.compileAndCallSubschema(sub, {
        data: ctx.data,
        onPass: (g, bProps, bItems) => {
          g.line(`${matched} = true;`);
          if (outProps !== null && bProps !== null) {
            g.line(`for (const k of ${bProps}) ${outProps}.add(k);`);
          }
          if (outItems !== null && bItems !== null) {
            g.line(`for (const k of ${bItems}) ${outItems}.add(k);`);
          }
        },
        onFail: (g, errVar) => {
          if (errVar !== null) g.line(`${errsVar}.push(${errVar});`);
          // predicate mode: no-op, the final `!matched` check handles it
        },
      });
    });
    const n = schemas.length;
    if (ctx.predicate) {
      ctx.gen.line(`if (!${matched}) return false;`);
      return;
    }
    ctx.gen.if(`!${matched}`, () => {
      ctx.emitError(
        "lift",
        ctx.branchErrorExpr(
          quoteString("anyOf"),
          `\`must match at least one of ${n} schemas\``,
          errsVar!,
          `{ total: ${n} }`,
        ),
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
    const outProps = ctx.evaluatedPropertiesVar;
    const outItems = ctx.evaluatedItemsVar;
    if (ctx.predicate) {
      // Predicate mode: count branch matches; bail with `return false`
      // on the second match (>1 disallowed) or if fewer than 1
      // succeed. Evaluated keys from the single passing branch merge
      // into the caller. We buffer them per-branch and only commit
      // once we know we had exactly one match.
      const matchCount = ctx.gen.scope.name("oneOfMatched");
      ctx.gen.let(matchCount, "0");
      const keepProps = outProps !== null ? ctx.gen.scope.name("oneOfProps") : null;
      const keepItems = outItems !== null ? ctx.gen.scope.name("oneOfItems") : null;
      if (keepProps !== null) ctx.gen.let(keepProps, "null");
      if (keepItems !== null) ctx.gen.let(keepItems, "null");
      schemas.forEach((sub) => {
        const fn = ctx.compileSubschema(sub);
        if (outProps === null && outItems === null) {
          ctx.gen.if(`${fn}(${ctx.data})`, (g) => {
            g.line(`${matchCount} += 1;`);
            g.line(`if (${matchCount} > 1) return false;`);
          });
          return;
        }
        const propsVar = ctx.gen.scope.name("bProps");
        const itemsVar = ctx.gen.scope.name("bItems");
        ctx.gen.const(propsVar, outProps !== null ? "new Set()" : "undefined");
        ctx.gen.const(itemsVar, outItems !== null ? "new Set()" : "undefined");
        ctx.gen.if(`${fn}(${ctx.data}, ${propsVar}, ${itemsVar})`, (g) => {
          g.line(`${matchCount} += 1;`);
          g.line(`if (${matchCount} > 1) return false;`);
          if (keepProps !== null) g.line(`${keepProps} = ${propsVar};`);
          if (keepItems !== null) g.line(`${keepItems} = ${itemsVar};`);
        });
      });
      ctx.gen.line(`if (${matchCount} !== 1) return false;`);
      if (keepProps !== null && outProps !== null) {
        ctx.gen.line(
          `if (${keepProps} !== null) for (const k of ${keepProps}) ${outProps}.add(k);`,
        );
      }
      if (keepItems !== null && outItems !== null) {
        ctx.gen.line(
          `if (${keepItems} !== null) for (const k of ${keepItems}) ${outItems}.add(k);`,
        );
      }
      return;
    }
    const errsVar = ctx.gen.scope.name("oneOfErrs");
    const matchCount = ctx.gen.scope.name("matched");
    ctx.gen.const(errsVar, "[]");
    ctx.gen.let(matchCount, "0");
    schemas.forEach((sub) => {
      const fn = ctx.compileSubschema(sub);
      const errVar = ctx.gen.scope.name("e");
      if (outProps === null && outItems === null) {
        ctx.gen.const(errVar, `${fn}(${ctx.data}, ${ctx.path})`);
        ctx.gen.if(
          `${errVar} === null`,
          (g) => g.line(`${matchCount} += 1;`),
          (g) => g.line(`${errsVar}.push(${errVar});`),
        );
        return;
      }
      const propsVar = ctx.gen.scope.name("bProps");
      const itemsVar = ctx.gen.scope.name("bItems");
      ctx.gen.const(propsVar, outProps !== null ? "new Set()" : "undefined");
      ctx.gen.const(itemsVar, outItems !== null ? "new Set()" : "undefined");
      ctx.gen.const(errVar, `${fn}(${ctx.data}, ${ctx.path}, ${propsVar}, ${itemsVar})`);
      ctx.gen.if(
        `${errVar} === null`,
        (g) => {
          g.line(`${matchCount} += 1;`);
          if (outProps !== null) g.line(`for (const k of ${propsVar}) ${outProps}.add(k);`);
          if (outItems !== null) g.line(`for (const k of ${itemsVar}) ${outItems}.add(k);`);
        },
        (g) => g.line(`${errsVar}.push(${errVar});`),
      );
    });
    const n = schemas.length;
    ctx.gen.if(`${matchCount} !== 1`, () => {
      ctx.emitError(
        "lift",
        ctx.branchErrorExpr(
          quoteString("oneOf"),
          `\`must match exactly one of ${n} schemas (matched \${${matchCount}})\``,
          errsVar,
          `{ total: ${n}, matchCount: ${matchCount} }`,
        ),
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
    const fn = ctx.compileSubschema(sub);
    if (ctx.predicate) {
      // If the sub validates, `not` fails; short-circuit.
      ctx.gen.line(`if (${fn}(${ctx.data})) return false;`);
      return;
    }
    const errVar = ctx.gen.scope.name("notErr");
    ctx.gen.const(errVar, `${fn}(${ctx.data}, ${ctx.path})`);
    ctx.gen.if(`${errVar} === null`, () => {
      ctx.emitError(
        "leaf",
        ctx.leafErrorExpr(quoteString("not"), `"must NOT match the schema"`, `{}`),
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
    const ifFn = ctx.compileSubschema(ifSchema);
    const outProps = ctx.evaluatedPropertiesVar;
    const outItems = ctx.evaluatedItemsVar;
    const ifProps = ctx.gen.scope.name("ifProps");
    const ifItems = ctx.gen.scope.name("ifItems");
    ctx.gen.const(ifProps, outProps !== null ? "new Set()" : "undefined");
    ctx.gen.const(ifItems, outItems !== null ? "new Set()" : "undefined");
    const passProps = outProps ?? "undefined";
    const passItems = outItems ?? "undefined";
    if (ctx.predicate) {
      // Predicate mode: `if` never emits an error itself; it branches
      // into `then` or `else`. When `if` matches, merge its annotations
      // into the caller before running `then`.
      ctx.gen.if(
        `${ifFn}(${ctx.data}, ${ifProps}, ${ifItems})`,
        (g) => {
          if (outProps !== null) g.line(`for (const k of ${ifProps}) ${outProps}.add(k);`);
          if (outItems !== null) g.line(`for (const k of ${ifItems}) ${outItems}.add(k);`);
          if (thenSchema !== undefined) {
            const tFn = ctx.compileSubschema(thenSchema);
            g.line(`if (!${tFn}(${ctx.data}, ${passProps}, ${passItems})) return false;`);
          }
        },
        (g) => {
          if (elseSchema !== undefined) {
            const eFn = ctx.compileSubschema(elseSchema);
            g.line(`if (!${eFn}(${ctx.data}, ${passProps}, ${passItems})) return false;`);
          }
        },
      );
      return;
    }
    const ifErr = ctx.gen.scope.name("ifErr");
    // Per 2020-12: annotations from `if` are preserved when `if` passes
    // and merged into the enclosing scope alongside `then`'s. Give `if`
    // its own Set so failing runs don't leak keys into `else`'s path.
    ctx.gen.const(ifErr, `${ifFn}(${ctx.data}, ${ctx.path}, ${ifProps}, ${ifItems})`);
    ctx.gen.if(
      `${ifErr} === null`,
      (g) => {
        if (outProps !== null) g.line(`for (const k of ${ifProps}) ${outProps}.add(k);`);
        if (outItems !== null) g.line(`for (const k of ${ifItems}) ${outItems}.add(k);`);
        if (thenSchema !== undefined) {
          const tFn = ctx.compileSubschema(thenSchema);
          const tErr = g.scope.name("thenErr");
          g.const(tErr, `${tFn}(${ctx.data}, ${ctx.path}, ${passProps}, ${passItems})`);
          g.if(`${tErr} !== null`, () => ctx.emitError("lift", tErr));
        }
      },
      (g) => {
        if (elseSchema !== undefined) {
          const eFn = ctx.compileSubschema(elseSchema);
          const eErr = g.scope.name("elseErr");
          g.const(eErr, `${eFn}(${ctx.data}, ${ctx.path}, ${passProps}, ${passItems})`);
          g.if(`${eErr} !== null`, () => ctx.emitError("lift", eErr));
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
        const passProps = ctx.evaluatedPropertiesVar ?? "undefined";
        const passItems = ctx.evaluatedItemsVar ?? "undefined";
        for (const name of Object.keys(deps)) {
          const sub = deps[name];
          if (sub === undefined) continue;
          const fn = ctx.compileSubschema(sub);
          const keyLit = quoteString(name);
          g.if(`Object.prototype.hasOwnProperty.call(${ctx.data}, ${keyLit})`, (gi) => {
            if (ctx.predicate) {
              gi.line(`if (!${fn}(${ctx.data}, ${passProps}, ${passItems})) return false;`);
              return;
            }
            const errVar = gi.scope.name("e");
            gi.const(errVar, `${fn}(${ctx.data}, ${ctx.path}, ${passProps}, ${passItems})`);
            gi.if(`${errVar} !== null`, () => ctx.emitError("lift", errVar));
          });
        }
      },
    );
  },
};

/**
 * The draft-07-compat `dependencies` keyword. Dispatches per entry:
 * array values get `dependentRequired` semantics; object/boolean
 * values get `dependentSchemas` semantics. Kept as a distinct
 * keyword so schemas authored against older drafts but served under
 * a 2020-12 dialect still validate.
 *
 * @public
 */
export const dependenciesKeyword: KeywordDefinition = {
  keyword: "dependencies",
  vocabulary: APPLICATOR_VOCAB,
  applicator: true,
  compile(ctx: KeywordCompileContext): void {
    const deps = ctx.schema as Record<string, string[] | SchemaOrBoolean>;
    ctx.gen.if(
      `typeof ${ctx.data} === "object" && ${ctx.data} !== null && !Array.isArray(${ctx.data})`,
      (g) => {
        for (const trigger of Object.keys(deps)) {
          const entry = deps[trigger];
          if (entry === undefined) continue;
          const triggerLit = quoteString(trigger);
          if (Array.isArray(entry)) {
            // Array form → required-property semantics.
            g.if(`Object.prototype.hasOwnProperty.call(${ctx.data}, ${triggerLit})`, (gi) => {
              for (const prop of entry) {
                const propLit = quoteString(prop);
                gi.if(`!Object.prototype.hasOwnProperty.call(${ctx.data}, ${propLit})`, () => {
                  ctx.emitError(
                    "leaf",
                    ctx.leafErrorExpr(
                      quoteString("dependencies"),
                      quoteString(`property "${prop}" is required when "${trigger}" is present`),
                      `{ trigger: ${triggerLit}, missing: ${propLit} }`,
                      [propLit],
                    ),
                  );
                });
              }
            });
          } else {
            // Schema form → dependent-schema semantics.
            const fn = ctx.compileSubschema(entry);
            g.if(`Object.prototype.hasOwnProperty.call(${ctx.data}, ${triggerLit})`, (gi) => {
              if (ctx.predicate) {
                gi.line(`if (!${fn}(${ctx.data})) return false;`);
                return;
              }
              const errVar = gi.scope.name("e");
              gi.const(errVar, `${fn}(${ctx.data}, ${ctx.path})`);
              gi.if(`${errVar} !== null`, () => ctx.emitError("lift", errVar));
            });
          }
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
              gi.if(`!Object.prototype.hasOwnProperty.call(${ctx.data}, ${propLit})`, () => {
                ctx.emitError(
                  "leaf",
                  ctx.leafErrorExpr(
                    quoteString("dependentRequired"),
                    quoteString(`property "${prop}" is required when "${trigger}" is present`),
                    `{ trigger: ${triggerLit}, missing: ${propLit} }`,
                    [propLit],
                  ),
                );
              });
            }
          });
        }
      },
    );
  },
};
