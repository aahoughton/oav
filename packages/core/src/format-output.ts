import { formatSummary, formatText, toJsonObject } from "./format.js";
import type { ValidationError } from "./errors.js";

/**
 * Single source of truth for the CLI's `--format` flag. The
 * {@link OutputFormat} union and the Commander parser validator both
 * derive from this tuple — add a new name here and extend
 * {@link formatError} to wire it up end-to-end.
 *
 * @public
 */
export const KNOWN_OUTPUT_FORMATS = ["text", "json", "flat"] as const;

/**
 * Supported built-in output formats.
 *
 * @public
 */
export type OutputFormat = (typeof KNOWN_OUTPUT_FORMATS)[number];

/**
 * Type guard: narrows an arbitrary string to {@link OutputFormat} iff
 * it appears in {@link KNOWN_OUTPUT_FORMATS}.
 *
 * @public
 */
export function isOutputFormat(value: string): value is OutputFormat {
  return (KNOWN_OUTPUT_FORMATS as readonly string[]).includes(value);
}

/**
 * A programmatic renderer: any function that turns a
 * {@link ValidationError} tree into a string.
 *
 * @public
 */
export type ErrorRenderer = (err: ValidationError) => string;

/**
 * Format a {@link ValidationError} tree as a string in the requested style.
 *
 * `renderer` may be one of the built-in format names
 * ({@link OutputFormat}) or a caller-supplied function, which lets
 * library consumers plug in SARIF / RFC 7807 / JUnit renderers without
 * forking the dispatch switch.
 *
 * @param err - The error tree.
 * @param renderer - A built-in format name or a custom render function.
 * @param depth - Optional max depth (applies to `"text"` format only).
 * @returns The rendered string.
 *
 * @public
 */
export function formatError(
  err: ValidationError,
  renderer: OutputFormat | ErrorRenderer,
  depth?: number,
): string {
  if (typeof renderer === "function") return renderer(err);
  switch (renderer) {
    case "json":
      return JSON.stringify(toJsonObject(err), null, 2);
    case "flat":
      return formatSummary(err, { select: "all" });
    case "text":
    default:
      return formatText(err, depth !== undefined ? { maxDepth: depth } : {});
  }
}
