# oav

Codegen-based HTTP validator for OpenAPI **3.0**, **3.1**, and **3.2**.
Compiles every operation's schemas to JavaScript at construction time,
then checks live requests and responses against the resulting functions
and returns a **tree of structural errors** you can format, filter, or
walk programmatically.

- One validator call checks method + path + parameters + body + content
  type + status + headers against the spec — not just the JSON body.
- Structured error trees (not flat arrays), so downstream code can
  distinguish a missing `required` property from a `oneOf` branch
  failure from an unsupported `Content-Type`.
- Real 3.0 support (`nullable`, boolean `exclusiveMaximum`,
  `$ref`-suppresses-siblings), not "3.1 and hope".
- Codegen-compiled at construction, cached by schema identity, zero
  per-request version branching. Handles recursive `$ref`, multi-file
  specs, overlays, and custom keywords / formats.

## Install

```bash
npm install @aahoughton/oav
# or: pnpm add @aahoughton/oav
```

The library has a single runtime dependency (`yaml`). The `oav` CLI
additionally needs `commander`, declared as an optional peer — if you
plan to use the CLI, add it explicitly:

```bash
npm install @aahoughton/oav commander
```

## Quick start

```ts
import { createValidator, formatText } from "@aahoughton/oav";
import { composeReaders, createFileReader, loadSpec } from "@aahoughton/oav/spec";

const reader = composeReaders([createFileReader()]);
const { document } = await loadSpec({ reader, entry: "openapi.yaml" });
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

`validateRequest` / `validateResponse` return `null` on success or a
`ValidationError` tree on failure. Every error carries a stable `code`
(e.g. `"type"`, `"required"`, `"content-type"`, `"oneOf"`), a `path`
rooted at the HTTP frame (e.g. `["body", "pets", 3, "name"]`), a
human-readable `message`, and a machine-readable `params` object whose
shape per code is documented in `BuiltInErrorParams`.

## Why this exists

Two motivations drive the design.

**Native OpenAPI 3.0 semantics.** Most OpenAPI validators are thin
wrappers over ajv. That works for 3.1 / 3.2, which use JSON Schema
2020-12 directly, but it translates poorly to 3.0: `type` can't be an
array, `exclusiveMaximum` is a boolean, `nullable` is its own keyword,
and siblings of `$ref` are ignored. oav ships a dedicated 3.0 dialect
alongside the 3.1 / 3.2 one so 3.0 specs validate by 3.0 rules, no
meta-schema rewrite step, no "mostly 3.1 and hope".

**First-class overlays.** Many projects consume an OpenAPI document
they don't own: an upstream framework (Supabase, Directus, Hasura,
PocketBase, ...) or a gateway's published spec. `applyOverlays`
patches the base document programmatically at load time — add a
gateway-required header to every operation, extend a component
schema, swap a response shape in staging — without forking or
preprocessing the upstream file. `loadSpec` stitches external `$ref`s
and applies overlays in a single call.

If you want raw validate-per-second throughput on a spec you already
own end to end, ajv is still the throughput king. If you want
correct 3.0, a structured error tree you can narrow against, and an
overlay model that respects the upstream document, this is the
library.

### Conformance

Published, not claimed. Every number below comes out of
[`conformance/`](./conformance/README.md) on every build:

| Suite                                                                | Result                                                  |
| -------------------------------------------------------------------- | ------------------------------------------------------- |
| [JSON Schema 2020-12 Test Suite](./conformance/REPORT.md) (required) | 1271 / 1290 passing (98.5%)                             |
| JSON Schema 2020-12 Test Suite (+ optional)                          | 1429 / 1452 passing (98.4%)                             |
| OpenAPI request/response scenarios (3.0, 3.1, 3.2 petstores)         | 14 / 14                                                 |
| Real-world specs loaded + compiled by `createValidator`              | Stripe, GitHub, DigitalOcean, Twilio, Asana, Box, Adyen |

Remaining JSON Schema mismatches (`$dynamicRef` runtime scope and a
handful of optional-suite edges) are enumerated in
[`conformance/REPORT.md`](./conformance/REPORT.md). No divergence is
silent.

## CLI

```bash
oav resolve openapi.yaml
oav validate openapi.yaml --request req.http
oav validate openapi.yaml --path "POST /pets" --body payload.json
oav validate openapi.yaml --path "GET /pets" --response --status 200 --body resp.json
```

Flags: `--format text|json|flat|github`, `--depth n`, `--overlay file`
(repeatable), `-o file`, `--quiet`. See
[packages/cli/README.md](./packages/cli/README.md) for the full surface
and the `.http` file format.

## Versions

`createValidator` reads the spec's `openapi` string once at construction
and picks the matching dialect. No per-request branching.

| Spec  | Dialect               | Notes                                                       |
| ----- | --------------------- | ----------------------------------------------------------- |
| 3.0.x | OAS 3.0 Schema Object | `nullable`, boolean `exclusiveMin/Max`, sibling-`$ref` drop |
| 3.1.x | JSON Schema 2020-12   | Assertive `format`                                          |
| 3.2.x | JSON Schema 2020-12   | Same as 3.1 + the `QUERY` HTTP method                       |

Override via `createValidator(spec, { dialect })` to force or customise
one of the built-in dialects (`jsonSchemaDialect`, `openapi31Dialect`,
`oas30Dialect`). Unknown / missing `openapi` strings fall back to the
3.1 dialect by default; configure with
`onUnknownVersion: "throw" | "warn" | "fallback31"`.

## Configuring the validator

| Option                  | Effect                                                         |
| ----------------------- | -------------------------------------------------------------- |
| `dialect`               | Force a specific schema dialect, bypassing version detection.  |
| `formats`               | Extra string format validators merged on top of the built-ins. |
| `keywords`              | Register user-defined schema keywords (see below).             |
| `maxErrors`             | Cap on leaf errors; `1` is fast-fail, default is uncapped.     |
| `strictQueryParameters` | Reject undeclared query parameters. Default `false`.           |
| `onUnknownVersion`      | Policy for specs with missing/unsupported `openapi`.           |

### Custom keywords

```ts
const validator = createValidator(spec, {
  keywords: {
    activeTenant: (data) =>
      typeof data !== "string" || tenantCache.has(data)
        ? true
        : { message: `tenant "${data}" is not active` },
  },
});
```

Custom keywords plug into generated code alongside the built-ins. See
[examples/custom-keywords.ts](./examples/custom-keywords.ts).

### Bounded error collection

```ts
createValidator(spec, { maxErrors: 1 }); // fast-fail
createValidator(spec, { maxErrors: 10 }); // bound CPU/memory on huge payloads
```

Hot loops (array items, object properties, `allOf`/`anyOf` branches)
short-circuit once the budget is exhausted. Results carry
`truncated: true` so callers know the tree was capped.

## Framework integration

`oav` is a validator, not a middleware package: you write a short
adapter between your framework and `validateRequest` /
`validateResponse`. See [**INTEGRATION.md**](./INTEGRATION.md) for:

- Copy-paste adapters for Express 4, Express 5, Fastify, and
  Next.js / Hono / Bun / Deno.
- Recipes for file uploads (multer), response validation, security,
  ignoring paths, and status-code mapping.
- A migration table from `express-openapi-validator`, including
  where oav is stricter or more conformant and where you'll do more
  wiring by hand.

The short version: `oav` is not a drop-in for
`express-openapi-validator`. You own the error → HTTP mapping, you
wire up multer if you need file uploads, and you run your own auth
middleware. In exchange you get a structured error tree, native
OpenAPI 3.0 semantics, overlays, and no monkey-patching of `req` or
`res`.

## Modules

The package publishes a small root and four subpath entrypoints:

| Import                    | Surface                                                  |
| ------------------------- | -------------------------------------------------------- |
| `@aahoughton/oav`         | `createValidator`, error helpers, formatters, types      |
| `@aahoughton/oav/schema`  | `compileSchema`, dialects, vocabularies, custom keywords |
| `@aahoughton/oav/spec`    | `loadSpec`, `resolveSpec`, `applyOverlays`, readers      |
| `@aahoughton/oav/formats` | Built-in string format validators                        |
| `@aahoughton/oav/core`    | Error tree model, shared OpenAPI / HTTP types            |

The `oav` CLI is installed as a `bin` by the same package.

## Examples

Runnable, self-contained TypeScript examples in
[`examples/`](./examples/README.md):

| File                  | Shows                                                |
| --------------------- | ---------------------------------------------------- |
| `basic-validation.ts` | Inline spec → validator → request & response checks  |
| `custom-formats.ts`   | Register a string format                             |
| `custom-keywords.ts`  | Register a schema keyword with dynamic runtime state |
| `max-errors.ts`       | Fast-fail and bounded error collection               |
| `versions.ts`         | 3.0 / 3.1 / 3.2 side by side                         |
| `overlay.ts`          | Apply a spec overlay before validating               |

## Known limitations

- `$dynamicRef` behaves like `$ref` with anchor lookup — no runtime
  dynamic-scope traversal.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for branch / PR / release flow.
Development workflow (lint / typecheck / test / build) and the
conformance and performance sub-packages are described there and in
[CLAUDE.md](./CLAUDE.md).

## License

MIT — see [LICENSE](./LICENSE).
