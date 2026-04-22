/**
 * YAML + HTTP readers shipped by the batteries-included
 * `@aahoughton/oav` distribution. Each implements
 * {@link @aahoughton/oav/spec!DocumentReader} and is designed to be
 * composed via
 * {@link @aahoughton/oav/spec!composeReaders} — order YAML readers
 * first so the JSON-only readers in `@aahoughton/oav-core/spec` act
 * as the fallback for `.json` paths.
 *
 * The lean `@aahoughton/oav-core` package intentionally doesn't carry
 * YAML parsing so it can advertise zero runtime dependencies; this
 * module lives in `@aahoughton/oav` (which depends on oav-core plus
 * `yaml`).
 *
 * @example
 * ```ts
 * import { composeReaders, createFileReader, loadSpec } from "@aahoughton/oav/spec";
 * import { createYamlFileReader } from "@aahoughton/oav";
 *
 * const reader = composeReaders([createYamlFileReader(), createFileReader()]);
 * const { document } = await loadSpec({ reader, entry: "openapi.yaml" });
 * ```
 */

import { readFile } from "node:fs/promises";
import { resolve as resolvePath } from "node:path";
import type { DocumentReader } from "@oav/spec";
import { parse as parseYaml } from "yaml";

function decodePercent(s: string): string {
  return s.replace(/%[0-9A-Fa-f]{2}/g, (m) => decodeURIComponent(m));
}

function hasYamlExtension(uri: string): boolean {
  const lower = uri.toLowerCase();
  return lower.endsWith(".yaml") || lower.endsWith(".yml");
}

/**
 * Read YAML files from the local filesystem. Only claims URIs whose
 * path ends in `.yaml` or `.yml`; compose with the main package's
 * `createFileReader` to cover JSON alongside.
 *
 * @param cwd - Optional base directory. Defaults to `process.cwd()`.
 *
 * @example
 * ```ts
 * import { composeReaders, createFileReader } from "@aahoughton/oav/spec";
 * import { createYamlFileReader } from "@aahoughton/oav";
 *
 * const reader = composeReaders([createYamlFileReader(), createFileReader()]);
 * ```
 *
 * @public
 */
export function createYamlFileReader(cwd: string = process.cwd()): DocumentReader {
  return {
    canRead(uri) {
      if (/^(https?|memory):/i.test(uri)) return false;
      return hasYamlExtension(uri);
    },
    async read(uri) {
      const stripped = uri.replace(/^file:\/\//, "");
      // `$ref` URIs are percent-encoded per RFC 3986, so a filesystem
      // path like "my spec.yaml" arrives here as "my%20spec.yaml".
      // Decode well-formed %XX escapes before hitting the disk; stray
      // `%` that isn't a valid escape passes through so it can match
      // a literal filename that actually contains one.
      const decoded = decodePercent(stripped);
      const path = resolvePath(cwd, decoded);
      const raw = await readFile(path, "utf8");
      return parseYaml(raw);
    },
  };
}

/**
 * Read YAML documents over HTTP/HTTPS. Only claims URIs ending in
 * `.yaml` or `.yml`; compose with the main package's
 * `createHttpReader` for JSON fetches.
 *
 * @example
 * ```ts
 * import { composeReaders, createHttpReader } from "@aahoughton/oav/spec";
 * import { createYamlHttpReader } from "@aahoughton/oav";
 *
 * const reader = composeReaders([createYamlHttpReader(), createHttpReader()]);
 * ```
 *
 * @public
 */
export function createYamlHttpReader(): DocumentReader {
  return {
    canRead(uri) {
      if (!/^https?:/i.test(uri)) return false;
      return hasYamlExtension(uri);
    },
    async read(uri) {
      const res = await fetch(uri);
      if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${uri}`);
      const text = await res.text();
      return parseYaml(text);
    },
  };
}

/**
 * Parse a YAML string. Exposed so callers that drive the main
 * package's `createMemoryReader` with pre-parsed objects can convert
 * YAML sources once at setup time.
 *
 * @example
 * ```ts
 * import { createMemoryReader } from "@aahoughton/oav/spec";
 * import { parseYamlString } from "@aahoughton/oav";
 *
 * const reader = createMemoryReader(
 *   new Map([["spec.yaml", parseYamlString("openapi: 3.1.0\ninfo: { title: t, version: 1 }")]]),
 * );
 * ```
 *
 * @public
 */
export function parseYamlString(source: string): unknown {
  return parseYaml(source);
}
