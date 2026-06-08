/**
 * Pure (no-I/O) helpers shared by the async {@link resolveSpec} and the
 * synchronous `resolveSpecSync` resolvers. The two resolvers keep
 * separate walk skeletons because one interleaves `await reader.read`
 * and the other a synchronous `reader.read` (JS function coloring), but
 * every sub-step that never touches the reader lives here so the URI
 * math and `$ref`-rewriting logic exists in exactly one place. A change
 * to stitch-pointer construction or relative-URI resolution lands for
 * both paths at once; the sync/async parity suite guards the rest.
 *
 * @packageDocumentation
 */

import { dirname, isAbsolute, posix, resolve as resolvePath } from "node:path";

/** Mutable object view used while walking parsed JSON documents. */
export type Mutable = Record<string, unknown>;

/**
 * Resolve a (possibly relative) `$ref` path against the current base
 * URI. Mirrors how the matcher treats `file:` / `http(s):` bases vs.
 * bare relative paths; the relative branch keeps memory-reader keys
 * relative so in-memory fixtures resolve by the same keys they were
 * registered under.
 */
export function resolveRelative(base: string, rel: string): string {
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

/** Directory of a URI, used as the base for refs found inside it. */
export function baseDirOf(uri: string): string {
  return dirname(uri);
}

/** Encode a URI for use as a `$defs.__ext__` key (JSON-pointer-safe). */
export function encodeUri(uri: string): string {
  return uri.replace(/~/g, "~0").replace(/\//g, "~1");
}

/** Strip a single leading slash from a JSON-pointer fragment. */
export function encodeFragment(fragment: string): string {
  return fragment.replace(/^\//, "");
}

/**
 * The internal `$ref` an external `$ref` collapses to: a pointer into
 * `#/$defs/__ext__/<encoded-uri>` (plus the encoded fragment, if any).
 */
export function makeStitchRef(targetUri: string, fragment: string): { $ref: string } {
  return {
    $ref: `#/$defs/__ext__/${encodeUri(targetUri)}${fragment ? `/${encodeFragment(fragment)}` : ""}`,
  };
}

/**
 * Rewrite an internal `#/...` ref that was found inside an inlined
 * external subtree so it points at that external's stitched location
 * rather than at the root document. `fragmentAfterHash` is the ref
 * minus its leading `#`.
 */
export function rewriteInternalRefTarget(
  externalSourceUri: string,
  fragmentAfterHash: string,
): string {
  const encoded = encodeUri(externalSourceUri);
  if (fragmentAfterHash === "" || fragmentAfterHash === "/") {
    return `#/$defs/__ext__/${encoded}`;
  }
  return `#/$defs/__ext__/${encoded}${fragmentAfterHash.startsWith("/") ? fragmentAfterHash : `/${fragmentAfterHash}`}`;
}

/** Cycle-detection key for a (uri, fragment) pair. */
export function cycleKey(targetUri: string, fragment: string): string {
  return targetUri + "#" + fragment;
}

/**
 * Merge the stitched external documents into the resolved root's
 * `$defs.__ext__`, preserving any pre-existing `$defs` on the entry
 * document. Mutates `resolved` in place.
 */
export function mergeStitchedExternals(resolved: object, stitched: Mutable): void {
  const rootObj = resolved as Mutable;
  const prevDefs = (rootObj.$defs ?? {}) as Mutable;
  const prevExt = (prevDefs.__ext__ ?? {}) as Mutable;
  rootObj.$defs = { ...prevDefs, __ext__: { ...prevExt, ...stitched } };
}
