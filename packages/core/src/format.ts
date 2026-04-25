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
 * Every node renders as `<path> — <message> [<code>]`. Children are indented
 * under their parent. The output is meant for terminals and logs, not for
 * programmatic consumption — use {@link formatJson} or {@link formatFlat}
 * for that.
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
    const pathPart = location.length > 0 ? `${location} — ` : "";
    lines.push(`${prefix}${pathPart}${node.message} [${node.code}]`);
    for (const child of node.children) render(child, depth + 1);
  };
  render(error, 0);
  return lines.join("\n");
}

/**
 * Render a {@link ValidationError} tree as the raw tree — identical to the
 * input, but guaranteed to round-trip through `JSON.stringify`/`JSON.parse`.
 *
 * @param error - Root of the error tree.
 * @returns The same tree, safe to hand to `JSON.stringify`.
 *
 * @example
 * ```ts
 * JSON.stringify(formatJson(rootError), null, 2);
 * ```
 *
 * @public
 */
export function formatJson(error: ValidationError): ValidationError {
  return {
    code: error.code,
    path: [...error.path],
    message: error.message,
    params: { ...error.params },
    children: error.children.map(formatJson),
  };
}

/**
 * Render every leaf of a {@link ValidationError} tree as one line, each
 * prefixed with the joined path. Intended for `grep`-style consumption and
 * `diff`s in CI.
 *
 * @param error - Root of the error tree.
 * @returns A newline-separated string, one line per leaf.
 *
 * @example
 * ```ts
 * const flat = formatFlat(rootError);
 * // body.users[0].email — must match format "email" [format]
 * // body.users[1].age — must be >= 0 [minimum]
 * ```
 *
 * @public
 */
export function formatFlat(error: ValidationError): string {
  const lines: string[] = [];
  for (const leaf of collectLeaves(error)) {
    const location = joinPath(leaf.path);
    const pathPart = location.length > 0 ? `${location} — ` : "";
    lines.push(`${pathPart}${leaf.message} [${leaf.code}]`);
  }
  return lines.join("\n");
}

/**
 * Leaf-selection policy for {@link summarize}.
 *
 * - `"first"` — the first leaf in tree-traversal order. Matches
 *   `express-openapi-validator`'s top-level `message`. The default.
 * - `"deepest"` — the leaf with the longest path. More informative
 *   on `oneOf` / composition trees where the structural cause sits
 *   one or two levels in. Tiebreak: first encountered.
 * - `{ byCode }` — priority list of error codes. Returns the first
 *   leaf whose `code` matches the highest-priority entry; if no leaf
 *   matches any listed code, falls back to the `"first"` policy.
 *
 * @public
 */
export type SummarizeSelect = "first" | "deepest" | { byCode: readonly string[] };

/**
 * Options for {@link summarize}.
 *
 * @public
 */
export interface SummarizeOptions {
  /** How to pick the leaf to summarise. Defaults to `"first"`. */
  select?: SummarizeSelect;
}

/**
 * Render a {@link ValidationError} tree as a single human-readable line —
 * the kind of string every HTTP adapter needs for response-body
 * `message` fields, log lines, error-monitoring titles, and
 * `Error.message`.
 *
 * Picks one leaf per the {@link SummarizeOptions.select} policy and
 * renders it as `<dotted-path> <message>` (or just `<message>` when
 * the path is empty). Use {@link formatFlat} or {@link formatText}
 * when you need the full tree.
 *
 * @example
 * ```ts
 * summarize(rootError);
 * // "body.users[0].email must match format \"email\""
 *
 * summarize(rootError, { select: { byCode: ["content-type", "required"] } });
 * // returns the content-type leaf if any, else the first required leaf,
 * // else the first leaf overall.
 * ```
 *
 * @public
 */
export function summarize(error: ValidationError, options: SummarizeOptions = {}): string {
  const select = options.select ?? "first";
  // collectLeaves defines a leaf as any node with no children, so even
  // a single-leaf root yields one entry — leaves[0] is always present.
  const leaves = collectLeaves(error);

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
