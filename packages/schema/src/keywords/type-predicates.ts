/**
 * Emit a JS expression that is `true` iff `dataExpr` has the given
 * JSON-Schema type name (`"null" | "boolean" | "string" | "array" |
 * "object" | "number" | "integer"`). Unknown type names yield `"false"`.
 *
 * Shared by the 2020-12 `type` keyword and the OAS 3.0 `type` keyword so
 * the two dialects cannot drift on type-classification semantics.
 *
 * @internal
 */
export function typePredicate(dataExpr: string, typeName: string): string {
  switch (typeName) {
    case "null":
      return `${dataExpr} === null`;
    case "boolean":
      return `typeof ${dataExpr} === "boolean"`;
    case "string":
      return `typeof ${dataExpr} === "string"`;
    case "array":
      return `Array.isArray(${dataExpr})`;
    case "object":
      return `(typeof ${dataExpr} === "object" && ${dataExpr} !== null && !Array.isArray(${dataExpr}))`;
    case "number":
      return `(typeof ${dataExpr} === "number" && Number.isFinite(${dataExpr}))`;
    case "integer":
      return `(typeof ${dataExpr} === "number" && Number.isFinite(${dataExpr}) && Number.isInteger(${dataExpr}))`;
    default:
      return "false";
  }
}

/**
 * Emit a JS expression that is `true` iff `dataExpr`'s JSON-Schema type is
 * NOT in `expected`. Used by both the 2020-12 and OAS 3.0 `type` keywords
 * to gate error emission.
 *
 * @internal
 */
export function buildTypeMismatchCondition(dataExpr: string, expected: string[]): string {
  const predicates = expected.map((t) => typePredicate(dataExpr, t));
  return `!(${predicates.join(" || ")})`;
}
