/**
 * The public option surface and shared path types for the streaming
 * validator.
 *
 * @packageDocumentation
 */

import type { PathSegment } from "@oav/core";
import type { CustomKeywordValidator, Dialect, RegexCompiler } from "@oav/schema";

/**
 * A JSON instance location, as an array of property names and array
 * indices from the document root. The root is the empty array `[]`. The
 * same `PathSegment[]` shape `@oav/core` errors carry, so violation
 * paths line up with the in-memory engine's.
 *
 * @public
 */
export type JsonPath = readonly PathSegment[];

/**
 * Selects scopes by path. Either an exact path (matched by value) or a
 * predicate over the path and the scope kind. The predicate form is what
 * lets a filter match a family of scopes (e.g. every element of an
 * array, or every scope at a given depth through a recursive `$ref`).
 *
 * @public
 */
export type PathFilter = JsonPath | ((path: JsonPath, kind: "object" | "array") => boolean);

/**
 * Options for a streaming validator.
 *
 * Field groups:
 *
 *   - **Verdict policy** (`maxErrors`, `policy`): how many violations to
 *     collect and whether the first one tears down the stream.
 *   - **Schema semantics** (`formats`, `keywords`, `regexCompiler`,
 *     `parity`): shared with `@oav/schema`'s `CompileOptions` where they
 *     overlap; threaded into the BUFFER-island delegate.
 *   - **Observability** (`keyEvents`): an opt-in, compile-time-gated key
 *     channel.
 *   - **Resource limits** (`maxBufferedBytes`, `maxDepth`,
 *     `maxTotalBytes`, `maxUniqueItems`, `enforceBounds`): all default off
 *     (unset = zero overhead). They bound the dimensions a
 *     forward-decidable schema leaves open.
 *
 * @public
 */
export interface StreamValidatorOptions {
  /**
   * OpenAPI version of the schema. `"3.0"` normalizes the schema to
   * 2020-12 shape before classification; all three select OpenAPI
   * semantics (`format` asserts). Omit for raw JSON Schema 2020-12. This
   * is the raw-schema analog of `@oav/validator` reading the version off
   * the spec; pair it with `dialect` only to override.
   */
  openApiVersion?: "3.0" | "3.1" | "3.2";

  /**
   * Dialect whose keyword set drives classification, matching
   * `@oav/schema`'s `CompileOptions.dialect` / `@oav/validator`'s
   * `ValidatorOptions.dialect`. Defaults to `jsonSchemaDialect` (or the
   * OpenAPI dialect when `openApiVersion` is set); set it only to
   * override that choice.
   */
  dialect?: Dialect;

  /**
   * How many violations to collect before sealing the verdict. Defaults
   * to `1` (Ajv-parity fast-fail), matching `@oav/schema`. `Infinity`
   * collects every violation.
   */
  maxErrors?: number;

  /**
   * What happens when the validation budget (`maxErrors`) is reached.
   *
   *   - `"terminate"` (default): destroy the stream on the budget-th
   *     violation; `pipeline` rejects with `ValidationFailedError`.
   *   - `"detach"`: stop validating, seal the verdict, raw-copy the tail
   *     of the input to output unchanged.
   *
   * A parse error is always terminal regardless of policy.
   */
  policy?: "terminate" | "detach";

  /**
   * Custom string-format validators, shape-compatible with
   * `@oav/schema`'s `formats` option. Threaded into the BUFFER-island
   * delegate's in-memory compile; they take effect only where that engine
   * asserts `format` (an OpenAPI dialect, or the 2020-12 format-assertion
   * vocabulary). The forward STREAM path treats `format` as an annotation
   * and never runs these.
   */
  formats?: Record<string, (value: string) => boolean>;

  /**
   * Custom keywords registered with the in-memory compiler. A keyword
   * present here is delegable (its subtree is classified BUFFER); one
   * absent that appears in a schema is a compile-time REJECT, never a
   * silent pass. Threaded into the BUFFER-island delegate's
   * `compileSchema` call.
   */
  keywords?: Record<string, CustomKeywordValidator>;

  /**
   * Regex engine for `pattern` / `format`, e.g. RE2 for untrusted input
   * (ReDoS hardening). Hardens the spine's own regex use and is threaded
   * into the BUFFER-island delegate. Same option as
   * `@oav/schema`'s `CompileOptions.regexCompiler`.
   */
  regexCompiler?: RegexCompiler;

