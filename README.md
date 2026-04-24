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
- OpenAPI 3.0 compiles through its own dialect: `nullable`, boolean
  `exclusiveMaximum`, and `$ref`-suppresses-siblings are keyword
  definitions in the 3.0 vocabulary stack. Single compiler pass, no
  schema preprocessing.
- Codegen-compiled at construction, cached by schema identity, zero
  per-request version branching. Handles recursive `$ref`, multi-file
  specs, overlays, and custom keywords / formats.

## Install

`oav` ships in two packages so consumers on constrained runtimes can
skip what they don't use:

| Package                | When to use                                                                                                                                                                                                                                                                                               |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@aahoughton/oav`      | Default. Batteries-included: YAML readers + the `oav` CLI. Depends on `yaml`; pulls in `commander` + `esbuild` for the CLI only (never imported from the library entry points, so bundlers tree-shake them out of application bundles; Node server runs load them only when the `oav` binary is invoked). |
| `@aahoughton/oav-core` | Lean alternative. Zero runtime dependencies. Same programmatic surface as `@aahoughton/oav`, minus the YAML readers and CLI. Feed it JSON specs (or pre-parsed objects via the memory reader).                                                                                                            |

```bash
npm install @aahoughton/oav
# or: pnpm add @aahoughton/oav
```

```bash
npm install @aahoughton/oav-core           # lean install, JSON-only
```

`oav` re-exports `oav-core` at matching
subpaths. Samples below use `oav`; on the lean package,
substitute `oav-core` in imports that don't touch the
YAML readers (`createYamlFileReader`, `createSmartHttpReader`) or
the CLI.

The `commander` + `esbuild` deps `oav` pulls in are
reachable only from the `oav` CLI binary (`dist/cli.js`). Application
code importing from `oav` hits `dist/index.js`, which
doesn't reference them — bundlers tree-shake them out of the output,
and Node servers load them only when the CLI is invoked. Consumers
who want to skip the ~10 MB of esbuild's native binary on disk can
install `oav-core` instead (zero runtime deps, no CLI).

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

Things `oav` brings together that aren't jointly available elsewhere
in the JavaScript ecosystem:

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
- **Native OpenAPI 3.0 support and a structured error tree.** 3.0 has
  its own compiler dialect rather than being translated to 2020-12:
  `nullable`, boolean `exclusiveMaximum`, and
  `$ref`-suppresses-siblings are baked into the compiler's dialect
  dispatch. Errors come back as a typed
  tree (`code` / `path` / `params` / `children`) so downstream code
  can narrow on fields rather than pattern-match on messages.
- **AOT compilation for edge runtimes.** `oav compile-spec
<openapi.yaml>` emits a single ES module — zero imports — exposing
  the full `validateRequest` / `validateResponse` / `getOperation`
  surface with every operation's schemas pre-compiled. Runs on
  Cloudflare Workers / Vercel Edge / Lambda@Edge / Deno Deploy —
  anywhere runtime code generation is forbidden or dependency
  footprint matters. Full details in
  [`packages/cli/README.md`](./packages/cli/README.md#compile-spec-output).

Ajv is the canonical JSON Schema validator for JavaScript and
underpins most of the OpenAPI ecosystem. It has the edge on
steady-state validate throughput — roughly 2–5× on complex shapes in
`oav`'s default error-tree mode; `oav`'s predicate mode
(`compileSchema(..., { predicate: true })`) closes most of that gap.
On _compile_ throughput the ranking flips by 1–2 orders of
magnitude: on a real-world OpenAPI doc (Stripe, 886 schemas), oav
compiles **8× faster**; on synthetic schemas, 30–180× faster. If
you construct validators per-request, per-tenant, or per-test, that
usually dominates the overall picture. Full numbers in
[`COMPARISON.md`](./COMPARISON.md) and
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
oav compile-schema schema.json -o validator.mjs             # JSON Schema → standalone validator
oav compile-spec openapi.yaml  -o validator.mjs             # OpenAPI   → standalone HTTP validator (edge / Lambda)
```

