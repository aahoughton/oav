# @oav/core

The error tree model, shared types, and output formatters used across the
`@oav` validator packages.

## Error tree

```ts
interface ValidationError {
  code: string; // "type", "required", "oneOf", ...
  path: PathSegment[]; // (string | number)[]
  message: string; // human-readable
  params: Record<string, unknown>; // machine-readable
  children: ValidationError[]; // always an array; [] for leaves
}
```

Construct nodes with `createLeafError()` and `createBranchError()`.
Traverse with `walkErrors(root, (node, depth) => ...)` or collect leaves
via `collectLeaves(root)`.

## Formatters

All four produce strings you can hand to stdout/stderr.

- `formatText(err, { maxDepth, indent })` — indented human-readable.
- `formatJson(err)` — a deep-copied tree that round-trips through
  `JSON.stringify` / `JSON.parse`.
- `formatFlat(err)` — one line per leaf.
- `formatGithub(err)` — GitHub Actions `::error::` annotations.

## Types

Re-exports the shapes `@oav` needs from OpenAPI 3.0 / 3.1 / 3.2 and HTTP:
`OpenAPIDocument`, `PathItem`, `OperationObject`, `ParameterObject`,
`ReferenceObject`, `SchemaObject`, `SchemaOrBoolean`, `HttpRequest`,
`HttpResponse`, etc. `OperationObject.requestBody`,
`OperationObject.responses[code]`, `parameters[i]`, and
`ResponseObject.headers[name]` each widen to `T | ReferenceObject` so
the types track the wire shape.

## Version detection

```ts
import { detectOpenAPIVersion } from "@oav/core";

detectOpenAPIVersion({ openapi: "3.0.3", info: {}, paths: {} }); // "3.0"
detectOpenAPIVersion({ openapi: "3.2.0", info: {}, paths: {} }); // "3.2"
detectOpenAPIVersion({ openapi: "99.0", info: {}, paths: {} }); // undefined
```

`@oav/validator` uses this at construction to pick a dialect — callers
rarely need to invoke it directly.
