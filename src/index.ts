/**
 * Default entry for the `oav` package. Re-exports the HTTP validator plus
 * everything `@oav/core` publishes (error-tree helpers/formatters, shared
 * OpenAPI / HTTP types, and version detection).
 *
 * For the lower-level pieces (schema compiler, spec loader, format
 * validators), import from the per-subsystem entrypoints:
 *   - `oav/schema`
 *   - `oav/spec`
 *   - `oav/formats`
 *   - `oav/core`
 */

export * from "../packages/validator/src/index.js";
export * from "../packages/core/src/index.js";
