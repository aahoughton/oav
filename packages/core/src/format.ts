import { collectLeaves, joinPath, walkErrors, type ValidationError } from "./errors.js";

/**
 * Options accepted by the text/flat formatters.
 *
 * @public
 */
export interface FormatOptions {
  /** Maximum depth to render; nodes deeper than this are truncated with `…`. Defaults to Infinity. */
  maxDepth?: number;
  /** String used for each level of indentation in `formatText`. Defaults to `"  "`. */
  indent?: string;
}

/**
 * Render a {@link ValidationError} tree as an indented human-readable string.
 *
 * @remarks
 * Every node renders as `<path> <message> [<code>]`. Children are indented
 * under their parent. The output is meant for terminals and logs, not
 * programmatic consumption; use {@link toJsonObject} or
 * {@link formatSummary} for that.
 *
 * @param error - Root of the error tree.
 * @param options - Optional rendering settings.
 * @returns A multi-line string ready to print.
 *
 * @example
 * ```ts
 * const out = formatText(rootError);
 * console.error(out);
 * ```
 *
 * @public
 */
export function formatText(error: ValidationError, options: FormatOptions = {}): string {
  const indent = options.indent ?? "  ";
  const maxDepth = options.maxDepth ?? Number.POSITIVE_INFINITY;
  const lines: string[] = [];
  const render = (node: ValidationError, depth: number): void => {
    if (depth > maxDepth) {
      lines.push(`${indent.repeat(depth)}…`);
      return;
    }
    const prefix = indent.repeat(depth);
    const location = joinPath(node.path);
    const pathPart = location.length > 0 ? `${location} ` : "";
    lines.push(`${prefix}${pathPart}${node.message} [${node.code}]`);
    for (const child of node.children) render(child, depth + 1);
  };
  render(error, 0);
  return lines.join("\n");
}

/**
 * Return a {@link ValidationError} tree as a JSON-safe plain object.
 *
 * @remarks
 * The returned object has the same shape as the input but is freshly
 * constructed (deep-cloned `children`, `path`, and `params`), so it
 * round-trips losslessly through `JSON.stringify` / `JSON.parse`.
 *
 * @param error - Root of the error tree.
 * @returns The same tree, safe to hand to `JSON.stringify`.
 *
 * @example
 * ```ts
 * JSON.stringify(toJsonObject(rootError), null, 2);
 * ```
 *
 * @public
 */
export function toJsonObject(error: ValidationError): ValidationError {
  return {
    code: error.code,
    path: [...error.path],
    message: error.message,
    params: { ...error.params },
    children: error.children.map(toJsonObject),
  };
}

/**
 * Leaf-selection policy for {@link formatSummary}.
 *
 * - `"first"`: the first leaf in tree-traversal order. Matches
 *   `express-openapi-validator`'s top-level `message`. The default.
 * - `"deepest"`: the leaf with the longest path. More informative
 *   on `oneOf` / composition trees where the structural cause sits
 *   one or two levels in. Tiebreak: first encountered.
 * - `"all"`: every leaf, one per line, each prefixed with its path
 *   and suffixed with its `[code]`. Use this when you want a flat
 *   enumeration of every issue (e.g. eov-style flat error messages,
 *   `grep`-friendly logs, CI diffs).
 * - `{ byCode }`: priority list of error codes. Returns the first
 *   leaf whose `code` matches the highest-priority entry; if no leaf
 *   matches any listed code, falls back to the `"first"` policy.
 *
 * @public
 */
export type FormatSummarySelect = "first" | "deepest" | "all" | { byCode: readonly string[] };

/**
 * Options for {@link formatSummary}.
 *
 * @public
 */
export interface FormatSummaryOptions {
  /** How to pick which leaf (or leaves) to summarise. Defaults to `"first"`. */
  select?: FormatSummarySelect;
  /**
   * Separator between leaves under `select: "all"`. Defaults to `"\n"`.
   * Set to `", "` for `eov`-style flat output. No effect on single-leaf
   * modes (`"first"`, `"deepest"`, `{ byCode }`).
   */
  separator?: string;
  /**
   * Whether to suffix each leaf with ` [<code>]` under `select: "all"`.
   * Defaults to `true`. Set to `false` for `eov`-style output. No effect
   * on single-leaf modes (which never include the code).
   */
  includeCode?: boolean;
}

