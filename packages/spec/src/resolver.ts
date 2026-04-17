import { dirname, isAbsolute, posix, resolve as resolvePath } from "node:path";
import type { JsonValue, OpenAPIDocument } from "@oav/core";
import type { DocumentReader } from "./reader.js";

/**
 * Options accepted by {@link resolveSpec}.
 *
 * @public
 */
export interface ResolveSpecOptions {
  /** Reader used to fetch documents by URI. */
  reader: DocumentReader;
  /** Entry URI. */
  entry: string;
  /** Base directory/URI for resolving relative refs. Defaults to the entry's directory. */
  baseUri?: string;
}

/**
 * Output of {@link resolveSpec}: the stitched OpenAPI document plus a record
 * of how every external file was inlined.
 *
 * @public
 */
export interface ResolvedSpec {
  document: OpenAPIDocument;
  /** URIs of every external file that was loaded during resolution. */
  sources: string[];
}

type Mutable = Record<string, unknown>;
type JsonObject = Record<string, JsonValue>;

/**
 * Load an OpenAPI 3.1 document and inline all external `$ref`s, producing a
 * single self-contained document. Circular references are left as internal
 * `$ref`s that the compiler can resolve via the schema registry.
 *
 * @param options - Reader + entry URI.
 * @returns Resolved document + the list of files loaded.
 *
 * @example
 * ```ts
 * const reader = composeReaders([createFileReader()]);
 * const { document } = await resolveSpec({ reader, entry: "openapi.yaml" });
 * ```
 *
 * @public
 */
export async function resolveSpec(options: ResolveSpecOptions): Promise<ResolvedSpec> {
  const { reader } = options;
  const baseDir = options.baseUri ?? dirname(options.entry);
  const sources = new Set<string>([options.entry]);
  const docs = new Map<string, unknown>();

  const entryDoc = await reader.read(options.entry);
  docs.set(options.entry, entryDoc);

  const visiting = new Set<string>();

  const walk = async (value: unknown, currentBase: string): Promise<unknown> => {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) {
      const out: unknown[] = [];
      for (const item of value) out.push(await walk(item, currentBase));
      return out;
    }
    const obj = value as Mutable;
    const ref = obj["$ref"];
    if (typeof ref === "string" && !ref.startsWith("#")) {
      const [refPath, fragment = ""] = ref.split("#") as [string, string | undefined];
      const targetUri = resolveRelative(currentBase, refPath);
      if (visiting.has(targetUri + "#" + fragment)) {
        // Circular: preserve as internal ref (after the whole doc is stitched)
        return {
          $ref: `#/$defs/__ext__/${encodeUri(targetUri)}${fragment ? `/${encodeFragment(fragment)}` : ""}`,
        };
      }
      visiting.add(targetUri + "#" + fragment);
      sources.add(targetUri);
      let targetDoc = docs.get(targetUri);
      if (targetDoc === undefined) {
        targetDoc = await reader.read(targetUri);
        docs.set(targetUri, targetDoc);
      }
      const resolved = fragment === "" ? targetDoc : resolveJsonPointer(targetDoc, fragment);
      const inlined = await walk(resolved, dirname(targetUri));
      visiting.delete(targetUri + "#" + fragment);
      // preserve sibling properties (OpenAPI 3.1 allows $ref + siblings for some objects)
      const siblings: Mutable = {};
      for (const key of Object.keys(obj)) {
        if (key === "$ref") continue;
        siblings[key] = await walk(obj[key], currentBase);
      }
      if (Object.keys(siblings).length === 0) return inlined;
      return inlined !== null && typeof inlined === "object" && !Array.isArray(inlined)
        ? { ...(inlined as Mutable), ...siblings }
        : inlined;
    }
    const out: Mutable = {};
    for (const key of Object.keys(obj)) out[key] = await walk(obj[key], currentBase);
    return out;
  };

  const resolved = (await walk(entryDoc, baseDir)) as OpenAPIDocument;
  return { document: resolved, sources: [...sources] };
}

function resolveRelative(base: string, rel: string): string {
  if (/^(https?|file):/i.test(rel)) return rel;
  if (/^(https?|file):/i.test(base)) {
    return new URL(rel, base.endsWith("/") ? base : base + "/").toString();
  }
  if (isAbsolute(rel)) return resolvePath(rel);
  if (isAbsolute(base)) return resolvePath(base, rel);
  // Relative (test-friendly): use posix.join so memory keys stay keyed relatively.
  const joined = posix.join(base === "" || base === "." ? "" : base, rel);
  return joined.replace(/^\.\//, "");
}

function encodeUri(uri: string): string {
  return uri.replace(/~/g, "~0").replace(/\//g, "~1");
}

function encodeFragment(fragment: string): string {
  return fragment.replace(/^\//, "");
}

/**
 * Resolve a JSON Pointer (RFC 6901) fragment against the given root value.
 *
 * @param root - Root value.
 * @param pointer - Pointer (e.g. `"/$defs/Pet"`).
 * @returns The targeted value.
 * @throws When the pointer traverses into a non-object or the target is missing.
 *
 * @public
 */
export function resolveJsonPointer(root: unknown, pointer: string): JsonValue {
  if (pointer === "" || pointer === "/") return root as JsonValue;
  const parts = pointer
    .replace(/^\//, "")
    .split("/")
    .map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~"));
  let cur: unknown = root;
  for (const part of parts) {
    if (cur === null || typeof cur !== "object") {
      throw new Error(`JSON pointer ${pointer} traverses a primitive at ${part}`);
    }
    const asArr = Array.isArray(cur);
    const key = asArr ? Number.parseInt(part, 10) : part;
    cur = (cur as JsonObject)[key as never];
    if (cur === undefined) {
      throw new Error(`JSON pointer ${pointer} not found (at ${part})`);
    }
  }
  return cur as JsonValue;
}
