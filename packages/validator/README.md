# oav (validator)

HTTP request/response validator for OpenAPI 3.0, 3.1, and 3.2. This is
the headline surface of the package — `createValidator` is re-exported
from the package root.

```ts
import { createValidator } from "@aahoughton/oav";

const validator = createValidator(resolvedSpec);

const requestErr = validator.validateRequest({
  method: "POST",
  path: "/pets",
  query: { limit: "10" },
  headers: { "x-tenant": "acme" },
  contentType: "application/json",
  body: { name: "Fido" },
});

const responseErr = validator.validateResponse(
  { method: "GET", path: "/pets" },
  { status: 200, contentType: "application/json", body: [{ name: "Fido" }] },
);
```

Both methods return `null` on success or a `ValidationError` tree on
failure. Errors are rooted at the HTTP frame (`["body", …]`,
`["query", name, …]`, `["header", name, …]`, etc.) so downstream code
can group by location. The top-level node's `code` (`"request"` vs
`"response"`) distinguishes the leg.

`validator.detectedVersion` reflects the `openapi` string that was
detected on construction (or `undefined` if the field was missing or
unsupported and a fallback was used — see `onUnknownVersion` below).

Companion adapter packages wrap the validator as middleware /
hooks: [`oav-express4`](../oav-express4/README.md),
[`oav-express5`](../oav-express5/README.md),
[`oav-fastify`](../oav-fastify/README.md). Each exports the same
`validateRequests` factory plus standalone helpers
(`httpRequestFrom<Framework>`, `renderProblemDetails`).

## Why this validator

Native OpenAPI 3.0 dialect alongside 3.1 / 3.2, so `nullable`,
boolean `exclusiveMaximum`, and `$ref`-suppresses-siblings work by
3.0 rules rather than via a 2020-12 translation shim. Pairs with
[`oav/spec`](../spec/README.md)'s `applyOverlays` for
patching externally-owned base specs at load time. Pass counts against
the upstream test suites live in
[`conformance/REPORT.md`](../../conformance/REPORT.md). The
[top-level README](../../README.md) has the full rationale.

## Features

- **Compile at construction**: every operation's schemas get compiled
  once on `createValidator`, keyed by schema identity. Repeated
  requests reuse the compiled functions.
- **Version-aware**: `openapi` is read once and mapped to one of three
  built-in dialects (OAS 3.0, OpenAPI 3.1, OpenAPI 3.2). No
  per-request branching.
- **`$ref` resolved lazily**: operation-level references (`requestBody`,
  `responses[code]`, `parameters[i]`, `response.headers[name]`) are
  resolved against the spec as needed, so `#/components/*` reuse works
  without preprocessing.
- **Parameter deserialisation**: `simple`, `form`, `label`, `matrix`,
  `deepObject`, `spaceDelimited`, `pipeDelimited` with `explode`.
- **Content-type negotiation**: against the request / response
  `Content-Type`, including wildcards (`application/*`, `*/*`).
- **Response status matching**: exact → `NXX` class → `default`.
- **Format validators**: the `oav/formats` built-ins merged
  with any extras passed via `options.formats`.

## Validator methods

| Method                                        | Purpose                                                                                                                                                                   |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `validateRequest(req)`                        | Check an `HttpRequest` against the spec. Returns `null` on success or a `ValidationError` tree.                                                                           |
| `validateResponse(req, res)`                  | Check an `HttpResponse` against the spec (request is used only for method + path). Returns `null` or a tree.                                                              |
| `validateFetchRequest<T>(request, opts?)`     | Convenience for Web Standards `Request`: reads URL, headers, body; returns a discriminated union with a typed body. See [docs/integration.md](../../docs/integration.md). |
| `validateFetchResponse<T>(request, response)` | Symmetric Web Standards `Response` check. Useful for contract-testing an upstream.                                                                                        |
| `getOperation({ method, path })`              | Startup-time introspection: returns the resolved, overlay-applied `OperationObject` + matched template for a (method, path) pair.                                         |
| `detectedVersion`                             | The `openapi` string detected on construction, or `undefined` for an unrecognised / missing version (see `onUnknownVersion`).                                             |
| `warnings`                                    | `readonly string[]` — warnings accumulated at construction time (`onUnknownVersion: "warn"` or `dialect`-suppressed category error). Empty when neither path fires.       |

## Options

| Option                  | Effect                                                                                                                                          |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `dialect`               | Force a specific {@link Dialect}, bypassing version detection.                                                                                  |
| `formats`               | Extra string format validators merged with `oav/formats`.                                                                                       |
| `keywords`              | User-registered schema keywords (see below).                                                                                                    |
| `maxErrors`             | Cap on leaf errors; `1` is fast-fail. Default: uncapped.                                                                                        |
| `strictQueryParameters` | Reject undeclared query parameters. Default `false`.                                                                                            |
| `validateSecurity`      | Shape-only security check (bearer / basic / apiKey credential location). Default `false` (auth middleware runs upstream); set `true` to opt in. |
| `ignoreUndocumented`    | Return `null` on requests whose path the router can't match. Default `false`.                                                                   |
| `ignorePaths`           | `(path: string) => boolean` predicate that short-circuits validation when it returns `true` (runs before routing).                              |
| `onUnknownVersion`      | `"fallback31"` \| `"warn"` \| `"throw"` when `openapi` is missing or unsupported. Default `"fallback31"`.                                       |

## Custom keywords

```ts
const validator = createValidator(spec, {
  keywords: {
    activeTenant: (data) =>
      typeof data !== "string" || tenantCache.isActive(data)
        ? true
        : { message: `tenant "${data}" is not active` },
  },
});
```

Flag schemas that should be checked:

```yaml
TenantId:
  type: string
  pattern: "^t_[a-z0-9]+$"
  activeTenant: true
```

Custom-keyword errors appear in the tree alongside regular schema
errors, prefixed with the HTTP location (`body.tenantId`, etc.). See
[`examples/custom-keywords.ts`](../../examples/custom-keywords.ts) for
an end-to-end.

## Fast-fail / bounded error collection

```ts
createValidator(spec, { maxErrors: 1 }); // stop after first leaf
createValidator(spec, { maxErrors: 10 }); // cap while still getting useful feedback
```

Hot loops (array items, object properties, `allOf` / `anyOf` branches)
short-circuit once the budget is exhausted, so a 10 MB invalid payload
doesn't cost proportional CPU or memory. Results carry `truncated:
true` when the tree was capped.

## Handling unknown `openapi` versions

Two kinds of "unknown":

- **Category errors** — missing / non-string `openapi`, non-semver
  string, or a major version that isn't `3`. These **throw** at
  construction by default. Set `dialect` to force a specific
  compiler; that suppresses the throw and adds an entry to
  `validator.warnings` so the override is still visible.
- **Unknown minor within 3.x** — e.g. `"3.7.0"` if a future minor
  ships before oav is updated. Governed by `onUnknownVersion`:

  ```ts
  createValidator(spec); // fallback31 default — silent, uses 3.1 dialect
  createValidator(spec, { onUnknownVersion: "throw" }); // refuse to build
  createValidator(spec, { onUnknownVersion: "warn" }); // populates validator.warnings, uses 3.1 dialect
  createValidator(spec, { onUnknownVersion: "warn", warn: (m) => log.info(m) }); // plus live callback
  ```

`validator.detectedVersion` is `undefined` in the fallback cases so
callers can introspect what dialect they got. Warnings from
any path land on `validator.warnings`; the library never writes to
`process.stderr` or `console` on its own.
