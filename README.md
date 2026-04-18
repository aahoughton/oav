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

| Spec   | Dialect               | Notes                                          |
| ------ | --------------------- | ---------------------------------------------- |
| 3.0.x  | OAS 3.0 Schema Object | `nullable`, boolean `exclusiveMin/Max`, sibling-`$ref` drop |
| 3.1.x  | JSON Schema 2020-12   | Assertive `format`                             |
| 3.2.x  | JSON Schema 2020-12   | Same as 3.1 + the `QUERY` HTTP method          |

Override via `createValidator(spec, { dialect })` to force or customise
one of the built-in dialects (`jsonSchemaDialect`, `openapi31Dialect`,
`oas30Dialect`). Unknown / missing `openapi` strings fall back to the
3.1 dialect by default; configure with
`onUnknownVersion: "throw" | "warn" | "fallback31"`.

## Configuring the validator

| Option                  | Effect                                                           |
| ----------------------- | ---------------------------------------------------------------- |
| `dialect`               | Force a specific schema dialect, bypassing version detection.    |
| `formats`               | Extra string format validators merged on top of the built-ins.   |
| `keywords`              | Register user-defined schema keywords (see below).               |
| `maxErrors`             | Cap on leaf errors; `1` is fast-fail, default is uncapped.       |
| `strictQueryParameters` | Reject undeclared query parameters. Default `false`.             |
| `onUnknownVersion`      | Policy for specs with missing/unsupported `openapi`.             |

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
createValidator(spec, { maxErrors: 1 });   // fast-fail
createValidator(spec, { maxErrors: 10 });  // bound CPU/memory on huge payloads
```

Hot loops (array items, object properties, `allOf`/`anyOf` branches)
short-circuit once the budget is exhausted. Results carry
`truncated: true` so callers know the tree was capped.

## Modules

The package publishes a small root and four subpath entrypoints:

| Import                          | Surface                                                |
| ------------------------------- | ------------------------------------------------------ |
| `@aahoughton/oav`               | `createValidator`, error helpers, formatters, types    |
| `@aahoughton/oav/schema`        | `compileSchema`, dialects, vocabularies, custom keywords |
| `@aahoughton/oav/spec`          | `loadSpec`, `resolveSpec`, `applyOverlays`, readers    |
| `@aahoughton/oav/formats`       | Built-in string format validators                      |
| `@aahoughton/oav/core`          | Error tree model, shared OpenAPI / HTTP types          |

The `oav` CLI is installed as a `bin` by the same package.

## Examples

Runnable, self-contained TypeScript examples in
[`examples/`](./examples/README.md):

| File                    | Shows                                                    |
| ----------------------- | -------------------------------------------------------- |
| `basic-validation.ts`   | Inline spec → validator → request & response checks     |
| `custom-formats.ts`     | Register a string format                                 |
| `custom-keywords.ts`    | Register a schema keyword with dynamic runtime state    |
| `max-errors.ts`         | Fast-fail and bounded error collection                   |
| `versions.ts`           | 3.0 / 3.1 / 3.2 side by side                            |
| `overlay.ts`            | Apply a spec overlay before validating                   |

## Known limitations

- `unevaluatedProperties` / `unevaluatedItems` do not propagate
  evaluation sets across `allOf` / `anyOf` / `oneOf`. Covers the common
  case; may produce false positives under composition.
- `$dynamicRef` behaves like `$ref` with anchor lookup — no runtime
  dynamic-scope traversal.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for branch / PR / release flow.
Development workflow (lint / typecheck / test / build) and the
conformance and performance sub-packages are described there and in
[CLAUDE.md](./CLAUDE.md).

## License

MIT — see [LICENSE](./LICENSE).
