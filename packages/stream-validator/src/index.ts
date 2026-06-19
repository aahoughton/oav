/**
 * `@oav/stream-validator` (incubating): a streaming JSON Schema 2020-12
 * validator. It validates a JSON document against a resolved schema as
 * the bytes stream, echoing them through unchanged while reporting
 * violations on a side channel. Memory is bounded for forward-decidable
 * schemas with structural bounds, so multi-GB bodies validate without
 * materializing in heap.
 *
 * This is a second engine, push-based over a token stream, distinct from
 * `@oav/schema`'s pull-based compiler. It reuses `@oav/schema`'s
 * in-memory validator for subtrees a compile-time classifier marks
 * BUFFER (so format assertion and built-in formats come from that
 * delegate), and reuses `@oav/core`'s flat error model.
 *
 * The package is unpublished during incubation (`private`).
 *
 * @packageDocumentation
 */

export type { JsonPath, PathFilter, StreamValidatorOptions } from "./options.js";
export {
  createStreamValidator,
  DEFAULT_MAX_CAPTURE_BYTES,
  StreamValidator,
  ValidationFailedError,
  type Bytes,
  type ScopeContext,
  type ScopeEditor,
  type ScopeObserver,
  type ValueEvent,
} from "./engine/index.js";
export type { StreamVerdict, SchemaViolation } from "./spine/index.js";
export { normalizeOas30 } from "./openapi/index.js";
