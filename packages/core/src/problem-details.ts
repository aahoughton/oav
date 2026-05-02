import { collectLeaves, type PathSegment, type ValidationError } from "./errors.js";
import { formatSummary } from "./format.js";

/**
 * A single validation issue flattened for client consumption. Produced
 * by {@link collectIssues} and embedded in {@link ProblemDetails.issues}.
 *
 * Maps 1:1 to a leaf in the {@link ValidationError} tree: you get the
 * same `code`, `message`, and `params`, plus the path in two forms:
 * the raw segments array (good for programmatic filtering) and an
 * RFC 6901 JSON Pointer (good for display and tools that follow the
 * JSON:API / RFC 9457 conventions).
 *
 * @public
 */
export interface ValidationIssue {
  /** Stable error identifier (e.g. `"type"`, `"required"`, `"content-type"`). */
  code: string;
  /** Raw path segments to the offending data location. */
  path: PathSegment[];
  /** RFC 6901 JSON Pointer form of `path`, e.g. `"/body/pets/3/name"`. */
  pointer: string;
  /** Human-readable description. */
  message: string;
  /** Machine-readable details; shape per-code documented in {@link BuiltInErrorParams}. */
  params: Record<string, unknown>;
}

/**
 * [RFC 9457](https://www.rfc-editor.org/rfc/rfc9457.html) "Problem
 * Details for HTTP APIs" response envelope with a typed `issues`
 * array as an extension member. Render as `application/problem+json`.
 *
 * @public
 */
export interface ProblemDetails {
  /** URI reference identifying the problem type. Defaults to `"about:blank"`. */
  type: string;
  /** Short human-readable summary. Defaults to `"Validation failed"`. */
  title: string;
  /** HTTP status code for the response. Defaults to `400`. */
  status: number;
  /** Human-readable explanation specific to this occurrence. */
  detail: string;
  /** Optional URI reference for this occurrence (typically the request URL). */
  instance?: string;
  /**
   * Flattened validation failures, one per leaf in the underlying
   * {@link ValidationError} tree.
   */
  issues: ValidationIssue[];
}

/**
 * Options for {@link toProblemDetails}.
 *
 * @public
 */
export interface ProblemDetailsOptions {
  /** URI identifying the problem type. Default: `"about:blank"`. */
  type?: string;
  /** Short title. Default: `"Validation failed"`. */
  title?: string;
  /** HTTP status code. Default: `400`. */
  status?: number;
  /** URI reference identifying this specific occurrence (e.g. the request URL). */
  instance?: string;
  /**
   * Override the human-readable `detail`. Defaults to
   * {@link formatSummary}(error): a single line describing the first
   * failing leaf (e.g. `"body.users[0].email must match format \"email\""`).
   * Pass an explicit string for a structural summary like
   * `` `${issues.length} validation error(s)` `` if you'd rather
   * not surface a leaf in `detail`.
   */
  detail?: string;
}

/**
 * Flatten a {@link ValidationError} tree to a list of leaves annotated
 * with an RFC 6901 JSON Pointer. Useful when you want a client-friendly
 * issues array but don't need the {@link ProblemDetails} envelope.
 *
 * Leaf-only by design: branch-level `params` (e.g. `oneOf`'s `matchCount`)
 * are not in the result. Access the raw {@link ValidationError} if you
 * need the tree.
 *
 * @public
 */
export function collectIssues(error: ValidationError): ValidationIssue[] {
  return collectLeaves(error).map((leaf) => ({
    code: leaf.code,
    path: leaf.path,
    pointer: toJsonPointer(leaf.path),
    message: leaf.message,
    params: leaf.params,
  }));
}

/**
 * Convert a {@link ValidationError} tree to an RFC 9457 "Problem
 * Details for HTTP APIs" response body. Render as
 * `application/problem+json` in your HTTP layer.
 *
 * @example
 * ```ts
 * // Express 5
 * const err = validator.validateRequest(httpRequest);
 * if (err !== null) {
 *   res.status(400)
 *      .type("application/problem+json")
 *      .json(toProblemDetails(err, { instance: req.originalUrl }));
 * }
 * ```
 *
 * @public
 */
export function toProblemDetails(
  error: ValidationError,
  options: ProblemDetailsOptions = {},
): ProblemDetails {
  const issues = collectIssues(error);
  const result: ProblemDetails = {
    type: options.type ?? "about:blank",
    title: options.title ?? "Validation failed",
    status: options.status ?? 400,
    detail: options.detail ?? formatSummary(error),
    issues,
  };
  if (options.instance !== undefined) result.instance = options.instance;
  return result;
}

/**
 * Convert a path-segment array to an RFC 6901 JSON Pointer string.
 * Returns `""` for an empty path. `~` and `/` in segments are escaped
 * to `~0` and `~1`.
 */
function toJsonPointer(path: PathSegment[]): string {
  if (path.length === 0) return "";
  return path.map((seg) => "/" + escapeJsonPointerToken(String(seg))).join("");
}

function escapeJsonPointerToken(token: string): string {
  return token.replace(/~/g, "~0").replace(/\//g, "~1");
}
