/**
 * Internal re-exports for `@aahoughton/oav/validator/internals`. Exposes
 * the parameter-deserialisation and query-assembly primitives that the
 * validator uses to prepare values before schema compilation, plus the
 * operation-level `$ref` resolver. Reachable when you need them —
 * tests, advanced plugins, tooling that reuses the same style /
 * explode rules outside the normal validator flow — but deliberately
 * separated from the main `@aahoughton/oav/validator` barrel so the
 * public surface matches what request/response-validation consumers
 * actually need.
 *
 * Nothing here is covered by semver guarantees. Compare against the
 * main barrel in `./index.ts` before importing from here.
 *
 * @packageDocumentation
 */

// Parameter deserialisation primitives: `style` + `explode`
// interpretation, Content-Type negotiation, response-status key
// matching (exact → NXX class → default).
export { deserialize, matchMediaType, matchResponseKey } from "./deserialize.js";

// Query-object assembly helpers. Handle the two OAS query shapes that
// spread an object across multiple top-level keys: `style: form +
// explode: true` (the default) and `style: deepObject`.
export {
  assembleDeepObject,
  assembleFormExplodedObject,
  assembleObjectQueryParam,
  coerceQueryScalar,
} from "./query-assembly.js";

// Operation-level `$ref` resolver — used internally by the cache
// builder; exposed so tests can exercise it without constructing a
// full validator.
export { resolveOperationRef } from "./operation-cache.js";
