/**
 * Well-known identifier names used inside generated validator source so that
 * keyword authors and the compiler speak the same language.
 *
 * @public
 */
export const NAMES = {
  /** Root data reference, passed into the outermost validator. */
  ROOT_DATA: "rootData",
  /** The data value currently under validation in a given scope. */
  DATA: "data",
  /** The path array carrying the data location being validated. */
  PATH: "path",
  /** The errors accumulator for the current schema scope. */
  ERRORS: "errors",
  /** The runtime dependencies injected into the compiled validator. */
  DEPS: "deps",
  /** The map of sibling/child compiled validators. */
  REFS: "refs",
  /** Pre-compiled regular expressions referenced by `pattern` / `patternProperties`. */
  PATTERNS: "patterns",
  /** Format validators registered at compile time. */
  FORMATS: "formats",
} as const;
