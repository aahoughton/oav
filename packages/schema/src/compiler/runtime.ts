import { createBranchError, createError, createLeafError, type ValidationError } from "@oav/core";
import type { CustomKeywordValidator } from "../keywords/custom.js";

/**
 * Runtime helpers exposed to every generated validator through the `deps`
 * closure. Keyword authors invoke these from generated source.
 *
 * @public
 */
export interface ValidatorDeps {
  createError: typeof createError;
  createLeafError: typeof createLeafError;
  createBranchError: typeof createBranchError;
  typeOf: (value: unknown) => string;
  deepEqual: (a: unknown, b: unknown) => boolean;
  wrapErrors: (
    code: string,
    path: readonly (string | number)[],
    errs: ValidationError[],
  ) => ValidationError | null;
  patterns: Map<string, RegExp>;
  /**
   * Compile a user-supplied regex. Tries the `u` (Unicode) flag first
   * (JSON Schema 2020-12 recommends it) and falls back to no-flag when
   * the pattern trips strict `u`-mode rules (stray `\-`, `\:`, `\/` etc.,
   * common in real-world OpenAPI specs). Results are memoized in
   * `patterns`. Throws `SyntaxError` only when the pattern is malformed
   * under both modes.
   */
  compilePattern: (pattern: string) => RegExp;
  /**
   * Count the Unicode code points in `s` without allocating an
   * intermediate array. Used by `minLength` / `maxLength`, which the
   * JSON Schema 2020-12 spec requires to count code points (surrogate
   * pairs count as one).
   *
   * The obvious `[...s].length` expression builds a one-string-per-code-point
   * array just to read its length; on a 10 MB payload that allocates far
   * more than the `maxLength` check can refuse. This helper walks the
   * string's iterator and counts; O(1) memory.
   */
  countCodePoints: (s: string) => number;
  /**
   * Find the first duplicate in an array. Returns `{ a, b }` where
   * `arr[a]` and `arr[b]` are structurally equal (JSON deep equality)
   * and `a < b`, or `null` when every item is unique. Backs `uniqueItems`.
   *
   * Primitives use a `Map<value, firstIndex>` (O(N) total); objects and
   * arrays fall back to pairwise `deepEqual` against the running list
   * of seen non-primitive items (O(k²) in the object-count tail, which
   * is unavoidable without canonicalisation). Mixed inputs get the
   * primitive fast path for every primitive and the object fallback
   * only for the object subset.
   */
  findDuplicate: (arr: readonly unknown[]) => { a: number; b: number } | null;
  formats: Map<string, (value: string) => boolean>;
  refs: Map<string, Validator>;
  /** User-registered keyword validators, keyed by keyword name. */
  customKeywords: Map<string, CustomKeywordValidator>;
  /**
   * The configured maximum number of leaf errors to collect, or
   * `Number.POSITIVE_INFINITY` when uncapped. Baked in at compile time;
   * not mutated after construction.
   */
  maxErrors: number;
  /**
   * Runtime counter, reset to `maxErrors` at the top of each top-level
   * `validate()` call. Every push decrements by one; when it reaches 0
   * further pushes are skipped and {@link ValidatorDeps.truncated} is set.
   */
  errorsRemaining: number;
  /**
   * Set to `true` by the runtime when at least one error was dropped
   * because the `maxErrors` budget had been exhausted. Cleared at the
   * top of each top-level `validate()` call.
   */
  truncated: boolean;
}

/**
 * Function signature of a compiled validator.
 *
 * @public
 */
export type Validator = (data: unknown, path: (string | number)[]) => ValidationError | null;

/**
 * The JSON-Schema-flavored typeof function: distinguishes `integer`,
 * `number`, `null`, `array`, `object`, etc. (everything that JSON Schema
 * 2020-12's `type` keyword recognizes).
 *
 * @param value - Any value.
 * @returns The JSON Schema type name.
 *
 * @example
 * ```ts
 * typeOf(null);      // "null"
 * typeOf([]);        // "array"
 * typeOf(1);         // "integer"
 * typeOf(1.5);       // "number"
 * ```
 *
 * @public
 */
export function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  const t = typeof value;
  if (t === "object") return "object";
  if (t === "string") return "string";
  if (t === "boolean") return "boolean";
  if (t === "number") return Number.isInteger(value) ? "integer" : "number";
  return t;
}

/**
 * Structural equality for JSON values: honors array ordering, object key
 * sets (not ordering), and NaN-as-not-equal. Used by `enum`, `const`, and
 * `uniqueItems`.
 *
 * @param a - First value.
 * @param b - Second value.
 * @returns `true` when both values are structurally equal.
 *
 * @example
 * ```ts
 * deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 }); // true
 * deepEqual([1, 2], [2, 1]);                 // false
 * ```
 *
 * @public
 */
