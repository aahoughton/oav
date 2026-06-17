/**
 * Read-only introspection over the built-in keyword set: enumerate the
 * keywords a dialect dispatches, and read their classification flags
 * (`applicator` / `annotation` / `evaluates` / `implements`) off the
 * `@public` {@link KeywordDefinition}. For walking a schema's subschema
 * positions see {@link walkSubschemas}; for the `unevaluated*` gate see
 * `schemaUsesUnevaluated` (both also `@public`).
 *
 * This is the consumer-facing half of the keyword surface (reading
 * keyword metadata), distinct from the keyword-authoring surface
 * (defining keywords). Tooling that reasons about keywords (a linter, a
 * coverage check, the streaming validator's classifier) reads here; it
 * never needs the codegen internals.
 *
 * @packageDocumentation
 */

import type { Dialect, KeywordDefinition, Vocabulary } from "./keywords/types.js";
import { jsonSchemaDialect } from "./keywords/vocabulary.js";

/**
 * Flatten a vocabulary stack into a `name -> definition` map, first-wins
 * on a repeated keyword name.
 *
 * First-wins is not arbitrary: it is exactly the precedence the compiler
 * uses to build its dispatch table (see `compileSchema`), so a 3.0
 * compile's `oas30Vocabulary` (placed ahead of the 2020-12 validation
 * vocabulary) wins `type` / `maximum` / ... here too. Sharing this
 * builder between the compiler and {@link keywordDefinitions} keeps the
 * introspection registry from drifting out of step with what actually
 * dispatches.
 *
 * @internal
 */
export function buildKeywordMap(
  vocabularies: readonly Vocabulary[],
): Map<string, KeywordDefinition> {
  const byKeyword = new Map<string, KeywordDefinition>();
  for (const vocab of vocabularies) {
    for (const kw of vocab.keywords) {
      if (byKeyword.has(kw.keyword)) continue;
      byKeyword.set(kw.keyword, kw);
    }
  }
  return byKeyword;
}

const cache = new WeakMap<Dialect, ReadonlyMap<string, KeywordDefinition>>();

/**
 * The built-in keyword set a dialect dispatches, as a flat
 * `keyword name -> {@link KeywordDefinition}` map. Each definition
 * carries its classification flags (`applicator`, `annotation`,
 * `evaluates`, `implements`, `partial`), so a consumer can bucket every
 * keyword without re-deriving the vocabulary stack.
 *
 * The map mirrors the compiler's dispatch precedence: keywords are
 * flattened across the dialect's vocabularies in order, first-wins on a
 * repeated name. For {@link oas30Dialect} that means `get("type")`
 * returns the 3.0 `type` flavour (string-only, sibling `nullable`), not
 * the 2020-12 one, because `oas30Vocabulary` sits ahead of the standard
 * validation vocabulary in that dialect's stack.
 *
 * @param dialect - The dialect to enumerate. Defaults to
 *   {@link jsonSchemaDialect} (JSON Schema 2020-12). Pass
 *   {@link openapi31Dialect} or {@link oas30Dialect} for the OpenAPI
 *   keyword sets.
 * @returns A read-only map; the returned identity is memoized per
 *   dialect, so repeated calls with the same dialect return the same
 *   object.
 *
 * @public
 */
export function keywordDefinitions(
  dialect: Dialect = jsonSchemaDialect,
): ReadonlyMap<string, KeywordDefinition> {
  let map = cache.get(dialect);
  if (map === undefined) {
    map = buildKeywordMap(dialect.vocabularies);
    cache.set(dialect, map);
  }
  return map;
}
