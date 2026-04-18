import { formatFlat, formatGithub, formatJson, formatText, type ValidationError } from "@oav/core";

export const KNOWN_OUTPUT_FORMATS = ["text", "json", "flat", "github"] as const;

/**
 * Supported output formats for the CLI.
 *
 * @public
 */
export type OutputFormat = (typeof KNOWN_OUTPUT_FORMATS)[number];

export function isOutputFormat(value: string): value is OutputFormat {
  return (KNOWN_OUTPUT_FORMATS as readonly string[]).includes(value);
}

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
