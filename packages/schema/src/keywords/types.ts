import type { SchemaObject, SchemaOrBoolean } from "@oav/core";
import type { CodeEmitter } from "../codegen/index.js";

/**
 * Runtime inputs exposed to generated validator source. Keyword authors
 * reference entries by name; the compiler wires the map into the new
 * Function's closure.
 *
 * @public
 */
export interface CompileRuntime {
  patterns: Map<string, RegExp>;
  formats: Map<string, (value: string) => boolean>;
}

/**
 * Which budget semantics to apply when pushing an error expression
 * onto the errors accumulator. See {@link KeywordCompileContext.emitError}.
 *
 * - `"leaf"` — fresh leaf error, counts against `maxErrors`.
 * - `"lift"` — already-counted error being propagated (unconditional push).
 *
 * @public
 */
export type ErrorKind = "leaf" | "lift";

/**
 * Options for {@link KeywordCompileContext.validateSubschema}.
 *
 * @public
 */
export interface ValidateSubschemaOptions {
  /**
   * Extra path segment to push onto `path` for the duration of this
   * subschema's traversal (e.g. an array index or property name).
   * Pass a JS expression — literal strings must be quoted.
   */
  segment?: string;
}

/**
 * The narrow context passed to each keyword's `compile()` function. Keyword
 * authors see only these names — no reference to the compiler, the full
 * vocabulary, or the validator instance.
 *
 * @public
 */
export interface KeywordCompileContext {
  /** Handle for emitting source into the current validator function. */
  readonly gen: CodeEmitter;
  /** The keyword's own schema value (e.g. `"number"` for `type`). */
  readonly schema: unknown;
  /** The whole surrounding schema object (so cross-keyword peeks are possible). */
  readonly parentSchema: SchemaObject;
  /** JS expression referring to the data variable at this scope (e.g. `"data"`). */
  readonly data: string;
  /** JS expression referring to the current path array (e.g. `"path"`). */
  readonly path: string;
  /** JS expression referring to the error accumulator (e.g. `"errors"`). */
  readonly errors: string;
  /**
   * Compile a nested subschema to its own function and return the
   * function's identifier. The returned name is callable with
   * `(data, path)` inside generated code. Use this when a keyword
   * needs the sub-validator's return value for its own logic —
   * composition keywords (`allOf`, `anyOf`, `oneOf`, `if`/`then`/
   * `else`) collect results per-branch to decide whether to emit a
   * top-level error. For the common "validate this subschema against
   * `dataExpr` and emit any errors" pattern, use
   * {@link KeywordCompileContext.validateSubschema} — it's simpler
   * and applies the subschema-inlining optimisation.
   */
  compileSubschema(schema: SchemaOrBoolean): string;
  /**
   * Resolve a `$ref` (absolute URI or fragment) to a compiled function
   * name. Used by `$ref` and `$dynamicRef` keywords.
   */
  resolveRef(ref: string): string;
  /** JS expression for the Set tracking evaluated properties, or `null`. */
  readonly evaluatedPropertiesVar: string | null;
  /** JS expression for the Set tracking evaluated items, or `null`. */
  readonly evaluatedItemsVar: string | null;
  /**
   * `true` when a finite `maxErrors` cap was configured. Keyword
   * authors usually don't need to read this directly — prefer
   * {@link KeywordCompileContext.emitError} /
   * {@link KeywordCompileContext.emitBudgetBreak} which inspect it.
   */
  readonly gated: boolean;
  /**
   * `true` when predicate mode is active — the compiled validator
   * returns `boolean` and constructs no error tree. Most keywords
   * don't need to read this directly: `emitError`,
   * `errorStatement`, `withPathSegment`, and `validateSubschema` all
   * do the right thing automatically. Composition-style keywords
   * that inspect a sub-validator's return value for their own
   * control flow (`allOf`, `anyOf`, `oneOf`, `not`, `if/then/else`,
   * `$ref`, `contains`, `discriminator`, `dependentSchemas`) must
   * branch on this flag — sub-validators in predicate mode return
   * `boolean`, not `ValidationError | null`, and don't take a
   * `path` argument.
   */
  readonly predicate: boolean;
  /**
   * Emit an error-push statement directly into the current code
   * generator. Pick the right `kind` based on where the error
   * expression came from:
   *
   * - `"leaf"` — freshly-minted leaf error, created in this call.
   *   Counts against the `maxErrors` budget when one is configured;
   *   short-circuits cleanly when the cap has been hit.
   * - `"lift"` — an already-counted error being propagated up the
   *   tree (a sub-validator's return value) or a branch wrapper
   *   around already-counted children (`createBranchError`). Always
   *   unconditional — never touches the budget counter.
   *
   * Using the wrong kind silently miscounts errors against the
   * budget, so think about it each time. TypeScript enforces that you
   * supply one of the two names; the intent of the choice is on you.
   */
  emitError(kind: ErrorKind, errExpr: string): void;
  /**
   * String form of {@link KeywordCompileContext.emitError} — returns
   * the statement instead of emitting it. Useful inside compound
   * source like a `switch` body, where the push appears inline in a
   * larger `gen.line(...)` call.
   */
  errorStatement(kind: ErrorKind, errExpr: string): string;
  /**
   * Build a budget-guarded `break;` statement for use at the bottom of
   * hot loops (array items / property keys / applicator branches).
   * Returns `""` when uncapped so callers can emit it unconditionally.
   */
  budgetBreakStatement(): string;
  /**
   * Emit the statement from
   * {@link KeywordCompileContext.budgetBreakStatement} directly into
   * the current code generator. Useful at the tail of loops so they
   * short-circuit once the error cap is hit.
   */
  emitBudgetBreak(): void;
  /**
   * Emit validation for a subschema against `dataExpr`, writing any
   * errors into the current scope's accumulator. When `segment` is
   * provided, wraps the emission in a `path.push(seg) … path.pop()`
   * pair so the shared-mutable `path` array carries the extra segment
   * only for the duration of this subschema's traversal.
   *
   * When the subschema is simple enough — a boolean, or a single
   * validation keyword from a safe whitelist — the keyword's code is
   * inlined directly, avoiding the per-call function dispatch. For
   * anything more complex, it falls back to compiling the subschema
   * into a named function and emitting the usual call + lift. Either
   * way the path is reused, not re-allocated.
   *
   * This is the right helper for the common "descend into a
   * subschema and emit any errors" pattern — used by `properties`,
   * `items`, `additionalProperties`, etc. Composition keywords that
   * need the sub-validator's return value for their own logic
   * (`allOf`, `anyOf`, `oneOf`, …) should call
   * {@link KeywordCompileContext.compileSubschema} instead.
   */
  validateSubschema(
    schema: SchemaOrBoolean,
    dataExpr: string,
    options?: ValidateSubschemaOptions,
  ): void;
  /**
   * Emit `path.push(segmentExpr); <body>; path.pop();` into the current
   * code generator. Use when a keyword needs to emit errors whose path
   * includes an extra segment (e.g. `required` reports a missing
   * property at `[...path, missingKey]`).
   *
   * Every runtime error-creation helper snapshots `path` before
   * committing it to the `ValidationError`, so errors emitted inside
   * `body` retain the correct path even after the `pop`.
   */
  withPathSegment(segmentExpr: string, body: () => void): void;
}

