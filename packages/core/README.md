# oav/core

Error tree model, shared OpenAPI / HTTP types, and output formatters.
Imported by every other module in the package and — because the error
tree is what `validateRequest` / `validateResponse` return — the
closest thing to a "read me first" for library consumers.

This subpath is available from both `@aahoughton/oav/core` and
`@aahoughton/oav-core/core`; the imports below work identically
against either package.

```ts
import {
  formatText,
  collectLeaves,
  type ValidationError,
  type ErrorParamsFor,
} from "@aahoughton/oav/core";
```

## Error tree

```ts
interface ValidationError {
  code: string; // "type", "required", "oneOf", "content-type", ...
  path: PathSegment[]; // (string | number)[] — rooted at the HTTP frame
  message: string; // human-readable
  params: Record<string, unknown>; // machine-readable; shape per code in BuiltInErrorParams
  children: ValidationError[]; // always an array; [] for leaves
}
```

Every node has a `children` array — leaves have `children: []`, branches
have one child per relevant sub-failure (e.g. one per failing `oneOf`
branch). Consumers can traverse without null checks.

Construct nodes with `createLeafError()` and `createBranchError()`.
Walk with `walkErrors(root, (node, depth) => ...)`; collect leaves with
`collectLeaves(root)`.

## Typed `params` via `BuiltInErrorParams`

Each built-in `code` has a documented `params` shape. Narrow at the
read site with the exported `ErrorParamsFor<Code>` helper:

```ts
function describe(err: ValidationError): string {
  if (err.code === "required") {
    const p = err.params as ErrorParamsFor<"required">;
    return `missing: ${p.missing}`;
  }
  if (err.code === "content-type") {
    const p = err.params as ErrorParamsFor<"content-type">;
    return `got ${p.contentType}, accepted ${p.accepted?.join(", ")}`;
  }
  return err.message;
}
```

The `BuiltInErrorParams` interface covers every built-in schema and
HTTP-level `code`. Custom keywords add their own entries via TypeScript
declaration merging.

## Formatters

Tree formatters — produce strings suitable for stdout / logs.

- `formatText(err, { maxDepth?, indent? })` — indented human-readable.
- `formatJson(err)` — deep copy that round-trips through `JSON.stringify`.
- `formatFlat(err)` — one line per leaf.

Single-line summary — for response-body `message` fields, log lines,
error-monitoring titles, and `Error.message`:

- `summarize(err, { select? })` — picks one leaf and renders it as
  `<dotted-path> <message>` (e.g. `"body.users[0].email must match
format \"email\""`).
  - `select: "first"` (default) — first leaf in tree-traversal
    order. Matches `express-openapi-validator`'s top-level message.
  - `select: "deepest"` — leaf with the longest path; more
    informative on `oneOf` / composition trees.
  - `select: { byCode: ["content-type", "required", ...] }` —
    priority list. Returns the first leaf matching the
    highest-priority listed code; falls back to `"first"` if no
    match. Useful when the wire format wants to surface specific
    failure categories first.

`countErrors(err)` returns the total number of nodes in the tree.

## HTTP response helpers

For rendering validation failures as an HTTP response:

- `httpStatusFor(err, overrides?)` — maps a `ValidationError` tree to
  an HTTP status code. Defaults: `route` → 404, `method` → 405,
  `security` → 401, `content-type` → 415, `status` → 500, else 400.
  Correctly inspects the tree shape (some codes appear as leaves
  under a top-level `"request"` / `"response"` branch, not as
  `err.code`). Pass `{ default: 422 }` etc. to override a slot.
- `allowHeaderFor(err)` — returns the comma-joined `Allow` header
  value for a 405, or `undefined` otherwise (RFC 9110 §15.5.6).
- `toProblemDetails(err, { type?, title?, status?, detail?, instance? })` —
  RFC 9457 `application/problem+json` envelope with a typed `issues`
  array as an extension member. Defaults: `about:blank` type,
  `"Validation failed"` title, status `400`, and `detail` = `summarize(err)`
  (first failing leaf). Pass `detail` explicitly for a structural
  summary like `` `${pd.issues.length} validation errors` `` or any
  other override.
- `collectIssues(err)` — just the flat leaf list (with
  `path` segments + RFC 6901 `pointer` strings), if you're rolling
  your own response shape.

See the [Framework integration](../../README.md#framework-integration)
section of the root README for Express / Fastify / Next.js snippets.

## OpenAPI / HTTP types

Re-exports the shapes the rest of the package needs from OpenAPI 3.0 /
3.1 / 3.2 (`OpenAPIDocument`, `PathItem`, `OperationObject`,
`ParameterObject`, `RequestBodyObject`, `ResponseObject`, `SchemaObject`,
`SchemaOrBoolean`, `ReferenceObject`, …) and HTTP (`HttpRequest`,
`HttpResponse`, `HttpMethod`).

`OperationObject.requestBody`, `OperationObject.responses[code]`,
`parameters[i]`, and `ResponseObject.headers[name]` each widen to
`T | ReferenceObject` so the types track the wire shape. The validator
resolves those references internally; callers who work with the raw
spec (e.g. overlays, custom tooling) handle them explicitly.

## Version detection

```ts
import { detectOpenAPIVersion } from "@aahoughton/oav/core";

detectOpenAPIVersion({ openapi: "3.0.3", info: {}, paths: {} }); // "3.0"
detectOpenAPIVersion({ openapi: "3.2.0", info: {}, paths: {} }); // "3.2"
detectOpenAPIVersion({ openapi: "99.0", info: {}, paths: {} }); // undefined
```

`createValidator` uses this at construction time to pick a dialect;
direct calls are rare.
