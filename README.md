# oav — OpenAPI validator

`oav` is an HTTP-aware validation toolkit for OpenAPI **3.0.x**, **3.1.x**,
and **3.2.x** (including the new `QUERY` method). It compiles JSON Schema
2020-12 — plus the OpenAPI 3.0 Schema Object flavour and OpenAPI extensions
like `discriminator` — to JavaScript via code generation, and produces
structured error **trees** so callers can decide how to present failures.

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
truncates deeply-nested trees. `--overlay file.json` applies spec overlays.

## Versions

`createValidator` reads the spec's `openapi` string once at construction
and dispatches to the matching dialect — zero per-request branching.

| Spec version | Status    | Dialect                            |
| ------------ | --------- | ---------------------------------- |
| 3.0.x        | Supported | OAS 3.0 Schema Object flavour      |
| 3.1.x        | Supported | JSON Schema 2020-12                |
| 3.2.x        | Supported | JSON Schema 2020-12 + QUERY method |

The 3.0 dialect handles string-only `type`, `nullable: true`, boolean
`exclusiveMaximum` / `exclusiveMinimum`, and `$ref`-suppresses-siblings.
`ReferenceObject`s at `requestBody`, `responses[code]`, `parameters[i]`,
and `response.headers[name]` are resolved against the spec at construction
time, so real-world specs that reuse components work out of the box.

## Noteworthy options

- **`maxErrors`** — cap on leaf errors collected per validation. Default is
  uncapped; `1` gives classic fast-fail; a small number (say 10) bounds
  CPU/memory on large payloads. When the cap is hit, results carry
  `truncated: true`.
- **`keywords`** — register user-defined schema keywords that plug into
  generated code alongside the built-ins. Good for rules too dynamic for
  the spec (active-tenant check, Luhn, tick-size multiples, …).
- **`formats`** — extra string format validators merged on top of
  `@oav/formats`' built-ins.
- **`vocabularies`** — override the dialect entirely for advanced use.

## Examples

Runnable, self-contained TypeScript examples live in
[`examples/`](./examples/README.md):

- `basic-validation.ts` — spec → validator → request & response
- `custom-formats.ts` — register a string format
- `custom-keywords.ts` — register a schema keyword
- `max-errors.ts` — fast-fail and bounded error collection
- `versions.ts` — 3.0, 3.1, and 3.2 side by side
- `overlay.ts` — apply an overlay before validating

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