Flags: `--format text|json|flat`, `--depth n`, `--overlay file`
(repeatable), `-o file`, `--quiet`, `--dialect` (compile-schema /
compile-spec), `--requests-only` (compile-spec), `--only METHOD PATH`
(compile-spec, repeatable). See
[packages/cli/README.md](./packages/cli/README.md) for the full
surface, the `.http` file format, and both compile commands' output
contracts.

`compile-schema` and `compile-spec` emit ES modules with zero imports
after the esbuild bundle step. `compile-spec`'s output exposes the
same `validateRequest` / `validateResponse` / `getOperation` surface
as `createValidator(document)` but with every schema already compiled
into the file — suited for Cloudflare Workers / Vercel Edge /
Lambda@Edge where runtime `ajv.compile()` is forbidden, or for
Lambda cold-start latency where skipping 10–50 ms of spec parse +
compile pays back.

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

**Swagger 2.0 specs** aren't supported directly — `createValidator`
throws on `swagger: "2.0"` documents. Convert to OpenAPI 3.0 first with
[`swagger2openapi`](https://github.com/Mermade/oas-kit/tree/main/packages/swagger2openapi)
and pass the 3.0 output to `createValidator`:

```bash
npx swagger2openapi swagger.json -o openapi.json
```

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
`oav-core` exposes the same five entrypoints; substitute
`oav-core/...` to import from the lean package.

| Import                    | Surface                                                  |
| ------------------------- | -------------------------------------------------------- |
| `@aahoughton/oav`         | `createValidator`, error helpers, formatters, types      |
| `@aahoughton/oav/schema`  | `compileSchema`, dialects, vocabularies, custom keywords |
| `@aahoughton/oav/spec`    | `loadSpec`, `resolveSpec`, `applyOverlays`, readers      |
| `@aahoughton/oav/formats` | Built-in string format validators                        |
| `@aahoughton/oav/core`    | Error tree model, shared OpenAPI / HTTP types            |

`oav` also exports `createYamlFileReader`,
`createSmartHttpReader` (HTTP reader that handles both JSON and YAML
by inspecting `Content-Type`), and `parseYamlString` at the root entry,
and ships the `oav` CLI as a `bin`.

## Examples

Runnable, self-contained TypeScript examples in
[`examples/`](./examples/README.md):

| File                           | Shows                                                                |
| ------------------------------ | -------------------------------------------------------------------- |
| `basic-validation.ts`          | Load a spec → `createValidator` → request and response checks        |
| `custom-formats.ts`            | Register a user string format (E.164 phone)                          |
| `custom-keywords.ts`           | Register a schema keyword that reads dynamic runtime state           |
| `cross-field-validation.ts`    | Cross-field constraint (`max >= min`) via an object-level keyword    |
| `max-errors.ts`                | Fast-fail and bounded error collection on a bulk-invalid payload     |
| `versions.ts`                  | 3.0, 3.1, 3.2 side by side (`nullable`, QUERY method)                |
| `overlay.ts`                   | Merge a gateway header requirement into one operation                |
| `overlay-petstore-schema.ts`   | Extend the `Pet` component with a deployment-required field          |
| `overlay-petstore-endpoint.ts` | Require an `X-Tenant` header on `POST /pets` via an endpoint overlay |
| `spec-digest.ts`               | Derive middleware config (multer limits, required headers) at boot   |

## Known limitations

Runtime-behaviour corners. For a feature-scope comparison against
Ajv (draft versions, `$data`, async validation, etc.) see
[COMPARISON.md](./COMPARISON.md).

- `$dynamicRef` behaves like `$ref` with anchor lookup — no runtime
  dynamic-scope traversal.
- `style: deepObject` query parameters support only single-level
  nesting (`obj[key]=value`). OpenAPI 3.0–3.2 do not define nested
  semantics; specs that rely on `obj[a][b]=value` should model the
  flattened shape explicitly or use a different parameter style.
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

MIT — see [LICENSE](./LICENSE).
