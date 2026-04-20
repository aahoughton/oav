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
  /**
   * Extra function parameter: an optional `Set<string>` that, when
   * supplied, receives the keys the function evaluated. Used to
   * propagate `unevaluatedProperties` tracking across composition
   * (`allOf` / `anyOf` / `oneOf` / `$ref` / `if-then-else`).
   * `undefined` means the caller doesn't need this information.
   */
  OUT_EVAL_PROPS: "outEvalProps",
  /** Same as {@link NAMES.OUT_EVAL_PROPS} but for array indices. */
  OUT_EVAL_ITEMS: "outEvalItems",
} as const;
