/**
 * Edit-hook types. Hooks fire at a forward-decidable scope's close, after
 * its verdict is known and before its delimiter; they observe the scope
 * or append sibling bytes (append-only, never validated). See the design
 * doc's "Edit hooks".
 *
 * Scope coverage is STREAM-only: hooks fire for forward-decidable
 * (STREAM) scopes, not for scopes the classifier routes to a BUFFER
 * island (e.g. `uniqueItems`, `contains`, an object-valued `const`) or a
 * TEE composition branch (`oneOf`/`anyOf`/`allOf`). The set of scopes a
 * hook observes is a function of the schema's classification, so a hook
 * meant for generic JSON transformation will appear to fire
 * intermittently if the schema mixes streamable and buffered subtrees.
 *
 * @packageDocumentation
 */

import type { JsonValue, PathSegment } from "@oav/core";

/**
 * Default cap on a captured scalar's source-byte span, applied when
 * `valueEvents.capture` is on and `maxCaptureBytes` is unset. Capture is
 * meant for small scalars (an id, a version, a timestamp); a member whose
 * value exceeds this is reported with `value` omitted and `truncated`
 * set, never buffered past the cap.
 */
export const DEFAULT_MAX_CAPTURE_BYTES = 65536;

/**
 * A `value` event: a scalar object-member value completed (validated on
 * the STREAM path or routed to a scalar BUFFER island, e.g. a
 * `format`-bearing string). Reports the member location and the value's
 * absolute input-byte span; carries the decoded value only when capture
 * is on.
 *
 * `valueStart` / `valueEnd` are absolute offsets into the **input** byte
 * stream, in the pre-injection space `editClose` and violations share. A
 * consumer slices `[valueStart, valueEnd)` from its own copy of the input
 * (the bytes include a string's surrounding quotes, so the slice is
 * itself valid JSON to `JSON.parse`). Slice the input, not the echoed
 * output: under `editClose` the output is respliced and its offsets no
 * longer line up.
 *
 * @public
 */
export interface ValueEvent {
  /** Path to the enclosing object scope (the root scope is `[]`). */
  path: PathSegment[];
  /** The member key. */
  key: string;
  /** Byte offset of the value's first byte (a string's opening quote). */
  valueStart: number;
  /** Byte offset just past the value's last byte. */
  valueEnd: number;
  /** JSON type of the value. */
  type: "string" | "number" | "boolean" | "null";
  /**
   * The decoded value, present only when `valueEvents.capture` is on and
   * the value fit within `maxCaptureBytes`; otherwise `undefined`.
   */
  value?: string | number | boolean | null;
  /** True when capture was requested but the value exceeded `maxCaptureBytes` (the span is still reported). */
  truncated: boolean;
}

/** Bytes an `editClose` hook may append. A string is encoded as UTF-8. */
export type Bytes = Buffer | Uint8Array | string;

/** Context passed to a scope-close hook. */
export interface ScopeContext {
  /** Path to the closing scope. The root scope is `[]`. */
  readonly path: PathSegment[];
  readonly kind: "object" | "array";
  /** The scope's own verdict (its subtree validated clean). */
  readonly verdict: "valid" | "invalid";
  /** Members (object) or elements (array) seen in the scope. */
  readonly memberCount: number;
  /**
   * Build an object member to append, handling the leading comma: returns
   * `"name":value` when the scope is empty, `,"name":value` otherwise.
   * For object scopes; arrays append their own element bytes.
   */
  field(name: string, value: JsonValue): string;
}

/** An observe hook (no output) bound to a path filter. */
export type ScopeObserver = (ctx: ScopeContext) => void;

/** An edit hook: returns bytes to append before the delimiter, or null for no-op. */
export type ScopeEditor = (ctx: ScopeContext) => Bytes | null;

/** Coerce hook output to a Buffer (a string is UTF-8 encoded). */
export function toBuffer(bytes: Bytes): Buffer {
  if (typeof bytes === "string") return Buffer.from(bytes, "utf8");
  return Buffer.from(bytes);
}

/** Build the {@link ScopeContext} for a closing scope. */
export function makeScopeContext(
  path: PathSegment[],
  kind: "object" | "array",
  valid: boolean,
  memberCount: number,
): ScopeContext {
  return {
    path,
    kind,
    verdict: valid ? "valid" : "invalid",
    memberCount,
    field(name: string, value: JsonValue): string {
      const lead = memberCount > 0 ? "," : "";
      return `${lead}${JSON.stringify(name)}:${JSON.stringify(value)}`;
    },
  };
}
