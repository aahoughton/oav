import type { PathSegment, SchemaObject, SchemaOrBoolean, ValidationError } from "@oav/core";
import { CodeGen, NAMES } from "../codegen/index.js";
import type { Dialect, KeywordDefinition } from "../keywords/types.js";
import { createKeywordContext, emitPushStatement } from "../keywords/context.js";
import { createCustomKeywordDefinition, type CustomKeywordValidator } from "../keywords/custom.js";
import {
  createRefResolver,
  resolve,
  SchemaRegistry,
  type RefResolver,
  type ResolvedGraph,
} from "../resolve/index.js";
import {
  SUBSCHEMA_ARRAY_POSITIONS,
  SUBSCHEMA_MAP_POSITIONS,
  SUBSCHEMA_SINGLE_POSITIONS,
} from "../subschema-positions.js";
import { createDeps, type ValidatorDeps } from "./runtime.js";

/**
 * Result of compiling a JSON Schema 2020-12 document. The shape mirrors what
 * the user-facing validator in `@oav/validator` wants: a `{ valid, error? }`
 * object.
 *
 * @public
 */
export interface ValidationResult {
  valid: boolean;
  error?: ValidationError;
  /**
   * `true` when at least one error was dropped because the configured
   * `maxErrors` cap was hit. Only ever set on `{ valid: false }` results.
   */
  truncated?: boolean;
}

/**
 * Compile-time statistics about the generated validator. Exposed so
 * tests can assert on compiler behaviour (e.g. "did subschema inlining
 * fire?") without grepping the generated source.
 *
 * @public
 */
export interface CompileStats {
  /**
   * Number of named `validate_N` helper functions emitted. A schema
   * that gets fully inlined compiles to one function (`validate_0`);
   * subschemas that stay as functions each add one.
   */
  functionCount: number;
  /**
   * `true` iff the compiler actually emitted `evalProps` / `evalItems`
   * Set machinery anywhere in the generated source. When `false`, the
   * unevaluated-keys-gating optimisation is taking effect — the schema
   * doesn't use `unevaluatedProperties` / `unevaluatedItems`, so the
   * compiler suppressed the per-function Set allocation and merge loop.
   * Surfaced so tests can assert on the optimisation directly instead
   * of grepping the generated JS.
   */
  unevaluatedTrackingEmitted: boolean;
}

/**
 * The function returned by {@link compileSchema}. Call it with any JSON value
 * to validate against the original schema. An optional `startPath`
 * is prepended to every error's `path` — useful when the compiled
 * validator is embedded inside a larger traversal (e.g. the HTTP
 * validator prepends `["body"]`, `["query", name]`, etc.). The array
 * is cloned before use and never mutated.
 *
 * @public
 */
export type CompiledSchema = {
  validate: (data: unknown, startPath?: readonly PathSegment[]) => ValidationResult;
  /** The generated source. Exposed for debugging/snapshot testing only. */
  source: string;
  /** Compile-time stats about the generated validator. */
  stats: CompileStats;
};

/**
 * Options accepted by {@link compileSchema}.
 *
 * @public
 */