  /**
   * Force exact `@oav/schema` message parity by classifying `oneOf` /
   * `anyOf` (and other TEE-eligible composition) as BUFFER, so the
   * in-memory engine produces the violation messages. Default `false`
   * (stream where possible). Off by default because it trades the
   * streaming property for message fidelity.
   */
  parity?: boolean;

  /**
   * Emit a `key` event for matching scopes. Absent = off, and codegen is
   * byte-identical to the no-events spine. `true` emits for every key;
   * `{ at }` filters by path. Observe-and-abort only; it cannot rewrite
   * or dedupe output.
   */
  keyEvents?: boolean | { at: PathFilter };

  /**
   * Emit a `value` event when a scalar object-member value completes,
   * carrying the member's absolute input-byte span (`valueStart` /
   * `valueEnd`, the same pre-injection space `editClose` and violations
   * use) so a consumer can slice and parse it off its own copy of the
   * input without a second parser. Absent = off: the spine does no
   * value-event work and emits nothing (one unsubscribed early-return per
   * scalar, no allocation).
   *
   *   - `true`: emit for every scalar member, span only (no decode).
   *   - `{ at }`: restrict to members whose **full path** (the enclosing
   *     scope path plus the key) matches the filter, so a value filter
   *     targets one field (`["meta", "id"]`), not a whole scope. That full
   *     path is also the event's {@link ValueEvent.path}, so the filter and
   *     the event use one coordinate: a top-level member `{version}` is
   *     `["version"]` (length 1), not `[]`. This differs from `keyEvents.at`,
   *     which matches (and reports) the enclosing scope path.
   *   - `{ at, capture: true }`: also decode the matched scalar and deliver
   *     it as `value` on the event, bounded by `maxCaptureBytes` (a value
   *     larger than the cap is reported with `value` omitted and
   *     `truncated: true`; its span is still reported). Capture defaults to
   *     a {@link DEFAULT_MAX_CAPTURE_BYTES}-byte cap when `maxCaptureBytes`
   *     is unset; pass `Infinity` to disable the cap (retain the whole
   *     value, the way the other `max*` options read `Infinity`).
   *
   * Scope is scalar object members. Every scalar member fires, whether
   * validated on the STREAM path or routed to a scalar BUFFER island, so a
   * `format`-bearing string (`date-time`, `uri`, `uuid`) reports its value
   * even under an asserting OpenAPI dialect, where it would otherwise be
   * delegated silently. Array elements, the root value, and members routed
   * to a TEE composition branch (`oneOf`/`anyOf`/...) are not reported; an
   * object- or array-valued member is a container, not a scalar, and never
   * fires. See {@link ValueEvent}.
   */
  valueEvents?: boolean | { at: PathFilter; capture?: boolean; maxCaptureBytes?: number };

  /**
   * Cap on any single internal buffer (a forced-buffer scalar or a
   * BUFFER island), in **UTF-8 source bytes** spanned by the buffered
   * region. A proportional proxy for heap, not an exact heap bound; size
   * it with headroom. Default off.
   */
  maxBufferedBytes?: number;

  /**
   * Maximum nesting depth. Bounds spine-stack growth and guards the
   * native-stack `RangeError` an in-memory island delegate would throw
   * on a deeply nested island. Default off. Same option as
   * `@oav/schema`'s `CompileOptions.maxDepth`.
   */
  maxDepth?: number;

  /**
   * Refuse input larger than this many bytes regardless of validity. A
   * policy lever; the STREAM path does not otherwise need it. Default
   * off.
   */
  maxTotalBytes?: number;

  /**
   * Cap on `uniqueItems`' seen-hash set (O(array length) memory, not
   * covered by `maxBufferedBytes`). Reserved: the current build delegates
   * `uniqueItems` arrays to the in-memory engine as a BUFFER island
   * (bounded by `maxBufferedBytes`), so this knob is inert until the
   * streaming canonical-hash mode lands. Default off.
   */
  maxUniqueItems?: number;

  /**
   * Turn the classifier's unbounded-* warnings into compile errors: an
   * unbounded `pattern` / `format` string, an unbounded BUFFER island,
   * unbounded depth, or `uniqueItems` with no `maxItems`. The recommended
   * setting for untrusted input. Named for the resource-bound axis it
   * governs, distinct from `@oav/validator`'s schema-lint `strict` mode.
   * Default `false`.
   */
  enforceBounds?: boolean;

  /**
   * Sink for non-fatal compile-time warnings (the unbounded-* dimensions
   * the classifier flags). Matches `@oav/validator`'s
   * `ValidatorOptions.warn`. Absent: warnings are dropped (unless
   * `enforceBounds` escalates them to a thrown error).
   */
  warn?: (message: string) => void;
}
