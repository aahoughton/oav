# @aahoughton/oav (validator)

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
`["query", name, …]`, `["headers", name, …]` on the response side,
etc.) so downstream code can group by location. The top-level node's
`code` (`"request"` vs `"response"`) distinguishes the leg.

`validator.detectedVersion` reflects the `openapi` string that was
detected on construction (or `undefined` if the field was missing or
unsupported and a fallback was used — see `onUnknownVersion` below).

## Why this validator

Native OpenAPI 3.0 dialect alongside 3.1 / 3.2, so `nullable`,
boolean `exclusiveMaximum`, and `$ref`-suppresses-siblings work by
3.0 rules rather than via a 2020-12 translation shim. Pairs with
[`@aahoughton/oav/spec`](../spec/README.md)'s `applyOverlays` for
patching externally-owned base specs at load time. Published
conformance numbers (98.5% on the 1290-case JSON Schema Test Suite,
100% on the OpenAPI request/response cases) live at
[`conformance/REPORT.md`](../../conformance/REPORT.md). The
[top-level README](../../README.md#why-this-exists) has the full
rationale.

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
- **Format validators**: the `@aahoughton/oav/formats` built-ins merged
  with any extras passed via `options.formats`.

## Options

| Option                  | Effect                                                                |
| ----------------------- | --------------------------------------------------------------------- |
| `dialect`               | Force a specific {@link Dialect}, bypassing version detection.        |
| `formats`               | Extra string format validators merged with `@aahoughton/oav/formats`. |
| `keywords`              | User-registered schema keywords (see below).                          |
| `maxErrors`             | Cap on leaf errors; `1` is fast-fail. Default: uncapped.              |
| `strictQueryParameters` | Reject undeclared query parameters. Default `false`.                  |
| `onUnknownVersion`      | `"fallback31"` \| `"warn"` \| `"throw"` when `openapi` is missing.    |

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

Specs in the wild sometimes omit the `openapi` field or declare an
unsupported value. The default — `onUnknownVersion: "fallback31"` —
silently uses the 3.1 dialect. For stricter environments:

```ts
createValidator(spec, { onUnknownVersion: "throw" }); // refuse to build
createValidator(spec, { onUnknownVersion: "warn" }); // stderr message, use 3.1
```

`validator.detectedVersion` is `undefined` in the fallback cases so
callers can introspect what dialect they actually got.
