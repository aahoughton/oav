import type { SchemaObject, SchemaOrBoolean } from "@oav/core";
import { SchemaRegistry } from "./registry.js";

/**
 * A resolved schema graph: the root schema plus lookup tables for every
 * $id / $anchor discovered during traversal. This is the input to the
 * compiler.
 *
 * @public
 */
export interface ResolvedGraph {
  /** The entry point schema. */
  root: SchemaOrBoolean;
  /** Base URI of the root schema (may be empty for anonymous schemas). */
  baseUri: string;
  /** Every `$id` discovered, mapped to the schema it labels. */
  byId: Map<string, SchemaOrBoolean>;
  /** Every `$anchor` discovered, mapped to the schema it labels. */
  byAnchor: Map<string, SchemaOrBoolean>;
  /** Every `$dynamicAnchor` discovered, mapped to the schema it labels. */
  byDynamicAnchor: Map<string, SchemaOrBoolean>;
  /** External schemas by URI (from the registry passed to {@link resolve}). */
  registry: SchemaRegistry;
}

/**
 * Options accepted by {@link resolve}.
 *
 * @public
 */
export interface ResolveOptions {
  /** Base URI to associate with the root schema. Defaults to `""`. */
  baseUri?: string;
  /** External schema registry. Additional `$id` / anchor entries are added to it. */
  registry?: SchemaRegistry;
}

/**
 * Walk a JSON Schema 2020-12 document and collect its `$id` / `$anchor` /
 * `$dynamicAnchor` locations into lookup tables. Boolean schemas (`true` /
 * `false`) pass through unchanged.
 *
 * @remarks
 * This function does not yet inline `$ref` — references are left in place
 * and resolved lazily at compile time. The schemas remain the original
 * values (not cloned).
 *
 * @param schema - Root schema.
 * @param options - Optional base URI / registry.
 * @returns A {@link ResolvedGraph}.
 *
 * @example
 * ```ts
 * const graph = resolve({ $defs: { Pet: { type: "object" } } });
 * graph.byAnchor.size; // 0
 * ```
 *
 * @public
 */
export function resolve(schema: SchemaOrBoolean, options: ResolveOptions = {}): ResolvedGraph {
  const registry = options.registry ?? new SchemaRegistry();
  const byId = new Map<string, SchemaOrBoolean>();
  const byAnchor = new Map<string, SchemaOrBoolean>();
  const byDynamicAnchor = new Map<string, SchemaOrBoolean>();

  walk(schema, byId, byAnchor, byDynamicAnchor);

  return {
    root: schema,
    baseUri: options.baseUri ?? "",
    byId,
    byAnchor,
    byDynamicAnchor,
    registry,
  };
}

function walk(
  schema: SchemaOrBoolean,
  byId: Map<string, SchemaOrBoolean>,
  byAnchor: Map<string, SchemaOrBoolean>,
  byDynamicAnchor: Map<string, SchemaOrBoolean>,
): void {
  if (typeof schema === "boolean") return;
  const obj = schema as SchemaObject;
  if (typeof obj.$id === "string") byId.set(obj.$id, schema);
  if (typeof obj.$anchor === "string") byAnchor.set(obj.$anchor, schema);
  if (typeof obj.$dynamicAnchor === "string") byDynamicAnchor.set(obj.$dynamicAnchor, schema);

  walkRecord(obj.$defs, byId, byAnchor, byDynamicAnchor);
  walkRecord(obj.properties, byId, byAnchor, byDynamicAnchor);
  walkRecord(obj.patternProperties, byId, byAnchor, byDynamicAnchor);
  walkRecord(obj.dependentSchemas, byId, byAnchor, byDynamicAnchor);

  walkMaybe(obj.additionalProperties, byId, byAnchor, byDynamicAnchor);
  walkMaybe(obj.propertyNames, byId, byAnchor, byDynamicAnchor);
  walkMaybe(obj.items, byId, byAnchor, byDynamicAnchor);
  walkMaybe(obj.contains, byId, byAnchor, byDynamicAnchor);
  walkMaybe(obj.unevaluatedProperties, byId, byAnchor, byDynamicAnchor);
  walkMaybe(obj.unevaluatedItems, byId, byAnchor, byDynamicAnchor);
  walkMaybe(obj.not, byId, byAnchor, byDynamicAnchor);
  walkMaybe(obj.if, byId, byAnchor, byDynamicAnchor);
  walkMaybe(obj.then, byId, byAnchor, byDynamicAnchor);
  walkMaybe(obj.else, byId, byAnchor, byDynamicAnchor);

  walkArray(obj.prefixItems, byId, byAnchor, byDynamicAnchor);
  walkArray(obj.allOf, byId, byAnchor, byDynamicAnchor);
  walkArray(obj.anyOf, byId, byAnchor, byDynamicAnchor);
  walkArray(obj.oneOf, byId, byAnchor, byDynamicAnchor);
}

function walkMaybe(
  schema: SchemaOrBoolean | undefined,
  byId: Map<string, SchemaOrBoolean>,
  byAnchor: Map<string, SchemaOrBoolean>,
  byDynamicAnchor: Map<string, SchemaOrBoolean>,
): void {
  if (schema !== undefined) walk(schema, byId, byAnchor, byDynamicAnchor);
}

function walkArray(
  schemas: SchemaOrBoolean[] | undefined,
  byId: Map<string, SchemaOrBoolean>,
  byAnchor: Map<string, SchemaOrBoolean>,
  byDynamicAnchor: Map<string, SchemaOrBoolean>,
): void {
  if (schemas === undefined) return;
  for (const s of schemas) walk(s, byId, byAnchor, byDynamicAnchor);
}

function walkRecord(
  record: Record<string, SchemaOrBoolean> | undefined,
  byId: Map<string, SchemaOrBoolean>,
  byAnchor: Map<string, SchemaOrBoolean>,
  byDynamicAnchor: Map<string, SchemaOrBoolean>,
): void {
  if (record === undefined) return;
  for (const key of Object.keys(record)) {
    const value = record[key];
    if (value !== undefined) walk(value, byId, byAnchor, byDynamicAnchor);
  }
}