export interface CompileOptions {
  /**
   * The dialect to compile against. Pick one of the built-ins
   * (`jsonSchemaDialect`, `openapi31Dialect`, `oas30Dialect`) or
   * construct a custom {@link Dialect}.
   */
  dialect: Dialect;
  /** Additional external named schemas that `$ref` can resolve to. */
  external?: Map<string, SchemaOrBoolean>;
  /** Pre-registered format validators, keyed by format name. */
  formats?: Record<string, (value: string) => boolean>;
  /** Custom ref resolver — overrides the default (which resolves fragments within the root). */
  refResolver?: RefResolver;
  /**
   * Cap on the number of leaf errors collected per `validate()` call.
   * Defaults to `Number.POSITIVE_INFINITY` (collect everything).
   *
   * When set to a finite value:
   * - Once the cap is reached, further errors are dropped and
   *   {@link ValidationResult.truncated} is set on the returned result.
   * - Hot loops (array items, object properties, `allOf`/`anyOf`
   *   branches) short-circuit as soon as the budget is exhausted, so
   *   the CPU and memory cost of validating a huge payload is bounded.
   *
   * `maxErrors: 1` is the classic fast-fail mode.
   */
  maxErrors?: number;
  /**
   * User-registered keywords, keyed by keyword name. Each validator is
   * invoked whenever its name appears as a property in a schema object.
   * Custom names must not collide with a keyword already supplied by
   * the configured dialect.
   *
   * @example
   * ```ts
   * compileSchema(schema, {
   *   dialect: jsonSchemaDialect,
   *   keywords: {
   *     divisibleBy: (data, schemaValue) =>
   *       typeof data !== "number" || data % (schemaValue as number) === 0,
   *   },
   * });
   * ```
   */
  keywords?: Record<string, CustomKeywordValidator>;
}

/** @internal */
export interface CompileState {
  readonly gen: CodeGen;
  readonly byKeyword: Map<string, KeywordDefinition>;
  readonly ordered: KeywordDefinition[];
  readonly compiledFor: Map<SchemaOrBoolean, string>;
  readonly functionBodies: string[];
  readonly deps: ValidatorDeps;
  readonly refResolver: RefResolver;
  readonly graph: ResolvedGraph;
  readonly compileValidator: (schema: SchemaOrBoolean) => string;
  /**
   * `true` when a finite `maxErrors` was configured. Codegen uses this
   * to emit the extra budget checks — when errors are uncapped we emit
   * plain `errors.push` with no runtime overhead.
   */
  readonly gated: boolean;
  /**
   * OpenAPI 3.0 semantics. When `true`, schemas containing `$ref`
   * dispatch only `$ref` and ignore every other keyword.
   */
  readonly refSuppressesSiblings: boolean;
  /**
   * `true` when `unevaluatedProperties` or `unevaluatedItems` appears
   * anywhere in the root schema or any registered external schema. When
   * `false`, the compiler suppresses allocation of per-function
   * `evalProps` / `evalItems` Sets and the merge loop that threads them
   * back to the caller — machinery that's inert unless
   * `unevaluated*` actually consumes it. OpenAPI specs essentially
   * never use these keywords, so the false path is the common case.
   */
  readonly unevaluatedTracking: boolean;
  nextFn: number;
  /**
   * Set to `true` the first time any generated function actually
   * allocates an `evalProps` / `evalItems` Set. Surfaced in
   * {@link CompileStats.unevaluatedTrackingEmitted} so callers can
   * observe the gating optimisation's effect.
   */
  unevaluatedEmitted: boolean;
}

/**
 * Return `true` iff `schema` (or any schema reachable from it through
 * subschema-valued positions) contains the `unevaluatedProperties` or
 * `unevaluatedItems` keyword. The detector is the gate for the
 * evaluated-keys-Set machinery — when it's `false`, the compiler emits
 * a form that skips the per-function Set allocation entirely.
 */
function schemaUsesUnevaluated(schema: SchemaOrBoolean): boolean {
  const seen = new WeakSet<object>();
  const walk = (s: unknown): boolean => {
    if (typeof s !== "object" || s === null || Array.isArray(s)) return false;
    if (seen.has(s)) return false;
    seen.add(s);
    if ("unevaluatedProperties" in s || "unevaluatedItems" in s) return true;
    for (const key of SUBSCHEMA_SINGLE_POSITIONS) {
      if (key in s && walk((s as Record<string, unknown>)[key])) return true;
    }
    for (const key of SUBSCHEMA_ARRAY_POSITIONS) {
      const arr = (s as Record<string, unknown>)[key];
      if (Array.isArray(arr)) {
        for (const item of arr) if (walk(item)) return true;
      }
    }
    for (const key of SUBSCHEMA_MAP_POSITIONS) {
      const obj = (s as Record<string, unknown>)[key];
      if (obj !== null && typeof obj === "object" && !Array.isArray(obj)) {
        for (const v of Object.values(obj)) if (walk(v)) return true;
      }
    }
    return false;
  };
  return walk(schema);
}

