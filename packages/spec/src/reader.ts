import { readFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import { parse as parseYaml } from "yaml";

/**
 * Opaque reader that turns a URI into a parsed JSON-compatible value.
 * Multiple readers can be layered via {@link composeReaders} so the
 * resolver can accept different URI schemes uniformly.
 *
 * @public
 */
export interface DocumentReader {
  read(uri: string): Promise<unknown>;
  /** Returns true if this reader can handle the given URI. */
  canRead(uri: string): boolean;
}

/**
 * Read files from the local filesystem. Parses `.json`, `.yaml`, `.yml`.
 *
 * @param cwd - Optional base directory. Defaults to `process.cwd()`.
 * @returns A {@link DocumentReader}.
 *
 * @example
 * ```ts
 * const reader = createFileReader("/abs/spec");
 * await reader.read("openapi.yaml");
 * ```
 *
 * @public
 */
export function createFileReader(cwd: string = process.cwd()): DocumentReader {
  return {
    canRead(uri) {
      return !/^(https?|memory):/i.test(uri);
    },
    async read(uri) {
      const stripped = uri.replace(/^file:\/\//, "");
      // `$ref` URIs are percent-encoded per RFC 3986, so a filesystem
      // path like "my spec.yaml" arrives here as "my%20spec.yaml". Decode
      // well-formed %XX escapes before hitting the disk. Stray `%` that
      // isn't a valid escape passes through so it can match a literal
      // filename that actually contains one.
      const decoded = stripped.replace(/%[0-9A-Fa-f]{2}/g, (m) => decodeURIComponent(m));
      const path = resolvePath(cwd, decoded);
      const raw = await readFile(path, "utf8");
      return parseByExtension(path, raw);
    },
  };
}

/**
 * Read documents over HTTP/HTTPS.
 *
 * @returns A {@link DocumentReader}.
 *
 * @example
 * ```ts
 * const reader = createHttpReader();
 * await reader.read("https://example.com/spec.json");
 * ```
 *
 * @public
 */
export function createHttpReader(): DocumentReader {
  return {
    canRead(uri) {
      return /^https?:/i.test(uri);
    },
    async read(uri) {
      const res = await fetch(uri);
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${uri}`);
      const text = await res.text();
      return parseByExtension(uri, text);
    },
  };
}

/**
 * In-memory reader, keyed by string URI. Primarily used in tests.
 *
 * @param sources - Map of URI → raw string (or already-parsed value).
 * @returns A {@link DocumentReader}.
 *
 * @example
 * ```ts
 * const reader = createMemoryReader(new Map([
 *   ["main.yaml", "openapi: 3.1.0\ninfo: { title: X, version: 1 }"],
 * ]));
 * ```
 *
 * @public
 */
export function createMemoryReader(sources: Map<string, string | unknown>): DocumentReader {
  return {
    canRead(uri) {
      return sources.has(uri);
    },
    async read(uri) {
      const source = sources.get(uri);
      if (source === undefined) throw new Error(`memory reader: no entry for ${uri}`);
      if (typeof source === "string") return parseByExtension(uri, source);
      return source;
    },
  };
}

/**
 * Try each reader in order until one accepts the URI. Useful for mixing
 * file / HTTP / memory sources in a single resolver.
 *
 * @param readers - Ordered list of readers.
 * @returns A composite {@link DocumentReader}.
 *
 * @example
 * ```ts
 * const reader = composeReaders([memoryReader, fileReader]);
 * ```
 *
 * @public
 */
export function composeReaders(readers: DocumentReader[]): DocumentReader {
  return {
    canRead(uri) {
      return readers.some((r) => r.canRead(uri));
    },
    async read(uri) {
      for (const r of readers) {
        if (r.canRead(uri)) return r.read(uri);
      }
      throw new Error(`no reader can handle ${uri}`);
    },
  };
}

function parseByExtension(pathOrUri: string, raw: string): unknown {
  const lower = pathOrUri.toLowerCase();
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return parseYaml(raw);
  if (lower.endsWith(".json")) return JSON.parse(raw);
  // Default: try JSON, fall back to YAML
  try {
    return JSON.parse(raw);
  } catch {
    return parseYaml(raw);
  }
}