/**
 * Render a {@link ValidationError} tree as a string. The workhorse for
 * HTTP response-body `message` fields, log lines, error-monitoring
 * titles, and `Error.message`.
 *
 * Two output shapes depending on {@link FormatSummaryOptions.select}:
 *
 * - **Single-leaf modes** (`"first"`, `"deepest"`, `{ byCode }`) pick one
 *   leaf and render it as `<dotted-path> <message>` (or just `<message>`
 *   when the path is empty). One line.
 * - **All-leaves mode** (`"all"`) enumerates every leaf, one per leaf,
 *   joined by {@link FormatSummaryOptions.separator} (default `"\n"`),
 *   each rendered as `<dotted-path> <message> [<code>]`. The trailing
 *   ` [<code>]` is suppressed when {@link FormatSummaryOptions.includeCode}
 *   is `false`. Tune both for `eov`-style flat output.
 *
 * For the indented full-tree view, use {@link formatText}; for the raw
 * JSON-safe object, use {@link toJsonObject}.
 *
 * @example
 * ```ts
 * formatSummary(rootError);
 * // "body.users[0].email must match format \"email\""
 *
 * formatSummary(rootError, { select: "deepest" });
 * // The leaf with the longest path. Useful on oneOf trees.
 *
 * formatSummary(rootError, { select: "all" });
 * // Every leaf, one per line:
 * //   body.users[0].email must match format "email" [format]
 * //   body.users[1].age must be >= 0 [minimum]
 *
 * formatSummary(rootError, { select: "all", separator: ", ", includeCode: false });
 * // eov-shaped flat output. (Path style still differs: eov uses
 * // slash-separated paths.)
 * //   body.users[0].email must match format "email", body.users[1].age must be >= 0
 *
 * formatSummary(rootError, { select: { byCode: ["content-type", "required"] } });
 * // The first content-type leaf if any, else the first required leaf,
 * // else the first leaf overall.
 * ```
 *
 * @public
 */
export function formatSummary(error: ValidationError, options: FormatSummaryOptions = {}): string {
  const select = options.select ?? "first";
  // collectLeaves defines a leaf as any node with no children, so even
  // a single-leaf root yields one entry; leaves[0] is always present.
  const leaves = collectLeaves(error);

  if (select === "all") {
    const separator = options.separator ?? "\n";
    const includeCode = options.includeCode ?? true;
    const lines: string[] = [];
    for (const leaf of leaves) {
      const location = joinPath(leaf.path);
      const pathPart = location.length > 0 ? `${location} ` : "";
      const codePart = includeCode ? ` [${leaf.code}]` : "";
      lines.push(`${pathPart}${leaf.message}${codePart}`);
    }
    return lines.join(separator);
  }

  let chosen: ValidationError = leaves[0]!;
  if (select === "deepest") {
    for (const leaf of leaves) {
      if (leaf.path.length > chosen.path.length) chosen = leaf;
    }
  } else if (select !== "first") {
    for (const code of select.byCode) {
      const match = leaves.find((l) => l.code === code);
      if (match !== undefined) {
        chosen = match;
        break;
      }
    }
  }

  const location = joinPath(chosen.path);
  return location.length > 0 ? `${location} ${chosen.message}` : chosen.message;
}

/**
 * Count the nodes in a {@link ValidationError} tree (branches + leaves).
 *
 * @param error - Root of the error tree.
 * @returns The total node count.
 *
 * @example
 * ```ts
 * countErrors(rootError); // 7
 * ```
 *
 * @public
 */
export function countErrors(error: ValidationError): number {
  let n = 0;
  walkErrors(error, () => {
    n += 1;
  });
  return n;
}

// ---------------------------------------------------------------------------
// Deprecated: kept exported for source compatibility; absent from user-facing
// docs. Behavior identical to the new canonical names. Removal in v3.
// ---------------------------------------------------------------------------

/**
 * @deprecated Use {@link toJsonObject}. Same return shape; the new name
 *   reflects that it returns an object, not a string. Removal in v3.
 *
 * @public
 */
export function formatJson(error: ValidationError): ValidationError {
  return toJsonObject(error);
}

/**
 * Options for the deprecated {@link summarize}. Use
 * {@link FormatSummaryOptions} instead.
 *
 * @deprecated Use {@link FormatSummaryOptions}. Removal in v3.
 *
 * @public
 */
export interface SummarizeOptions {
  /** @deprecated See {@link FormatSummaryOptions.select}. Removal in v3. */
  select?: SummarizeSelect;
}

/**
 * @deprecated Use {@link FormatSummarySelect}. Note: the new type also
 *   accepts `"all"` for flat all-leaves output. Removal in v3.
 *
 * @public
 */
export type SummarizeSelect = "first" | "deepest" | { byCode: readonly string[] };

/**
 * @deprecated Use {@link formatSummary}. Same defaults and behavior.
 *   Removal in v3.
 *
 * @public
 */
export function summarize(error: ValidationError, options: SummarizeOptions = {}): string {
  return formatSummary(error, options);
}

/**
 * @deprecated Use `formatSummary(err, { select: "all" })`. Removal in v3.
 *
 * @public
 */
export function formatFlat(error: ValidationError): string {
  return formatSummary(error, { select: "all" });
}
