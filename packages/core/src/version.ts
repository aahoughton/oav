/**
 * OpenAPI version detection and dialect identity.
 *
 * The OpenAPI Specification has two major variants that affect
 * validator behaviour:
 *
 * - **3.0.x** — uses a draft-Wright-00-based JSON Schema dialect with
 *   its own flavours of `type` (single string only), `nullable: true`,
 *   boolean `exclusiveMaximum`/`Minimum`, no sibling keys for `$ref`,
 *   and no `const` / `if`/`then`/`else` / `contains` /
 *   `unevaluatedProperties` / `patternProperties`.
 * - **3.1.x** and **3.2.x** — use JSON Schema 2020-12. 3.2 is largely
 *   additive over 3.1 (new methods like `QUERY`, tightened rules) and
 *   shares 3.1's dialect.
 *
 * This module is intentionally tiny: it classifies a spec into one of
 * these buckets. Consumers (notably `@oav/validator`) use the bucket
 * to pick the right vocabulary set at validator construction.
 *
 * @packageDocumentation
 */

/**
 * The three supported OpenAPI major.minor lines.
 *
 * @public
 */
export type OpenAPIVersion = "3.0" | "3.1" | "3.2";

/**
 * Inspect an OpenAPI document's `openapi` field and bucket it by
 * major.minor. Returns `undefined` when the field is missing, malformed,
 * or targets a line we don't recognise.
 *
 * @param spec - Anything shaped like an OpenAPI document. Safe on
 *               arbitrary input; returns `undefined` without throwing.
 * @returns The matched version bucket, or `undefined`.
 *
 * @example
 * ```ts
 * detectOpenAPIVersion({ openapi: "3.1.0", info: { ... } }); // "3.1"
 * detectOpenAPIVersion({ openapi: "3.2.0-rc1" });            // "3.2"
 * detectOpenAPIVersion({ swagger: "2.0" });                  // undefined
 * ```
 *
 * @public
 */
export function detectOpenAPIVersion(spec: unknown): OpenAPIVersion | undefined {
  if (spec === null || typeof spec !== "object") return undefined;
  const openapi = (spec as { openapi?: unknown }).openapi;
  if (typeof openapi !== "string") return undefined;
  const match = /^(\d+)\.(\d+)/.exec(openapi);
  if (match === null) return undefined;
  const major = match[1];
  const minor = match[2];
  if (major !== "3") return undefined;
  if (minor === "0") return "3.0";
  if (minor === "1") return "3.1";
  if (minor === "2") return "3.2";
  return undefined;
}
