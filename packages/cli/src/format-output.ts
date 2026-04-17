import { formatFlat, formatGithub, formatJson, formatText, type ValidationError } from "@oav/core";

/**
 * Supported output formats for the CLI.
 *
 * @public
 */
export type OutputFormat = "text" | "json" | "flat" | "github";

/**
 * Format a {@link ValidationError} tree as a string in the requested style.
 *
 * @param err - The error tree.
 * @param format - One of `"text" | "json" | "flat" | "github"`.
 * @param depth - Optional max depth (applies to `text` format).
 * @returns The rendered string.
 *
 * @public
 */
export function formatError(err: ValidationError, format: OutputFormat, depth?: number): string {
  switch (format) {
    case "json":
      return JSON.stringify(formatJson(err), null, 2);
    case "flat":
      return formatFlat(err);
    case "github":
      return formatGithub(err);
    case "text":
    default:
      return formatText(err, depth !== undefined ? { maxDepth: depth } : {});
  }
}
