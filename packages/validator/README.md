# @oav/validator

HTTP request/response validator for OpenAPI 3.1.

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
- Deserializes parameters per OpenAPI `style` + `explode` (`simple`,
  `form`, `label`, `matrix`, `deepObject`, `spaceDelimited`,
  `pipeDelimited`).
- Content-type negotiation against request's `Content-Type`, including
  wildcards (`application/*`, `*/*`).
- Response status matching: exact → `NXX` class → `default`.
- Built-in format validators from `@oav/formats`; merge extras via
  `createValidator(spec, { formats })`.
- Set `strictQueryParameters: true` to reject undeclared query params.