/**
 * Find the first pair of structurally-equal elements in `arr`. Backs
 * the `uniqueItems` keyword: primitives hit a `Map` fast path (O(N)),
 * while objects/arrays fall back to pairwise `deepEqual` against the
 * running list of seen non-primitives (O(k²) in the object-count
 * tail, unavoidable without hashing).
 *
 * @param arr - The array to scan.
 * @returns `{ a, b }` with `a < b` for the first duplicate pair, or
 *          `null` when every element is unique.
 *
 * @public
 */
export function findDuplicate(arr: readonly unknown[]): { a: number; b: number } | null {
  const primitives = new Map<unknown, number>();
  const objects: Array<{ val: unknown; idx: number }> = [];
  for (let i = 0; i < arr.length; i += 1) {
    const v = arr[i];
    if (v !== null && typeof v === "object") {
      for (const o of objects) {
        if (deepEqual(v, o.val)) return { a: o.idx, b: i };
      }
      objects.push({ val: v, idx: i });
    } else {
      const first = primitives.get(v);
      if (first !== undefined) return { a: first, b: i };
      primitives.set(v, i);
    }
  }
  return null;
}

/**
 * Count the Unicode code points in `s` without allocating. Replaces
 * `[...s].length`, whose intermediate array blows up on large strings
 * before the `maxLength` check can reject them.
 *
 * @param s - The string to measure.
 * @returns The number of Unicode code points.
 *
 * @example
 * ```ts
 * countCodePoints("hi");     // 2
 * countCodePoints("🎉");     // 1 (a single astral code point)
 * ```
 *
 * @public
 */
export function countCodePoints(s: string): number {
  let n = 0;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- iterator drives the counter
  for (const _ of s) n++;
  return n;
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== typeof b) return false;
  if (a === null || b === null) return false;
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (typeof a === "object") {
    if (typeof b !== "object" || Array.isArray(b)) return false;
    const aObj = a as Record<string, unknown>;
    const bObj = b as Record<string, unknown>;
    const aKeys = Object.keys(aObj);
    const bKeys = Object.keys(bObj);
    if (aKeys.length !== bKeys.length) return false;
    for (const key of aKeys) {
      if (!Object.prototype.hasOwnProperty.call(bObj, key)) return false;
      if (!deepEqual(aObj[key], bObj[key])) return false;
    }
    return true;
  }
  return false;
}

/**
 * Combine an error accumulator into a single ValidationError, collapsing the
 * trivial cases: empty → null, single → the one error, otherwise wrap.
 *
 * @param code - Wrapping error's code when multiple errors are present.
 * @param path - Path for the wrapping error.
 * @param errors - The accumulated errors.
 * @returns `null` when there are no errors, else the (possibly wrapped) error.
 *
 * @example
 * ```ts
 * wrapErrors("schema", [], []);          // null
 * wrapErrors("schema", [], [onlyError]); // onlyError
 * wrapErrors("schema", [], [a, b]);      // { code: "schema", children: [a, b], ... }
 * ```
 *
 * @public
 */
export function wrapErrors(
  code: string,
  path: readonly (string | number)[],
  errors: ValidationError[],
): ValidationError | null {
  if (errors.length === 0) return null;
  if (errors.length === 1 && errors[0] !== undefined) return errors[0];
  return createBranchError(code, [...path], "schema validation failed", errors);
}

/**
 * Build a {@link ValidatorDeps} bundle with fresh mutable caches.
 *
 * @param maxErrors - Cap on leaf errors collected per `validate()` call.
 *                    Defaults to `Number.POSITIVE_INFINITY` (uncapped).
 * @returns A new deps object wired with the default runtime helpers.
 *
 * @public
 */
export function createDeps(maxErrors: number = Number.POSITIVE_INFINITY): ValidatorDeps {
  const patterns = new Map<string, RegExp>();
  return {
    createError,
    createLeafError,
    createBranchError,
    typeOf,
    deepEqual,
    countCodePoints,
    findDuplicate,
    wrapErrors,
    patterns,
    compilePattern(pattern: string): RegExp {
      const cached = patterns.get(pattern);
      if (cached !== undefined) return cached;
      let re: RegExp;
      try {
        re = new RegExp(pattern, "u");
      } catch (errU) {
        try {
          re = new RegExp(pattern);
        } catch {
          // Surface the stricter (`u`-mode) error; it's more informative
          // when both modes reject the pattern.
          throw errU;
        }
      }
      patterns.set(pattern, re);
      return re;
    },
    formats: new Map<string, (value: string) => boolean>(),
    refs: new Map<string, Validator>(),
    customKeywords: new Map<string, CustomKeywordValidator>(),
    maxErrors,
    errorsRemaining: maxErrors,
    truncated: false,
  };
}