/**
 * Compile a JSON Schema 2020-12 document into an executable validator.
 *
 * @param schema - The schema (object or boolean) to compile.
 * @param options - Vocabularies, formats, external schemas.
 * @returns A validator function plus the generated source.
 *
 * @example
 * ```ts
 * const v = compileSchema({ type: "number" }, { dialect: jsonSchemaDialect });
 * v.validate(1.5); // { valid: true }
 * v.validate("x"); // { valid: false, error: { code: "type", ... } }
 * ```
 *
 * @public
 */
export function compileSchema(schema: SchemaOrBoolean, options: CompileOptions): CompiledSchema {
  const byKeyword = new Map<string, KeywordDefinition>();
  const ordered: KeywordDefinition[] = [];
  for (const vocab of options.dialect.vocabularies) {
    for (const kw of vocab.keywords) {
      if (byKeyword.has(kw.keyword)) continue;
      byKeyword.set(kw.keyword, kw);
      ordered.push(kw);
    }
  }
  if (options.keywords) {
    for (const name of Object.keys(options.keywords)) {
      if (byKeyword.has(name)) {
        throw new Error(
          `custom keyword "${name}" conflicts with a built-in keyword from the configured vocabularies`,
        );
      }
      const def = createCustomKeywordDefinition(name);
      byKeyword.set(name, def);
      ordered.push(def);
    }
  }

  const maxErrors = options.maxErrors ?? Number.POSITIVE_INFINITY;
  const deps = createDeps(maxErrors);
  if (options.formats) {
    for (const name of Object.keys(options.formats)) {
      const fn = options.formats[name];
      if (fn !== undefined) deps.formats.set(name, fn);
    }
  }
  if (options.keywords) {
    for (const name of Object.keys(options.keywords)) {
      const fn = options.keywords[name];
      if (fn !== undefined) deps.customKeywords.set(name, fn);
    }
  }
  const registry = new SchemaRegistry();
  if (options.external !== undefined) {
    for (const [uri, ext] of options.external) registry.add(uri, ext);
  }
  const graph = resolve(schema, { registry });
  const refResolver = options.refResolver ?? createRefResolver(graph);

  // One-pass walk: does anything in this compile unit use
  // `unevaluatedProperties` / `unevaluatedItems`? Include external
  // schemas in the walk because a `$ref` can cross into them. A false
  // positive costs perf but not correctness; a miss would silently
  // disable tracking for a spec that needs it, so the walker's
  // subschema positions are kept conservative.
  let unevaluatedTracking = schemaUsesUnevaluated(schema);
  if (!unevaluatedTracking && options.external) {
    for (const ext of options.external.values()) {
      if (schemaUsesUnevaluated(ext)) {
        unevaluatedTracking = true;
        break;
      }
    }
  }

  const state: CompileState = {
    gen: new CodeGen(),
    byKeyword,
    ordered,
    compiledFor: new Map(),
    functionBodies: [],
    deps,
    refResolver,
    graph,
    nextFn: 0,
    gated: Number.isFinite(maxErrors),
    refSuppressesSiblings: options.dialect.rules.refSuppressesSiblings,
    unevaluatedTracking,
    unevaluatedEmitted: false,
    compileValidator(sub) {
      return compileValidator(sub, state);
    },
  };

  const rootName = compileValidator(schema, state);

  const wholeSource = assembleSource(state, rootName);
  const factory = new Function(NAMES.DEPS, wholeSource) as (deps: ValidatorDeps) => CompiledFactory;
  const { validate } = factory(deps);
  return {
    validate,
    source: wholeSource,
    stats: {
      functionCount: state.nextFn,
      unevaluatedTrackingEmitted: state.unevaluatedEmitted,
    },
  };
}

