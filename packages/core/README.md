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

Which one to reach for:

| Want                                                                      | Use          |
| ------------------------------------------------------------------------- | ------------ |
| One-line string for `response.message`, log lines, Sentry/NR group titles | `summarize`  |
| Multi-line indented tree for stdout, log dumps, human reading             | `formatText` |
| Structured tree for programmatic consumption / JSON round-trip            | `formatJson` |
| One line per leaf for grep, CI diffs                                      | `formatFlat` |

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

For rendering validation failures as an HTTP response. Two response
builders, pick by envelope shape: **`toProblemDetails`** for RFC 9457
`application/problem+json`; **`collectIssues`** when you're keeping a
custom response shape (e.g. preserving an existing
`{ message, errors: [...] }` envelope from a library you're
migrating from).

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
- `collectIssues(err)` — just the flat leaf list, if you're rolling
  your own response shape. Each issue carries both a raw `path`
  (`PathSegment[]`) and a `pointer` — the same path **pre-formatted
  as an [RFC 6901](https://www.rfc-editor.org/rfc/rfc6901) JSON
  Pointer** string (e.g. `/body/users/3/email`). Use `pointer`
  directly for response envelopes; `path` is the segments array if
  you need programmatic access. Don't re-join `path` yourself —
  `pointer` already handles RFC 6901's `~` / `/` escaping.

### Common envelope shapes

```ts
// RFC 9457 (default) — one call.
res
  .status(httpStatusFor(err))
  .type("application/problem+json")
  .json(toProblemDetails(err, { instance: req.originalUrl }));

// Custom envelope, eov-style flat list.
res.status(httpStatusFor(err)).json({
  message: summarize(err),
  errors: collectIssues(err).map((i) => ({
    path: i.pointer,
    message: i.message,
    errorCode: i.code,
  })),
});

// Just the top-level summary (e.g. for a comma-joined "every leaf"
// message that some pre-existing wire formats use):
const joined = collectIssues(err)
  .map((i) => i.message)
  .join(", ");
```

See the [Framework integration](../../README.md#framework-integration)
section of the root README for Express / Fastify / Next.js snippets.
For Express 4 specifically, the
[`@aahoughton/oav-express4`](../oav-express4/README.md) companion
package wraps these helpers as a one-liner middleware; sibling
adapters for Express 5 / Fastify / Hono will follow the same shape.

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
