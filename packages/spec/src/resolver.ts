import { dirname, isAbsolute, posix, resolve as resolvePath } from "node:path";
import { resolveJsonPointer, type OpenAPIDocument } from "@oav/core";
import type { DocumentReader } from "./reader.js";

// Re-export the canonical implementation so @oav/spec consumers who
// imported `resolveJsonPointer` keep working.
export { resolveJsonPointer };

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

/**
 * Load an OpenAPI 3.1 document and inline all external `$ref`s, producing a
 * single self-contained document. Circular references are materialized under
 * `$defs.__ext__/<encoded-uri>` so the compiler can resolve them via the
 * identity-keyed schema cache; non-circular external refs are fully inlined.
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
  const stitchQueue = new Set<string>();

  const walk = async (
    value: unknown,
    currentBase: string,
    stitchingUri: string | null,
    externalSourceUri: string | null,
  ): Promise<unknown> => {
    if (value === null || typeof value !== "object") return value;
    if (Array.isArray(value)) {
      const out: unknown[] = [];
      for (const item of value) {
        out.push(await walk(item, currentBase, stitchingUri, externalSourceUri));
      }
      return out;
    }
    const obj = value as Mutable;
    const ref = obj["$ref"];
    if (typeof ref === "string" && !ref.startsWith("#")) {
      const [refPath, fragment = ""] = ref.split("#") as [string, string | undefined];
      const targetUri = resolveRelative(currentBase, refPath);
      const stitchRef = {
        $ref: `#/$defs/__ext__/${encodeUri(targetUri)}${fragment ? `/${encodeFragment(fragment)}` : ""}`,
      };
      if (stitchingUri !== null && stitchingUri === targetUri) {
        // Self-ref inside the subtree we're currently stitching — keep as
        // internal ref (the stitched copy serves as the target).
        return stitchRef;
      }
      if (visiting.has(targetUri + "#" + fragment)) {
        // Cycle: short-circuit and queue the target for stitching so the
        // internal ref has something to resolve against.
        stitchQueue.add(targetUri);
        return stitchRef;
      }
      visiting.add(targetUri + "#" + fragment);
      sources.add(targetUri);
      let targetDoc = docs.get(targetUri);
      if (targetDoc === undefined) {
        targetDoc = await reader.read(targetUri);
        docs.set(targetUri, targetDoc);
      }
      const resolved = fragment === "" ? targetDoc : resolveJsonPointer(targetDoc, fragment);
      // Recurse into the inlined subtree with the external file's URI
      // as the source context. Any internal `#/...` refs inside the
      // subtree are actually refs into this external file and will be
      // rewritten to point at its stitched location (see the internal-
      // ref branch below).
      const inlined = await walk(resolved, dirname(targetUri), stitchingUri, targetUri);
      visiting.delete(targetUri + "#" + fragment);
      // preserve sibling properties (OpenAPI 3.1 allows $ref + siblings for some objects)
      const siblings: Mutable = {};
      for (const key of Object.keys(obj)) {
        if (key === "$ref") continue;
        siblings[key] = await walk(obj[key], currentBase, stitchingUri, externalSourceUri);
      }
      if (Object.keys(siblings).length === 0) return inlined;
      return inlined !== null && typeof inlined === "object" && !Array.isArray(inlined)
        ? { ...(inlined as Mutable), ...siblings }
        : inlined;
    }
    // Internal ref inside a subtree that came from an external file:
    // rewrite it to point at the external's stitched location and make
    // sure that file ends up in $defs.__ext__. Without this rewrite,
    // `#/components/schemas/Thing` inside an inlined subtree would
    // resolve against the *root* document, orphaning the ref.
    if (typeof ref === "string" && ref.startsWith("#") && externalSourceUri !== null) {
      const fragment = ref.slice(1);
      const encoded = encodeUri(externalSourceUri);
      const rewritten =
        fragment === "" || fragment === "/"
          ? `#/$defs/__ext__/${encoded}`
          : `#/$defs/__ext__/${encoded}${fragment.startsWith("/") ? fragment : `/${fragment}`}`;
      stitchQueue.add(externalSourceUri);
      const siblings: Mutable = { $ref: rewritten };
      for (const key of Object.keys(obj)) {
        if (key === "$ref") continue;
        siblings[key] = await walk(obj[key], currentBase, stitchingUri, externalSourceUri);
      }
      return siblings;
    }
    const out: Mutable = {};
    for (const key of Object.keys(obj)) {
      out[key] = await walk(obj[key], currentBase, stitchingUri, externalSourceUri);
    }
    return out;
  };

  const resolved = (await walk(entryDoc, baseDir, null, null)) as OpenAPIDocument;

  if (stitchQueue.size > 0) {
    const stitched: Mutable = {};
    while (stitchQueue.size > 0) {
      const uri = stitchQueue.values().next().value as string;
      stitchQueue.delete(uri);
      if (Object.hasOwn(stitched, uri)) continue;
      sources.add(uri);
      let targetDoc = docs.get(uri);
      if (targetDoc === undefined) {
        targetDoc = await reader.read(uri);
        docs.set(uri, targetDoc);
      }
      // Walk the full document from scratch. Self-references collapse
      // into internal refs pointing at the stitched copy so the walk
      // terminates. Pass `uri` as externalSourceUri so *internal* refs
      // inside the stitched content (e.g. `#/components/schemas/Thing`)
      // get rewritten to point at their siblings under the stitched
      // location, not at the root document.
      const savedVisiting = new Set(visiting);
      visiting.clear();
      const inlined = await walk(targetDoc, dirname(uri), uri, uri);
      visiting.clear();
      for (const v of savedVisiting) visiting.add(v);
      stitched[uri] = inlined;
    }
    const rootObj = resolved as unknown as Mutable;
    const prevDefs = (rootObj.$defs ?? {}) as Mutable;
    const prevExt = (prevDefs.__ext__ ?? {}) as Mutable;
    rootObj.$defs = { ...prevDefs, __ext__: { ...prevExt, ...stitched } };
  }

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