interface CompiledFactory {
  validate: (data: unknown, startPath?: readonly PathSegment[]) => ValidationResult;
}

function compileValidator(schema: SchemaOrBoolean, state: CompileState): string {
  const cached = state.compiledFor.get(schema);
  if (cached !== undefined) return cached;

  const name = `validate_${state.nextFn}`;
  state.nextFn += 1;
  state.compiledFor.set(schema, name);

  const body = buildFunctionBody(schema, state);
  state.functionBodies.push(
    `function ${name}(${NAMES.DATA}, ${NAMES.PATH}, ${NAMES.OUT_EVAL_PROPS}, ${NAMES.OUT_EVAL_ITEMS}) {\n${body}\n}`,
  );
  return name;
}

/**
 * Does `schema` contain any keyword that either evaluates properties
 * itself or might do so through a subschema? We use this to decide
 * whether a generated function needs to allocate evaluated-key sets.
 *
 * Short-circuits to `false` when {@link CompileState.unevaluatedTracking}
 * is off — a compile unit that never uses `unevaluatedProperties` has
 * nothing to consume the Sets, so allocating + merging them is pure
 * overhead.
 *
 * @internal
 */
function needsPropTracking(schema: SchemaObject, state: CompileState): boolean {
  if (!state.unevaluatedTracking) return false;
  return (
    "unevaluatedProperties" in schema ||
    "properties" in schema ||
    "patternProperties" in schema ||
    "additionalProperties" in schema ||
    "allOf" in schema ||
    "anyOf" in schema ||
    "oneOf" in schema ||
    "if" in schema ||
    "then" in schema ||
    "else" in schema ||
    "$ref" in schema ||
    "$dynamicRef" in schema ||
    "dependentSchemas" in schema
  );
}

/**
 * Mirror of {@link needsPropTracking} for array indices.
 *
 * @internal
 */
function needsItemTracking(schema: SchemaObject, state: CompileState): boolean {
  if (!state.unevaluatedTracking) return false;
  return (
    "unevaluatedItems" in schema ||
    "prefixItems" in schema ||
    "items" in schema ||
    "contains" in schema ||
    "allOf" in schema ||
    "anyOf" in schema ||
    "oneOf" in schema ||
    "if" in schema ||
    "then" in schema ||
    "else" in schema ||
    "$ref" in schema ||
    "$dynamicRef" in schema
  );
}

function buildFunctionBody(schema: SchemaOrBoolean, state: CompileState): string {
  const gen = new CodeGen();
  gen.indent();
  gen.const(NAMES.ERRORS, "[]");

  if (schema === true) {
    // no-op; always valid
  } else if (schema === false) {
    const falseErr = `${NAMES.DEPS}.createLeafError("false", ${NAMES.PATH}, "schema is false, nothing is valid")`;
    gen.line(emitPushStatement(NAMES.ERRORS, falseErr, state.gated));
  } else {
    const trackProps = needsPropTracking(schema, state);
    const trackItems = needsItemTracking(schema, state);
    let evaluatedPropertiesVar: string | null = null;
    let evaluatedItemsVar: string | null = null;
    if (trackProps) {
      evaluatedPropertiesVar = gen.scope.name("evalProps");
      gen.const(evaluatedPropertiesVar, "new Set()");
      state.unevaluatedEmitted = true;
    }
    if (trackItems) {
      evaluatedItemsVar = gen.scope.name("evalItems");
      gen.const(evaluatedItemsVar, "new Set()");
      state.unevaluatedEmitted = true;
    }
    compileSchemaKeywords(schema, gen, state, evaluatedPropertiesVar, evaluatedItemsVar);
    // Merge evaluated-key sets into the caller's out-parameters when the
    // caller is tracking. Runs regardless of errors — a keyword that
    // evaluated a key evaluated it, even if other keywords flagged the
    // data invalid.
    if (evaluatedPropertiesVar !== null) {
      gen.line(
        `if (${NAMES.OUT_EVAL_PROPS} !== undefined) { for (const k of ${evaluatedPropertiesVar}) ${NAMES.OUT_EVAL_PROPS}.add(k); }`,
      );
    }
    if (evaluatedItemsVar !== null) {
      gen.line(
        `if (${NAMES.OUT_EVAL_ITEMS} !== undefined) { for (const k of ${evaluatedItemsVar}) ${NAMES.OUT_EVAL_ITEMS}.add(k); }`,
      );
    }
  }

  gen.line(`return ${NAMES.DEPS}.wrapErrors("schema", ${NAMES.PATH}, ${NAMES.ERRORS});`);
  gen.dedent();
  return gen.toString();
}

