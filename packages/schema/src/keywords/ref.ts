import { NAMES, quoteString } from "../codegen/index.js";
import type { KeywordCompileContext, KeywordDefinition } from "./types.js";
import { CORE_VOCAB } from "./vocabulary-uris.js";

/**
 * Emit a recursive (`$ref` back-edge) call wrapped in the `maxDepth`
 * guard. `deps.depth` is incremented in the condition and decremented on
 * both branches, so it tracks the current nesting depth and unwinds with
 * the native stack. When the cap is exceeded the call is skipped (the
 * stack stops growing) and a `depth` leaf error stands in for the
 * subtree that wasn't validated.
 */
function compileGuardedRefCall(
  ctx: KeywordCompileContext,
  fn: string,
  passProps: string,
  passItems: string,
): void {
  const deps = NAMES.DEPS;
  const cond = `++${deps}.depth > ${deps}.maxDepth`;
  if (ctx.predicate) {
    ctx.gen.if(
      cond,
      (g) => {
        g.line(`${deps}.depth -= 1;`);
        g.line("return false;");
      },
      (g) => {
        const okVar = g.scope.name("refOk");
        g.const(okVar, `${fn}(${ctx.data}, ${passProps}, ${passItems})`);
        g.line(`${deps}.depth -= 1;`);
        g.line(`if (!${okVar}) return false;`);
      },
    );
    return;
  }
  const msgExpr = "`data nesting exceeds the configured maxDepth (${" + deps + ".maxDepth})`";
  const depthErr = ctx.leafErrorExpr(quoteString("depth"), msgExpr, `{ limit: ${deps}.maxDepth }`);
  ctx.gen.if(
    cond,
    (g) => {
      g.line(`${deps}.depth -= 1;`);
      ctx.emitError("leaf", depthErr);
    },
    (g) => {
      const errVar = g.scope.name("refErr");
      g.const(errVar, `${fn}(${ctx.data}, ${ctx.path}, ${passProps}, ${passItems})`);
      g.line(`${deps}.depth -= 1;`);
      g.if(`${errVar} !== null`, () => ctx.emitError("lift", errVar));
    },
  );
}

function compileRefCall(ctx: KeywordCompileContext, ref: string): void {
  const fn = ctx.resolveRef(ref);
  // A $ref targets a single schema whose annotations (evaluated keys)
  // count toward the enclosing scope, so we thread the caller's
  // evaluated-key sets straight through.
  const passProps = ctx.evaluatedPropertiesVar ?? "undefined";
  const passItems = ctx.evaluatedItemsVar ?? "undefined";
  // Only recursive (cycle-closing) refs can grow the call stack without
  // bound, so the guard goes there and nowhere else; forward refs and
  // the uncapped default compile to a plain call.
  if (ctx.depthGated && ctx.isRecursiveRef(ref)) {
    compileGuardedRefCall(ctx, fn, passProps, passItems);
    return;
  }
  if (ctx.predicate) {
    ctx.gen.line(`if (!${fn}(${ctx.data}, ${passProps}, ${passItems})) return false;`);
    return;
  }
  const errVar = ctx.gen.scope.name("refErr");
  ctx.gen.const(errVar, `${fn}(${ctx.data}, ${ctx.path}, ${passProps}, ${passItems})`);
  ctx.gen.if(`${errVar} !== null`, () => ctx.emitError("lift", errVar));
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
 * `$dynamicAnchor` extension points this behaves exactly like `$ref`: the
 * anchor is resolved statically against the schema tree.
 *
 * @public
 */
export const dynamicRefKeyword: KeywordDefinition = {
  keyword: "$dynamicRef",
  vocabulary: CORE_VOCAB,
  partial:
    "resolves statically against the anchor map; runtime dynamic-scope rebinding is not implemented",
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
  annotation: true,
  compile(): void {
    // intentionally empty: anchor is consumed at resolve time
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
  annotation: true,
  compile(): void {
    // intentionally empty: anchor is consumed at resolve time
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
  annotation: true,
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
  annotation: true,
  compile(): void {
    // intentionally empty: resolved on demand via $ref
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
  annotation: true,
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
  annotation: true,
  compile(): void {
    // intentionally empty
  },
};
