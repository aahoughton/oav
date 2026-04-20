/**
 * Known JSON Schema 2020-12 (+ OpenAPI) positions that hold a single
 * subschema. Used by any tree-walker that needs to descend only through
 * schema-valued fields, not arbitrary user data in `enum` / `const` /
 * `default` / `examples`.
 *
 * @internal
 */
export const SUBSCHEMA_SINGLE_POSITIONS = [
  "additionalProperties",
  "propertyNames",
  "contains",
  "not",
  "if",
  "then",
  "else",
  "items",
  "unevaluatedProperties",
  "unevaluatedItems",
] as const;

/**
 * Known JSON Schema 2020-12 positions that hold an array of subschemas.
 *
 * @internal
 */
export const SUBSCHEMA_ARRAY_POSITIONS = ["allOf", "anyOf", "oneOf", "prefixItems"] as const;

/**
 * Known JSON Schema 2020-12 positions that hold a `string -> subschema`
 * map. Callers that treat `properties` specially (e.g. validator's
 * direction transform) should filter it out themselves — it's included
 * here so generic walkers see the complete set of schema positions.
 *
 * @internal
 */
export const SUBSCHEMA_MAP_POSITIONS = [
  "properties",
  "patternProperties",
  "dependentSchemas",
  "$defs",
  "definitions",
] as const;