function compileSchemaKeywords(
  schema: SchemaObject,
  gen: CodeGen,
  state: CompileState,
  evaluatedPropertiesVar: string | null,
  evaluatedItemsVar: string | null,
): void {
  const subCompiler = (subSchema: SchemaOrBoolean): string => compileValidator(subSchema, state);
  const currentBaseUri = state.graph.schemaBaseUri.get(schema) ?? state.graph.baseUri;
  const resolveRefToFunction = (ref: string): string => {
    const target = state.refResolver.resolve(ref, currentBaseUri);
    return compileValidator(target, state);
  };

  const runOrder = orderKeywordsForSchema(schema, state);
  // OAS 3.0: when `$ref` is present, every sibling keyword is ignored.
  const refOnly = state.refSuppressesSiblings && "$ref" in schema;
  const seen = new Set<string>();
  for (const kw of runOrder) {
    if (seen.has(kw.keyword)) continue;
    if (!(kw.keyword in schema)) continue;
    if (refOnly && kw.keyword !== "$ref") continue;
    const schemaValue = (schema as Record<string, unknown>)[kw.keyword];
    const ctx = createKeywordContext({
      gen,
      schema: schemaValue,
      parentSchema: schema,
      data: NAMES.DATA,
      path: NAMES.PATH,
      errors: NAMES.ERRORS,
      compileSubschema: subCompiler,
      resolveRef: resolveRefToFunction,
      evaluatedPropertiesVar,
      evaluatedItemsVar,
      gated: state.gated,
      byKeyword: state.byKeyword,
    });
    kw.compile(ctx);
    seen.add(kw.keyword);
    if (kw.implements) for (const impl of kw.implements) seen.add(impl);
  }
}

const UNEVALUATED_LAST = new Set(["unevaluatedProperties", "unevaluatedItems"]);

function orderKeywordsForSchema(schema: SchemaObject, state: CompileState): KeywordDefinition[] {
  const present = state.ordered.filter((kw) => kw.keyword in schema);
  const lead = present.filter((kw) => !UNEVALUATED_LAST.has(kw.keyword));
  const trail = present.filter((kw) => UNEVALUATED_LAST.has(kw.keyword));
  return [...lead, ...trail];
}

function assembleSource(state: CompileState, rootName: string): string {
  const parts: string[] = [];
  parts.push(`"use strict";`);
  parts.push("");
  parts.push(...state.functionBodies);
  parts.push("");
  parts.push(`function validate(${NAMES.DATA}, startPath) {`);
  if (state.gated) {
    // Reset the per-call budget and truncation flag so consecutive
    // validate() calls are independent.
    parts.push(`  ${NAMES.DEPS}.errorsRemaining = ${NAMES.DEPS}.maxErrors;`);
    parts.push(`  ${NAMES.DEPS}.truncated = false;`);
  }
  parts.push(
    `  const err = ${rootName}(${NAMES.DATA}, startPath !== undefined ? [...startPath] : []);`,
  );
  parts.push(`  if (err === null) return { valid: true };`);
  if (state.gated) {
    parts.push(
      `  if (${NAMES.DEPS}.truncated) return { valid: false, error: err, truncated: true };`,
    );
  }
  parts.push(`  return { valid: false, error: err };`);
  parts.push(`}`);
  parts.push("return { validate };");
  return parts.join("\n");
}
