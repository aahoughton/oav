import type { SchemaObject, SchemaOrBoolean } from "@oav/core";
import type { CodeGen } from "../codegen/index.js";

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
  readonly gen: CodeGen;
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
