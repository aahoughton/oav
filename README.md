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

`oav` ships in two packages so consumers on constrained runtimes can
skip what they don't use:

| Package                | When to use                                                                                                                                                                                    |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@aahoughton/oav`      | Default. Batteries-included: adds YAML readers and the `oav` CLI. Depends on `yaml`; `commander` and `esbuild` are optional peers (CLI; `esbuild` only for `oav compile --standalone`).        |
| `@aahoughton/oav-core` | Lean alternative. Zero runtime dependencies. Same programmatic surface as `@aahoughton/oav`, minus the YAML readers and CLI. Feed it JSON specs (or pre-parsed objects via the memory reader). |

```bash
npm install @aahoughton/oav
# or: pnpm add @aahoughton/oav
```

```bash
npm install @aahoughton/oav-core           # lean install, JSON-only
```

`@aahoughton/oav` re-exports `@aahoughton/oav-core` at matching
subpaths. Samples below use `@aahoughton/oav`; on the lean package,
substitute `@aahoughton/oav-core` in imports that don't touch the
YAML readers (`createYamlFileReader`, `createSmartHttpReader`) or
the CLI. If you plan to use the CLI, add `commander`; if you plan to
use `oav compile --standalone` (self-contained validator bundles),
also add `esbuild`:

```bash
npm install @aahoughton/oav commander
# or, if you also need --standalone:
npm install @aahoughton/oav commander esbuild
```

## Quick start

```ts
import { createValidator, createYamlFileReader, formatText } from "@aahoughton/oav";
import { loadSpec } from "@aahoughton/oav/spec";

const { document } = await loadSpec({
  reader: createYamlFileReader(),
  entry: "openapi.yaml",
});
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

For a multi-file spec or a spec hosted over HTTP, compose readers:
`composeReaders([createYamlFileReader(), createSmartHttpReader(), createFileReader()])`
handles local YAML, remote JSON / YAML, and local JSON transparently.

`validateRequest` / `validateResponse` return `null` on success or a
`ValidationError` tree on failure. Every error carries a stable `code`
(e.g. `"type"`, `"required"`, `"content-type"`, `"oneOf"`), a `path`
rooted at the HTTP frame (e.g. `["body", "pets", 3, "name"]`), a
human-readable `message`, and a machine-readable `params` object whose
shape per code is documented in `BuiltInErrorParams`.

## Why (yet another) OpenAPI validator?

Three things `oav` brings together that aren't jointly available
elsewhere in the JavaScript ecosystem:

- **An HTTP-aware validator.** One call checks method + path +
  parameters + body + content type + status + headers against the
  spec, not just the JSON body. Every HTTP-level concern — route
  matching, content-type negotiation, parameter deserialisation,
  response status matching — lives inside the validator.
- **Overlays over externally-owned specs.** Projects consuming an
  OpenAPI document they don't own (Supabase / Directus / Hasura /
  PocketBase / a gateway's published spec) can extend or override it
  at load time. `applyOverlays` rewrites the base document in memory;
  no forking, no preprocessing, no string substitution.
- **Native OpenAPI 3.0 support and a structured error tree.** 3.0 is
  a first-class dialect, not a 2020-12 translation: `nullable`,
  boolean `exclusiveMaximum`, and `$ref`-suppresses-siblings are baked
  into the compiler's dialect dispatch. Errors come back as a typed
  tree (`code` / `path` / `params` / `children`) so downstream code
  can narrow on fields rather than pattern-match on messages.

Ajv is the fastest JSON Schema validator for JavaScript and underpins
most of the OpenAPI ecosystem. For pure validate-per-second throughput
on a spec you fully own, it's still the right pick. Where the two
projects overlap and where each does more is written up in
[`COMPARISON.md`](./COMPARISON.md).

## Conformance

The [`conformance/`](./conformance/README.md) sub-package drives the
compiler and CLI against the upstream JSON Schema 2020-12 Test Suite,
a set of OpenAPI 3.0 / 3.1 / 3.2 petstore scenarios, and a handful of
real-world specs (Stripe, GitHub, DigitalOcean, Twilio, Asana, Box,
Adyen) that have to load and compile without error. See
[`conformance/REPORT.md`](./conformance/REPORT.md) for pass / fail
counts by category.

Categories oav does not aim to cover:

- `$dynamicRef` with runtime dynamic-scope rebinding. oav resolves
  statically against the anchor map.
- The `optional/format/*` subtree. Those tests target strict-assertion
  behaviour; `format` is annotation-only by default per JSON Schema
  2020-12 §6.3.
- A small tail of isolated optional cases (float-overflow handling,
  external-ref loading tied to the dynamic-scope category above).

In practice, OpenAPI specs generated or hand-authored by application
developers rarely touch any of these. `$dynamicRef` / `$dynamicAnchor`
are concentrated in meta-schemas and extensible-type libraries (JSON
Schema's own meta-schema, Hyperjump's type system); a spec that
describes "POST /pets takes a Pet" doesn't declare them. The strict
format-assertion gap only surfaces if you rely on RFC-edge behaviour
in `iri` / `iri-reference` or non-BMP regex content — `date-time`,
`email`, `uuid`, and the common URI formats pass. Float overflow
concerns numbers beyond `Number.MAX_SAFE_INTEGER` (~9 × 10¹⁵);
outside that range, JavaScript's own `Number` precision is the
limiting factor regardless of validator. If any of these corners
matter for your use case, the report lays out which tests fail and
why.

