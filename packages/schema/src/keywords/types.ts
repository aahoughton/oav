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
 * Parameters that describe an error a keyword wants to emit.
 *
 * @public
 */
export interface EmitErrorParams {
  /** Stable error identifier (e.g. `"type"`, `"required"`). */
  code: string;
  /** Template-literal source for the message (no backticks). */
  message: string;
  /** Optional map of `params` entries as JS expression source. */
  params?: Record<string, string>;
  /** Optional JS expression producing an override path (defaults to the keyword's current data path). */
  pathExpr?: string;
  /** Optional JS expression producing the children array (defaults to `[]`). */
  childrenExpr?: string;
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
   * `(data, path)` inside generated code.
   */
  subschema(schema: SchemaOrBoolean): string;
  /**
   * Resolve a `$ref` (absolute URI or fragment) to a compiled function
   * name. Used by `$ref` and `$dynamicRef` keywords.
   */
  resolveRef(ref: string): string;
  /** Push a {@link EmitErrorParams | configured} error onto the accumulator. */
  error(params: EmitErrorParams): void;
  /** Mark a data property as evaluated (for `unevaluatedProperties`). */
  markPropertyEvaluated(nameExpr: string): void;
  /** Mark an array index range as evaluated (for `unevaluatedItems`). */
  markItemEvaluated(indexExpr: string): void;
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
   * errors into the current scope's accumulator. When `segmentExpr` is
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
   * Use this instead of hand-rolling the sub-call pattern inside
   * applicator keywords (items, properties, additionalProperties,
   * patternProperties, propertyNames, unevaluatedProperties/Items).
   */
  emitSubschemaValidation(schema: SchemaOrBoolean, dataExpr: string, segmentExpr?: string): void;
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
