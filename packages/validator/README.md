# @oav/validator

HTTP request/response validator for OpenAPI 3.0, 3.1, and 3.2.

```ts
import { createValidator } from "@oav/validator";

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
failure. The tree groups errors by HTTP location (`body`, `query`,
`header`, `path`, `cookie`, `response.*`).

## Features

- Pre-compiles every operation's schemas on construction (cached by schema
  identity).
- Version-aware: reads the spec's `openapi` string once and picks a
  dialect — OAS 3.0 Schema Object for 3.0.x, JSON Schema 2020-12 for
  3.1.x / 3.2.x. The 3.2 `QUERY` method routes like any other method.
- Resolves `$ref` at operation level (`requestBody`, `responses[code]`,
  `parameters[i]`, `response.headers[name]`), so specs that reuse
  `#/components/*` work without preprocessing.
- Deserializes parameters per OpenAPI `style` + `explode` (`simple`,
  `form`, `label`, `matrix`, `deepObject`, `spaceDelimited`,
  `pipeDelimited`).
- Content-type negotiation against request's `Content-Type`, including
  wildcards (`application/*`, `*/*`).
- Response status matching: exact → `NXX` class → `default`.
- Built-in format validators from `@oav/formats`; merge extras via
  `createValidator(spec, { formats })`.

## Options

| Option                   | Effect                                                     |
| ------------------------ | ---------------------------------------------------------- |
| `formats`                | Extra string format validators merged with `@oav/formats`. |
| `keywords`               | User-registered schema keywords (see below).               |
| `maxErrors`              | Cap on leaf errors; `1` is fast-fail. Default: uncapped.   |
| `strictQueryParameters`  | Reject undeclared query parameters. Default: `false`.      |
| `vocabularies`           | Override the dialect entirely (skips version dispatch).    |

## Custom keywords

```ts
const v = createValidator(spec, {
  keywords: {
    activeTenant: (data, _schemaValue) =>
      typeof data !== "string" || tenantCache.isActive(data)
        ? true
        : { message: `tenant "${data}" is not active` },
  },
});
```

In the spec, flag schemas with the keyword:

```yaml
TenantId:
  type: string
  pattern: '^t_[a-z0-9]+$'
  activeTenant: true
```

The validator's error tree includes the custom leaf alongside regular
schema errors, prefixed with the HTTP location (`body.tenantId`, etc.).
See [`examples/custom-keywords.ts`](../../examples/custom-keywords.ts)
for a runnable end-to-end.

## Fast-fail / bounded error collection

```ts
const v = createValidator(spec, { maxErrors: 1 }); // stop after first leaf
// or: { maxErrors: 10 } — bound CPU/memory on huge invalid payloads.
```

Hot loops (array items, object properties, `allOf` / `anyOf` branches)
short-circuit once the budget is exhausted, so a 10 MB array with
per-element structural errors doesn't cost proportional CPU or memory.
The returned error tree may be shorter than the exhaustive one would
have been.
