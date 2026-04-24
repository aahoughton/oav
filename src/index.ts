/**
 * Default entry for `oav`. Re-exports the HTTP validator
 * (`createValidator` and friends) plus the entirety of
 * `oav/core`: error-tree helpers, formatters, shared
 * OpenAPI / HTTP types, and version detection.
 *
 * Lower-level pieces live on per-subsystem entrypoints:
 *   - `oav/schema`  — JSON Schema 2020-12 compiler + dialects
 *   - `oav/spec`    — multi-file loader, resolver, overlays
 *   - `oav/formats` — built-in string format validators
 *   - `oav/core`    — the surface re-exported here, imported on its own
 */

export * from "../packages/validator/src/index.js";
export * from "../packages/core/src/index.js";
