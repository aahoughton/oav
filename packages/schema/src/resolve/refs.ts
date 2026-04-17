import type { SchemaObject, SchemaOrBoolean } from "@oav/core";
import type { ResolvedGraph } from "./resolver.js";

/**
 * A function capable of resolving a JSON Schema `$ref` string (absolute or
 * fragment) into the schema it names.
 *
 * @public
 */
export interface RefResolver {
  resolve(ref: string): SchemaOrBoolean;
}

/**
 * Build a {@link RefResolver} that resolves references against a given
 * {@link ResolvedGraph}.
 *
 * @remarks
 * Supported forms:
 * - `#` — the root schema.
 * - `#/a/b/c` — JSON Pointer into the root schema.
 * - `#name` — lookup in `byAnchor`.
 * - absolute URI — lookup in `byId` or the external registry.
 * - absolute URI + fragment — resolve the URI, then the fragment.
 *
 * @param graph - Output of {@link resolve}.
 * @returns A resolver ready to hand to the compiler.
 *
 * @example
 * ```ts
 * const graph = resolve({ $defs: { Pet: { type: "object" } } });
 * const refs = createRefResolver(graph);
 * refs.resolve("#/$defs/Pet"); // → { type: "object" }
 * ```
 *
 * @public
 */
export function createRefResolver(graph: ResolvedGraph): RefResolver {
  return {
    resolve(ref: string): SchemaOrBoolean {
      return resolveOne(ref, graph);
    },
  };
}

function resolveOne(ref: string, graph: ResolvedGraph): SchemaOrBoolean {
  if (ref === "#" || ref === "") return graph.root;
  if (ref.startsWith("#")) return resolveFragment(ref.slice(1), graph.root, graph);

  const hashIdx = ref.indexOf("#");
  const base = hashIdx < 0 ? ref : ref.slice(0, hashIdx);
  const fragment = hashIdx < 0 ? "" : ref.slice(hashIdx + 1);
  const baseSchema = graph.byId.get(base) ?? graph.registry.get(base);
  if (baseSchema === undefined) {
    throw new Error(`cannot resolve $ref: ${ref}`);
  }
  if (fragment === "") return baseSchema;
  return resolveFragment(fragment, baseSchema, graph);
}

function resolveFragment(
  fragment: string,
  rootSchema: SchemaOrBoolean,
  graph: ResolvedGraph,
): SchemaOrBoolean {
  if (fragment === "") return rootSchema;
  if (fragment.startsWith("/")) return resolveJsonPointer(rootSchema, fragment);
  const anchored = graph.byAnchor.get(fragment) ?? graph.byDynamicAnchor.get(fragment);
  if (anchored !== undefined) return anchored;
  throw new Error(`unknown anchor: #${fragment}`);
}

function resolveJsonPointer(root: SchemaOrBoolean, pointer: string): SchemaOrBoolean {
  if (!pointer.startsWith("/")) throw new Error(`invalid JSON pointer: ${pointer}`);
  const parts = pointer
    .slice(1)
    .split("/")
    .map((s) => {
      // `$ref` fragments are URI-encoded first, then JSON-Pointer-escaped;
      // reverse in that order.
      let decoded: string;
      try {
        decoded = decodeURIComponent(s);
      } catch {
        decoded = s;
      }
      return decoded.replace(/~1/g, "/").replace(/~0/g, "~");
    });
  let cur: unknown = root;
  for (const part of parts) {
    if (cur === null || typeof cur !== "object") {
      throw new Error(`cannot walk JSON pointer "${pointer}" into a primitive`);
    }
    const arr = Array.isArray(cur);
    const key = arr ? Number.parseInt(part, 10) : part;
    cur = (cur as Record<string, unknown>)[key as never];
    if (cur === undefined) {
      throw new Error(`reference not found at ${pointer}`);
    }
  }
  return cur as SchemaOrBoolean;
}

/**
 * Find every distinct schema object reachable via `$dynamicAnchor` from an
 * ancestor chain — used when the compiler needs to decide which dynamic
 * anchor the current `$dynamicRef` should bind to.
 *
 * @remarks
 * This is the "static" part of $dynamicRef resolution; the full runtime
 * dynamic scope is simulated at compile time by walking each schema's
 * enclosing context. For schemas that don't use `$dynamicAnchor`, a
 * `$dynamicRef` behaves exactly like a `$ref`.
 *
 * @param schema - Schema to inspect.
 * @param graph - Resolved graph (for fallback anchor lookups).
 * @returns The `$dynamicAnchor` map reachable from this schema.
 *
 * @public
 */
export function collectDynamicAnchors(
  schema: SchemaOrBoolean,
  graph: ResolvedGraph,
): Map<string, SchemaOrBoolean> {
  const acc = new Map(graph.byDynamicAnchor);
  visit(schema, acc);
  return acc;
}

function visit(schema: SchemaOrBoolean, acc: Map<string, SchemaOrBoolean>): void {
  if (typeof schema === "boolean") return;
  const obj = schema as SchemaObject;
  if (typeof obj.$dynamicAnchor === "string") acc.set(obj.$dynamicAnchor, schema);
}
