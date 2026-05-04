# oav

OpenAPI **3.0** / **3.1** / **3.2** HTTP request and response
validator. Two primary drivers:

- **Tenant overrides over a base spec.** When tenants extend a
  shared API (adding a required header on one route, refining a
  schema, requiring auth where the base spec didn't), they need to
  document those changes in the spec they ship, not as
  application-side patches. `applyOverlays` rewrites the document
  at load time. Custom keywords, formats, and dialects plug into
  the compiler the same way, so per-tenant validation rules don't
  require forking. See [docs/overlays.md](./docs/overlays.md).
- **Validators that fit in microservice runners.** `oav
compile-spec openapi.yaml` emits a single zero-dependency ES
  module exposing the full validator surface. Targets Cloudflare
  Workers, Vercel Edge, Lambda@Edge, Deno Deploy: runtimes where
  `new Function()` is unavailable, or where dependency footprint
  matters. `--only "POST /pets"` (repeatable) scopes the output to
  specific operations without touching the source spec.

Errors come back as a typed tree (`code`, `path`, `message`,
`params`, `children`). One validator call covers the full HTTP
frame: method, path, parameters, body, content type, status, and
headers.

## Install

`oav` ships in two core packages, plus framework adapter packages that
build on either `oav` or `oav-core` -- if you don't need YAML support,
you can skip `oav` entirely (the lean path for zero-dependency / edge
targets):

| Package        | When to use                                                                                                                                                                                                                                                                                      |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `oav`          | Batteries-included: YAML readers + the `oav` CLI. Depends on `yaml`; pulls in `commander` + `esbuild` for the CLI only (never imported from the library entry points, so bundlers tree-shake them out of application bundles; Node server runs load them only when the `oav` binary is invoked). |
| `oav-core`     | Lean. Zero runtime dependencies. Same programmatic surface as `oav`, minus the YAML readers and CLI. Feed it JSON specs (or pre-parsed objects via the memory reader).                                                                                                                           |
| `oav-express4` | Express 4 framework adapter. Thin: imports the validator from `oav-core`, exports a middleware factory plus standalone helpers. See [`docs/integration.md`](./docs/integration.md).                                                                                                              |
| `oav-express5` | Express 5 framework adapter. Same exports as `oav-express4`; promise-native middleware shape.                                                                                                                                                                                                    |
| `oav-fastify`  | Fastify framework adapter. Same exports as the Express adapters; ships a `preValidation` hook instead of middleware.                                                                                                                                                                             |

```bash
npm install @aahoughton/oav            # YAML + CLI
npm install @aahoughton/oav-core       # JSON only, zero runtime deps
npm install @aahoughton/oav-express4   # Express 4 adapter (transitively pulls oav-core)
npm install @aahoughton/oav-express5   # Express 5 adapter
npm install @aahoughton/oav-fastify    # Fastify adapter
```

`oav` re-exports `oav-core` at four subpath entrypoints (`/schema`,
`/spec`, `/formats`, `/core`); on the lean package, substitute
`oav-core` in imports that don't touch the YAML readers
(`createYamlFileReader`, `createSmartHttpReader`) or the CLI. See
[`docs/modules.md`](./docs/modules.md) for what each subpath exports.

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

Runnable end-to-end demos in [`examples/`](./examples/README.md):
custom formats, custom keywords, cross-field constraints, error
budgets, version differences, overlays, and spec-derived middleware
config.

## How it compares

oav's primary alternative is
[Ajv](https://github.com/ajv-validator/ajv): directly for
`compileSchema`, or via
[`express-openapi-validator`](https://github.com/cdimascio/express-openapi-validator)
for HTTP validation. (Migrating from EOV specifically:
[docs/migration-from-eov.md](./docs/migration-from-eov.md).)

Numbers below are from the [`performance/`](./performance/README.md)
benchmark on AWS c7i.large (Intel Sapphire Rapids, Node 22). Your
hardware will vary.

**Compile: oav is meaningfully faster.**

|                                            | Ajv   | oav       |
| ------------------------------------------ | ----- | --------- |
| Single synthetic schema (varies by shape)  | ~6 ms | 25–200 µs |
| Real-world spec (petstore-31, ~10 schemas) | 27 ms | 1.6 ms    |

Ajv compile is essentially constant overhead per schema; oav scales
with shape. The advantage shows up wherever validator construction
sits in the hot path: per-request, per-tenant, per-test, edge
cold-start, AOT module emit.

**Validate: roughly tied on simple shapes; Ajv wins on complex.**

Both libraries are sub-microsecond per check on typical OpenAPI
bodies. On complex `oneOf`/`allOf` or large arrays, Ajv leads by
2–4× (say 100 ns to 400 ns per call, or 1.7 µs to 4 µs). oav's
`predicate` mode (`compileSchema(..., { predicate: true })`) closes
most of that gap for yes/no use cases.

For typical HTTP workloads (1k–10k req/sec × ~1 validation per
request), the difference is invisible at any of those numbers. For
validation-heavy code (millions of validations per second), Ajv wins.

Full per-shape breakdown: [`docs/comparison.md`](./docs/comparison.md). Raw
benchmark data and methodology:
[`performance/README.md`](./performance/README.md).

## Conformance

The [`conformance/`](./conformance/README.md) sub-package drives the
compiler and CLI against the upstream JSON Schema 2020-12 Test Suite,
a set of OpenAPI 3.0 / 3.1 / 3.2 petstore scenarios, and a handful of
real-world specs (Stripe, GitHub, DigitalOcean, Twilio, Asana, Box,
Adyen) that have to load and compile without error. See
[`conformance/REPORT.md`](./conformance/REPORT.md) for pass / fail
counts by category.

Categories oav does not aim to cover:

- `$dynamicRef` with runtime dynamic-scope rebinding (oav resolves
  statically against the anchor map).
- The `optional/format/*` subtree (`format` is annotation-only by
  default per JSON Schema 2020-12 §6.3).
- A small tail of isolated optional cases (float-overflow handling,
  external-ref loading tied to dynamic scope).

OpenAPI specs hand-authored or generated for typical APIs rarely
touch any of these. If they matter for your use case, the
[report](./conformance/REPORT.md) lays out which tests fail and why.

## CLI

```bash
oav resolve openapi.yaml
oav validate openapi.yaml --request req.http
oav validate openapi.yaml --path "POST /pets" --body payload.json
oav validate openapi.yaml --path "GET /pets" --response --status 200 --body resp.json
oav compile-schema schema.json -o validator.mjs             # JSON Schema -> standalone validator
oav compile-spec openapi.yaml  -o validator.mjs             # OpenAPI   -> standalone HTTP validator (edge / Lambda)
```

Flags: `--format text|json|flat`, `--depth n`, `--overlay file`
(repeatable), `-o file`, `--quiet`, `--dialect` (compile-schema /
compile-spec), `--requests-only` (compile-spec), `--only METHOD PATH`
(compile-spec, repeatable). See
[packages/cli/README.md](./packages/cli/README.md) for the full
surface, the `.http` file format, and both compile commands' output
contracts.

## Versions

`createValidator` reads the spec's `openapi` string once at construction
and picks the matching dialect. No per-request branching.

| Spec  | Dialect               | Notes                                                       |
| ----- | --------------------- | ----------------------------------------------------------- |
| 3.0.x | OAS 3.0 Schema Object | `nullable`, boolean `exclusiveMin/Max`, sibling-`$ref` drop |
| 3.1.x | JSON Schema 2020-12   | Assertive `format`                                          |
| 3.2.x | JSON Schema 2020-12   | Same as 3.1 + the `QUERY` HTTP method                       |

Override via `createValidator(spec, { dialect })` to force or customize
one of the built-in dialects (`jsonSchemaDialect`, `openapi31Dialect`,
`oas30Dialect`). Unknown / missing `openapi` strings fall back to the
3.1 dialect by default; configure with
`onUnknownVersion: "throw" | "warn" | "fallback31"`.

**Swagger 2.0 specs** aren't supported directly: `createValidator`
throws on `swagger: "2.0"` documents. Convert to OpenAPI 3.0 first with
[`swagger2openapi`](https://github.com/Mermade/oas-kit/tree/main/packages/swagger2openapi)
and pass the 3.0 output to `createValidator`:

```bash
npx swagger2openapi swagger.json -o openapi.json
```

## Configuring the validator

`createValidator(spec, options)` accepts options for dialect override,
custom formats and keywords, error budget, strict-mode lint, security
shape-checking, ignored paths, and version-mismatch policy. See
[`docs/configuration.md`](./docs/configuration.md) for the option
table, custom-keyword recipe, and bounded-error-collection details.
The canonical contract is the `ValidatorOptions` TSDoc.

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

See [**docs/integration.md**](./docs/integration.md) for:

- Adapter packages for Express 4, Express 5, and Fastify; recipes for Next.js, Hono, Bun, and Deno via the Web Standards adapter.
- Recipes for file uploads (multer), response validation, security,
  ignoring paths, and the full status-code switch.
- A migration table from `express-openapi-validator`, including
  where oav is stricter or more conformant and where you'll do more
  wiring by hand.

Companion adapter packages cover the common framework wiring:
[`oav-express4`](./packages/oav-express4/README.md),
[`oav-express5`](./packages/oav-express5/README.md),
[`oav-fastify`](./packages/oav-fastify/README.md). They
share the same export names and option shapes; only the
framework-typed argument differs.

`oav` is not a drop-in for `express-openapi-validator`: the
adapters cover the request-validation middleware, but you own the
error → HTTP mapping if you customize it, you wire up multer if you
need file uploads, and you run your own auth middleware. The error
tree is structured (`code`/`path`/`message`/`params`/`children`),
the OpenAPI 3.0 dialect is built in rather than translated to
2020-12, and the validator does not mutate `req` or `res`.

## Known limitations

Runtime-behavior corners. For a feature-scope comparison against
Ajv (draft versions, `$data`, async validation, etc.) see
[docs/comparison.md](./docs/comparison.md).

- `$dynamicRef` behaves like `$ref` with anchor lookup; no runtime dynamic-scope traversal.
- `style: deepObject` query parameters support only single-level nesting (`obj[key]=value`); OpenAPI 3.0–3.2 don't define nested semantics.
- `pattern` keywords and `format: "regex"` compile to the JavaScript
  built-in `RegExp`, which has no execution timeout. If your OpenAPI
  spec is attacker-controlled (e.g. multi-tenant upload), a
  catastrophic pattern like `(a+)+$` is a ReDoS vector against any
  string the validator checks. Vet spec sources before loading them.
  A pluggable `regexCompiler` option for plugging in `re2` or a
  complexity-checking engine is tracked in
  [#146](https://github.com/aahoughton/oav/issues/146).

## Contributing

See [CONTRIBUTING.md](./CONTRIBUTING.md) for branch / PR / release flow.
Development workflow (lint / typecheck / test / build) and the
conformance and performance sub-packages are described there and in
[CLAUDE.md](./CLAUDE.md).

## License

MIT. See [LICENSE](./LICENSE).
