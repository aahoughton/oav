# oav — OpenAPI 3.1 validator

`oav` is an HTTP-aware validation toolkit for OpenAPI 3.1. It compiles JSON
Schema 2020-12 (plus OpenAPI extensions like `discriminator`) to JavaScript
via code generation and produces structured error **trees** — not flat lists —
so callers can decide how to present failures.

## Quick start

```bash
pnpm install
pnpm build
pnpm test
```

Programmatic:

```ts
import { composeReaders, createFileReader, resolveSpec } from "@oav/spec";
import { createValidator } from "@oav/validator";
import { formatText } from "@oav/core";

const reader = composeReaders([createFileReader()]);
const { document } = await resolveSpec({ reader, entry: "openapi.yaml" });
const validator = createValidator(document);

const err = validator.validateRequest({
  method: "POST",
  path: "/pets",
  contentType: "application/json",
  headers: { "x-tenant": "acme" },
  body: { name: "Fido" },
});

if (err !== null) console.error(formatText(err));
```

CLI:

```bash
oav resolve openapi.yaml
oav validate openapi.yaml --request req.http
oav validate openapi.yaml --path "POST /pets" --body payload.json
oav validate openapi.yaml --path "GET /pets" --response --status 200 --body resp.json
```

`--format text|json|flat|github` controls error rendering. `--depth n`
truncates deeply-nested trees. `--overlay file.json` applies spec overlays
(additive paths, per-operation overrides, schema extend / replace).

## Packages

| Package          | Purpose                                              |
| ---------------- | ---------------------------------------------------- |
| `@oav/core`      | Error tree model + formatters + shared OpenAPI types |
| `@oav/schema`    | JSON Schema 2020-12 compiler (codegen → JS)          |
| `@oav/formats`   | Built-in string formats (RFC 3339 / 5321 / 3986 / …) |
| `@oav/spec`      | Multi-file spec loader, resolver, overlay merger     |
| `@oav/router`    | Trie-based OpenAPI path matcher                      |
| `@oav/validator` | HTTP request/response orchestrator                   |
| `@oav/cli`       | `oav` binary                                         |

See each package's README for API reference.

## Dev sub-packages

Two standalone packages in the repo root (own `package.json`, own
install, not part of the main workspace):

- [`conformance/`](./conformance/README.md) — runs the canonical
  JSON Schema Test Suite and OpenAPI scenarios through `@oav/schema`
  and the CLI. See `conformance/REPORT.md` for the latest
  divergence analysis.
- [`performance/`](./performance/README.md) — benchmarks against
  [ajv](https://github.com/ajv-validator/ajv) and
  [@hyperjump/json-schema](https://github.com/hyperjump-io/json-schema).