## CLI

```bash
oav resolve openapi.yaml
oav validate openapi.yaml --request req.http
oav validate openapi.yaml --path "POST /pets" --body payload.json
oav validate openapi.yaml --path "GET /pets" --response --status 200 --body resp.json
oav compile schema.json -o validator.mjs                    # ES module with no runtime `new Function()` (imports runtime helpers from @aahoughton/oav)
```

Flags: `--format text|json|flat`, `--depth n`, `--overlay file`
(repeatable), `-o file`, `--quiet`, `--dialect` (compile only). See
[packages/cli/README.md](./packages/cli/README.md) for the full surface,
the `.http` file format, and the `compile` output contract.

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

| Option                  | Effect                                                                                                 |
| ----------------------- | ------------------------------------------------------------------------------------------------------ |
| `dialect`               | Force a specific schema dialect, bypassing version detection.                                          |
| `formats`               | Extra string format validators merged on top of the built-ins.                                         |
| `keywords`              | Register user-defined schema keywords (see below).                                                     |
| `maxErrors`             | Cap on leaf errors; `1` is fast-fail, default is uncapped.                                             |
| `strictQueryParameters` | Reject undeclared query parameters. Default `false`.                                                   |
| `validateSecurity`      | Shape-only security check (bearer / basic / apiKey). Default `true`; set `false` to skip.              |
| `ignoreUndocumented`    | Return `null` on requests whose path the router can't match. Default `false`.                          |
| `ignorePaths`           | Predicate `(path) => boolean`; returning `true` short-circuits validation to `null` before routing.    |
| `onUnknownVersion`      | Policy for specs with missing/unsupported `openapi`: `"fallback31"` (default), `"warn"`, or `"throw"`. |

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
`validateResponse`. An Express 5 adapter is about this long:

```ts
import { allowHeaderFor, httpStatusFor, toProblemDetails } from "@aahoughton/oav";

app.use(async (req, res, next) => {
  const err = validator.validateRequest({
    method: req.method,
    path: req.path,
    query: req.query as Record<string, string | string[]>,
    headers: req.headers as Record<string, string | string[]>,
    contentType: req.get("content-type") ?? undefined,
    body: req.body,
  });
  if (err === null) return next();
  const allow = allowHeaderFor(err);
  if (allow !== undefined) res.setHeader("Allow", allow);
  res
    .status(httpStatusFor(err))
    .type("application/problem+json")
    .json(toProblemDetails(err, { instance: req.originalUrl }));
});
```

See [**INTEGRATION.md**](./INTEGRATION.md) for:

- Adapters for Express 4, Fastify, Next.js, Hono, Bun, and Deno.
- Recipes for file uploads (multer), response validation, security,
  ignoring paths, and the full status-code switch.
- A migration table from `express-openapi-validator`, including
  where oav is stricter or more conformant and where you'll do more
  wiring by hand.

`oav` is not a drop-in for `express-openapi-validator`: you own the
error → HTTP mapping, you wire up multer if you need file uploads,
and you run your own auth middleware. In exchange you get a
structured error tree, native OpenAPI 3.0 semantics, overlays, and
no monkey-patching of `req` or `res`.

## Modules

The package publishes a small root and four subpath entrypoints.
`@aahoughton/oav-core` exposes the same five entrypoints; substitute
`@aahoughton/oav-core/...` to import from the lean package.

| Import                    | Surface                                                  |
| ------------------------- | -------------------------------------------------------- |
| `@aahoughton/oav`         | `createValidator`, error helpers, formatters, types      |
| `@aahoughton/oav/schema`  | `compileSchema`, dialects, vocabularies, custom keywords |
| `@aahoughton/oav/spec`    | `loadSpec`, `resolveSpec`, `applyOverlays`, readers      |
| `@aahoughton/oav/formats` | Built-in string format validators                        |
| `@aahoughton/oav/core`    | Error tree model, shared OpenAPI / HTTP types            |

`@aahoughton/oav` also exports `createYamlFileReader`,
`createSmartHttpReader` (HTTP reader that handles both JSON and YAML
by inspecting `Content-Type`), and `parseYamlString` at the root entry,
and ships the `oav` CLI as a `bin`.

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

Runtime-behaviour corners. For a feature-scope comparison against
Ajv (draft versions, `$data`, async validation, etc.) see
[COMPARISON.md](./COMPARISON.md).

- `$dynamicRef` behaves like `$ref` with anchor lookup — no runtime
  dynamic-scope traversal.

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for branch / PR / release flow.
Development workflow (lint / typecheck / test / build) and the
conformance and performance sub-packages are described there and in
[CLAUDE.md](./CLAUDE.md).

## License

MIT — see [LICENSE](./LICENSE).
