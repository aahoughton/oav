/**
 * The error model shared by every layer of the @oav validator. All errors form
 * a tree: every node has a {@link ValidationError.children} array (possibly
 * empty) regardless of whether it is a leaf or a branch. Applicator keywords
 * (oneOf, allOf, etc.) and HTTP-level validators produce branch nodes; simple
 * keywords (type, required, maxLength, etc.) produce leaves.
 */

/**
 * A segment of a data or schema path. Property names are strings; array
 * indices are numbers. Paths are never pre-joined — consumers choose how
 * to render them.
 *
 * @public
 */
export type PathSegment = string | number;

/**
 * A single validation error, always a node in a {@link ValidationError} tree.
 *
 * Every error has a `children` array — leaf errors have `children: []`,
 * branch errors produced by applicator keywords have one child per relevant
 * subschema. Consumers can traverse without null checks.
 *
 * @remarks
 * The `code` field is a stable identifier (e.g. `"type"`, `"required"`,
 * `"oneOf"`, `"body"`) suitable for programmatic matching. The `message`
 * field is free-form human-readable text and SHOULD NOT be pattern-matched.
 * Machine-readable details live in `params`.
 *
 * @public
 */
export interface ValidationError {
  /** Stable identifier of the keyword or validation layer that produced this error. */
  code: string;
  /** Path segments pointing at the offending data location. */
  path: PathSegment[];
  /** Human-readable description of the failure. */
  message: string;
  /** Keyword-specific machine-readable details. */
  params: Record<string, unknown>;
  /** Child errors; always an array, empty for leaf errors. */
  children: ValidationError[];
}

/**
 * Parameters accepted by {@link createError}.
 *
 * @public
 */
export interface CreateErrorParams {
  /** Stable identifier of the keyword/layer. */
  code: string;
  /** Path segments of the offending data. */
  path: PathSegment[];
  /** Human-readable message. */
  message: string;
  /** Machine-readable details. Defaults to `{}`. */
  params?: Record<string, unknown>;
  /** Child errors. Defaults to `[]`. */
  children?: ValidationError[];
}

/**
 * Construct a {@link ValidationError}, supplying defaults for `params` and
 * `children` so callers never have to write `params: {}, children: []`.
 *
 * @param params - Fields describing the error.
 * @returns A new {@link ValidationError} with `children` guaranteed to be an array.
 *
 * @example
 * ```ts
 * const err = createError({
 *   code: "type",
 *   path: ["body", "age"],
 *   message: "must be number",
 *   params: { expected: "number", actual: "string" },
 * });
 * // err.children === []
 * ```
 *
 * @public
 */
export function createError(params: CreateErrorParams): ValidationError {
  // Snapshot path — generated validators reuse a single mutable path array
  // across traversal (push/pop per depth), so freezing the segments here
  // protects the error from later mutations.
  return {
    code: params.code,
    path: [...params.path],
    message: params.message,
    params: params.params ?? {},
    children: params.children ?? [],
  };
}

/**
 * Construct a leaf error. Equivalent to {@link createError} with an empty
 * `children` array; exists to make intent explicit at call sites.
 *
 * @param code - Stable identifier (e.g. `"type"`, `"required"`).
 * @param path - Path segments to the offending data.
 * @param message - Human-readable description.
 * @param params - Optional machine-readable details.
 * @returns A new leaf {@link ValidationError}.
 *
 * @example
 * ```ts
 * createLeafError("type", ["body", "age"], "must be number", {
 *   expected: "number",
 * });
 * ```
 *
 * @public
 */
export function createLeafError(
  code: string,
  path: PathSegment[],
  message: string,
  params: Record<string, unknown> = {},
): ValidationError {
  // See note in {@link createError} on snapshotting.
  return { code, path: [...path], message, params, children: [] };
}

/**
 * Construct a branch error that wraps a list of child errors (e.g. the
 * per-branch failures of an `oneOf` keyword).
 *
 * @param code - Stable identifier (e.g. `"oneOf"`, `"allOf"`, `"body"`).
 * @param path - Path segments to the offending data.
 * @param message - Human-readable description.
 * @param children - Child errors.
 * @param params - Optional machine-readable details.
 * @returns A new branch {@link ValidationError}.
 *
 * @example
 * ```ts
 * createBranchError(
 *   "oneOf",
 *   ["body"],
 *   "must match exactly one of 2 schemas",
 *   [branch0Error, branch1Error],
 *   { matchCount: 0 },
 * );
 * ```
 *
 * @public
 */
export function createBranchError(
  code: string,
  path: PathSegment[],
  message: string,
  children: ValidationError[],
  params: Record<string, unknown> = {},
): ValidationError {
  // See note in {@link createError} on snapshotting.
  return { code, path: [...path], message, params, children };
}

/**
 * Walk a {@link ValidationError} tree in pre-order, visiting every node
 * (branch and leaf).
 *
 * @param error - Root of the error tree.
 * @param visit - Callback invoked once per node with the node and its depth.
 *
 * @example
 * ```ts
 * walkErrors(root, (err, depth) => {
 *   console.log(" ".repeat(depth) + err.code);
 * });
 * ```
 *
 * @public
 */
export function walkErrors(
  error: ValidationError,
  visit: (error: ValidationError, depth: number) => void,
): void {
  const stack: Array<{ node: ValidationError; depth: number }> = [{ node: error, depth: 0 }];
  while (stack.length > 0) {
    const entry = stack.pop();
    if (entry === undefined) break;
    visit(entry.node, entry.depth);
    for (let i = entry.node.children.length - 1; i >= 0; i -= 1) {
      const child = entry.node.children[i];
      if (child !== undefined) {
        stack.push({ node: child, depth: entry.depth + 1 });
      }
    }
  }
}

/**
 * Collect every leaf error (any node with `children.length === 0`) in a
 * {@link ValidationError} tree. Order is a pre-order traversal.
 *
 * @param error - Root of the error tree.
 * @returns The flat list of leaves in traversal order.
 *
 * @example
 * ```ts
 * const leaves = collectLeaves(rootError);
 * leaves.forEach((leaf) => console.log(leaf.code));
 * ```
 *
 * @public
 */
export function collectLeaves(error: ValidationError): ValidationError[] {
  const leaves: ValidationError[] = [];
  walkErrors(error, (node) => {
    if (node.children.length === 0) leaves.push(node);
  });
  return leaves;
}

/**
 * Format a path as a JSON-Pointer-ish dotted string, e.g.
 * `body.users[3].email`. Intended for human consumption; not a spec-conformant
 * JSON Pointer.
 *
 * @param path - Path segments.
 * @returns A dotted path string, or `""` if empty.
 *
 * @example
 * ```ts
 * joinPath(["body", "users", 3, "email"]); // "body.users[3].email"
 * ```
 *
 * @public
 */
export function joinPath(path: PathSegment[]): string {
  let out = "";
  for (const segment of path) {
    if (typeof segment === "number") {
      out += `[${segment}]`;
    } else if (out.length === 0) {
      out = segment;
    } else {
      out += `.${segment}`;
    }
  }
  return out;
}
