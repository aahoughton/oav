import type { KeywordCompileContext, KeywordDefinition } from "./types.js";

const CORE_VOCAB = "https://json-schema.org/draft/2020-12/vocab/core";

function compileRefCall(ctx: KeywordCompileContext, ref: string): void {
  const fn = ctx.resolveRef(ref);
  const errVar = ctx.gen.scope.name("refErr");
  ctx.gen.const(errVar, `${fn}(${ctx.data}, ${ctx.path})`);
  ctx.gen.if(`${errVar} !== null`, (g) => {
    g.line(`${ctx.errors}.push(${errVar});`);
  });
}

/**
 * The JSON Schema 2020-12 `$ref` keyword. Resolves the reference to another
 * schema and delegates validation to its compiled function.
 *
 * Circular references are handled by the compiler's schema-identity cache:
 * the function name is reserved before the body is generated, so a recursive
 * `$ref` back to the enclosing schema compiles to a normal recursive call.
 *
 * @public
 */
export const refKeyword: KeywordDefinition = {
  keyword: "$ref",
  vocabulary: CORE_VOCAB,
  compile(ctx) {
    const ref = ctx.schema as string;
    compileRefCall(ctx, ref);
  },
};

/**
 * The JSON Schema 2020-12 `$dynamicRef` keyword. For schemas that do not use
 * `$dynamicAnchor` extension points this behaves exactly like `$ref` — the
 * anchor is resolved statically against the schema tree.
 *
 * @public
 */
export const dynamicRefKeyword: KeywordDefinition = {
  keyword: "$dynamicRef",
  vocabulary: CORE_VOCAB,
  compile(ctx) {
    const ref = ctx.schema as string;
    compileRefCall(ctx, ref);
  },
};

/**
 * Declarative `$dynamicAnchor` keyword. Collected during resolution; no
 * runtime code is emitted.
 *
 * @public
 */
export const dynamicAnchorKeyword: KeywordDefinition = {
  keyword: "$dynamicAnchor",
  vocabulary: CORE_VOCAB,
  compile(): void {
    // intentionally empty — anchor is consumed at resolve time
  },
};

/**
 * Declarative `$anchor` keyword. Collected during resolution; no runtime
 * code is emitted.
 *
 * @public
 */
export const anchorKeyword: KeywordDefinition = {
  keyword: "$anchor",
  vocabulary: CORE_VOCAB,
  compile(): void {
    // intentionally empty — anchor is consumed at resolve time
  },
};

/**
 * Declarative `$id` keyword. Collected during resolution; no runtime code
 * is emitted.
 *
 * @public
 */
export const idKeyword: KeywordDefinition = {
  keyword: "$id",
  vocabulary: CORE_VOCAB,
  compile(): void {
    // intentionally empty
  },
};

/**
 * Declarative `$defs` keyword. Its value is a record of subschemas
 * reachable via `$ref`; no runtime code is emitted.
 *
 * @public
 */
export const defsKeyword: KeywordDefinition = {
  keyword: "$defs",
  vocabulary: CORE_VOCAB,
  compile(): void {
    // intentionally empty — resolved on demand via $ref
  },
};

/**
 * Declarative `$schema` keyword. No runtime behavior.
 *
 * @public
 */
export const schemaDialectKeyword: KeywordDefinition = {
  keyword: "$schema",
  vocabulary: CORE_VOCAB,
  compile(): void {
    // intentionally empty
  },
};

/**
 * Declarative `$comment` keyword. No runtime behavior.
 *
 * @public
 */
export const commentKeyword: KeywordDefinition = {
  keyword: "$comment",
  vocabulary: CORE_VOCAB,
  compile(): void {
    // intentionally empty
  },
};
