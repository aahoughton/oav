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
 * Render a {@link ValidationError} tree as a sequence of GitHub Actions
 * workflow commands, one `::error::` line per leaf.
 *
 * @remarks
 * Paths are emitted as the `title` field; the `file` field is left blank
 * because validation errors are data-level, not file-level. Callers who want
 * file annotations should post-process.
 *
 * @param error - Root of the error tree.
 * @returns A newline-separated string ready to print in a GitHub Actions run.
 *
 * @example
 * ```ts
 * console.log(formatGithub(rootError));
 * // ::error title=body.email::must match format "email"
 * ```
 *
 * @public
 */
export function formatGithub(error: ValidationError): string {
  const lines: string[] = [];
  for (const leaf of collectLeaves(error)) {
    const title = joinPath(leaf.path);
    const message = escapeGithub(leaf.message);
    if (title.length > 0) {
      lines.push(`::error title=${escapeGithubProp(title)}::${message}`);
    } else {
      lines.push(`::error::${message}`);
    }
  }
  return lines.join("\n");
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

function escapeGithub(value: string): string {
  return value.replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
}

function escapeGithubProp(value: string): string {
  return escapeGithub(value).replace(/:/g, "%3A").replace(/,/g, "%2C");
}
