/**
 * Issues unique identifier names for generated source. Keeps a counter per
 * prefix so callers can ask for `n0`, `n1`, `n2` without colliding with other
 * generators sharing the same function.
 *
 * @public
 */
export class Scope {
  private readonly counters = new Map<string, number>();

  /**
   * Generate a fresh identifier with the given prefix.
   *
   * @param prefix - Desired prefix (e.g. `"i"`, `"tmp"`, `"sub"`).
   * @returns A unique name like `"i0"`, `"i1"`, ...
   *
   * @example
   * ```ts
   * const s = new Scope();
   * s.name("i"); // "i0"
   * s.name("i"); // "i1"
   * ```
   */
  name(prefix: string): string {
    const current = this.counters.get(prefix) ?? 0;
    this.counters.set(prefix, current + 1);
    return `${prefix}${current}`;
  }
}
