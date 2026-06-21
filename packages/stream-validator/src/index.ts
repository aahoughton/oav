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
 * Published as `@aahoughton/oav-stream-validator` on the `experimental`
 * dist-tag during incubation, versioned independently of the `oav-core`
 * family.
 *
 * @packageDocumentation
 */

export type { JsonPath, PathFilter, StreamValidatorOptions } from "./options.js";
export {
  createStreamValidator,
  DEFAULT_MAX_CAPTURE_BYTES,
  MaxTotalBytesError,
  ValidationFailedError,
  type Bytes,
  type ScopeContext,
  type ScopeEditor,
  type ScopeObserver,
  // Exported as a type only: construct through `createStreamValidator`.
  // The factory is the construction contract; a type-only export keeps
  // `instanceof` and the `new` constructor out of the public surface, so
  // a later engine refactor (a shared base transform, a different
  // lifecycle class) does not break consumers.
  type StreamValidator,
  type ValueEvent,
} from "./engine/index.js";
export { BufferLimitError, UniqueItemsLimitError } from "./spine/index.js";
export type { StreamVerdict, SchemaViolation } from "./spine/index.js";
export { toValidationError } from "./violation.js";