/**
 * Definition of a single schema keyword that plugs into a {@link Vocabulary}.
 *
 * @public
 */
export interface KeywordDefinition {
  /** The keyword name (e.g. `"type"`, `"properties"`). */
  keyword: string;
  /** The vocabulary URI this keyword belongs to. */
  vocabulary: string;
  /** Generate validation code for this keyword. */
  compile: (ctx: KeywordCompileContext) => void;
  /** Other keywords this keyword depends on (all must be compiled first). */
  dependsOn?: string[];
  /** Keywords this keyword semantically implements (compiler skips those). */
  implements?: string[];
  /** If set, this keyword runs before the named keyword. */
  before?: string;
  /** Marks whether this keyword tracks evaluated properties/items. */
  evaluates?: { properties?: boolean; items?: boolean };
  /** When `true`, indicates the keyword takes subschemas (applicator). */
  applicator?: boolean;
  /**
   * When `true`, declares this keyword to be pure annotation/metadata —
   * it emits no runtime validation code. Annotation keywords can coexist
   * with inlineable keywords without disqualifying the schema. Used by
   * the subschema inliner to decide which keys to skip when counting
   * "real" validation keywords. A keyword defining `annotation: true`
   * should also have an empty `compile`.
   */
  annotation?: boolean;
}

/**
 * A collection of keywords under a single vocabulary URI.
 *
 * @public
 */
export interface Vocabulary {
  /** Vocabulary URI (per JSON Schema spec). */
  uri: string;
  /** Ordered list of keyword definitions. */
  keywords: KeywordDefinition[];
}

/**
 * Keyword-dispatcher rules that vary between dialects. Fields go here
 * when a dialect difference can't be expressed as a keyword override
 * (i.e. it operates above the vocabulary level).
 *
 * @public
 */
export interface DialectRules {
  /**
   * OpenAPI 3.0 semantics: when a schema has `$ref`, every sibling
   * keyword is ignored. Default `false` (JSON Schema 2020-12 and
   * OpenAPI 3.1+ semantics, where siblings are honoured).
   */
  refSuppressesSiblings: boolean;
}

/**
 * A compile-time dialect: a vocabulary stack plus the dispatcher rules
 * that make it coherent. Every call to `compileSchema` picks exactly
 * one dialect. The built-in dialects are {@link jsonSchemaDialect},
 * {@link openapi31Dialect}, and {@link oas30Dialect}.
 *
 * @public
 */
export interface Dialect {
  /** Short identifier for debugging / introspection (e.g. `"oas3.0"`). */
  readonly id: string;
  /** Vocabularies whose keywords are available during compile. */
  readonly vocabularies: readonly Vocabulary[];
  /** Keyword-dispatcher rules (currently just `refSuppressesSiblings`). */
  readonly rules: DialectRules;
}
