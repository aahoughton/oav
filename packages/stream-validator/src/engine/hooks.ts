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
