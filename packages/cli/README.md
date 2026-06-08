# oav (CLI)

The `oav` binary: a thin wrapper around the oav library for shell
scripts, Makefiles, and CI.

## Install

```bash
# global install
npm install -g @aahoughton/oav
oav --help

# one-off via npx
npx @aahoughton/oav validate openapi.yaml --request req.http
```

The CLI lives in the `oav` package, not `oav-core`. `oav-core`
doesn't ship a `bin` or any CLI glue. `oav` carries `commander`
(argv parsing) as a regular dependency. `esbuild` (AOT bundling
for `compile-schema` / `compile-spec`) is an optional peer
dependency; install it alongside `oav` only if you use those
commands. Users who only need the programmatic API install
`oav-core` instead.

## Commands

```bash
oav resolve <spec>                                       # stitch a multi-file spec
oav resolve <spec> --overlay overlay1.json --overlay overlay2.json
oav resolve <spec> --lint                                # spec-hygiene check; findings to stderr
oav resolve <spec> --lint --fail-on warning              # CI gate: exit 1 on any finding
oav resolve <spec> --lint --envelope json                # findings folded into JSON envelope

oav validate <spec> --request req.http                   # full HTTP request from a .http file
oav validate <spec> --path "POST /pets" --body body.json
oav validate <spec> --path "GET /pets" --response --status 200 --body resp.json

oav compile-schema <schema.json> -o v.mjs                # single JSON Schema -> standalone validator
oav compile-schema <schema.json> --dialect openapi-3.0

oav compile-spec <openapi.yaml> -o v.mjs                 # OpenAPI spec -> standalone HTTP validator
oav compile-spec <openapi.yaml> --requests-only -o v.mjs
oav compile-spec <openapi.yaml> --only "POST /pets" -o v.mjs
```

Pass `-` as the file path to read from stdin (e.g. `--body -`).

`<spec>` and `--overlay <file>` accept local paths, `file://` URIs,
and `http://` / `https://` URLs (both JSON and YAML over HTTP). Relative
`$ref`s inside a URL-hosted spec resolve against the URL's base.

`--request` takes a `.http` file; see [`.http` file format](#http-file-format)
below for the expected shape.

## Flags

| Flag                                          | Command                           | Meaning                                                                                              |
| --------------------------------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `--format text\|json\|flat`                   | validate                          | Error rendering. Default `text`.                                                                     |
| `--depth <n>`                                 | validate                          | Truncate error tree depth (text format).                                                             |
| `--overlay <file>`                            | resolve / validate / compile-spec | Repeatable; applies overlays in order.                                                               |
| `--lint`                                      | resolve                           | Run spec-hygiene checks; findings to stderr (or JSON envelope with `--envelope json`).               |
| `--fail-on <level>`                           | resolve                           | Non-zero exit on any finding at or above `<level>`. Requires `--lint`. Currently only `warning`.     |
| `--envelope text\|json`                       | resolve                           | `text` (default; document on stdout, findings on stderr) or `json` (single payload).                 |
| `--dialect 2020-12\|openapi-3.1\|openapi-3.0` | compile-schema / compile-spec     | Schema dialect. Defaults: 2020-12 (compile-schema), auto-detect from `openapi` field (compile-spec). |
| `--requests-only`                             | compile-spec                      | Skip response-validator emit. Smaller output.                                                        |
| `--only <method-path...>`                     | compile-spec                      | Repeatable; restrict emit to given ops, e.g. `--only "POST /pets"`.                                  |
| `--output-mode flat\|tree\|predicate`         | compile-spec                      | Result shape of the emitted validators. Default `flat`. Mirrors `output`.                            |
| `--max-errors <n>`                            | compile-spec                      | Leaf-error cap baked in: a positive integer or `all`. Default `1`. Mirrors `maxErrors`.              |
| `-o <file>`                                   | all                               | Write output to a file instead of stdout.                                                            |
| `--quiet`                                     | resolve / validate                | Exit code only, no stdout.                                                                           |

## `compile-schema` output

`oav compile-schema <schema.json>` emits an ESM module exporting a
`validate(data)` function matching `compileSchema(schema).validate(data)`.
esbuild bundles the runtime helpers into the output, so the resulting
module has zero imports. Typical output is ~13 KB for a small schema,
~20–40 KB for a schema that touches every built-in format.

Use for Lambda zips, Cloudflare Workers, Vercel Edge, single-file
deployments: anywhere `new Function()` is forbidden or the runtime
library footprint is unwanted.

Constraints on the input schema:

- **Built-in formats only.** If the schema references `format: "..."`
  names outside `oav/formats`, compile fails with exit
  code 3 and a listing of the unknown names. Custom formats aren't
  serialisable to standalone source.
- **No custom keywords.** Same reason: the keyword's validator
  function can't be serialised.
- **External `$ref`s must be pre-inlined.** Run `oav resolve` over
  a multi-file input first, or use `oav/spec.resolveSpec`
  programmatically, before piping the schema into `compile-schema`.

## `compile-spec` output

`oav compile-spec <openapi.yaml>` emits an ESM module exposing the
same surface as `createValidator(document)`: `validateRequest`,
`validateResponse`, `validateFetchRequest`, `validateFetchResponse`,
`getOperation`, `detectedVersion`, `warnings`. Every operation's
parameter / body / response schemas are pre-compiled and inlined.
esbuild bundles everything; the resulting module has zero imports.

The emitted `validate*` return the same result shapes as the library:
`{ valid: true }` or `{ valid: false, errors, truncated }`, stopping at
the first error by default (flat + `maxErrors: 1`), the same zero-config
behaviour as `createValidator`. `--output-mode` and `--max-errors`
(below) tune the shape, exactly mirroring the `output` / `maxErrors`
options.

Consumers who were running `createValidator(await loadSpec(...))` at
application boot get the same behavior with no YAML parse, no
`$ref` walk, no schema compilation at load time. Target use cases:

- **Cloudflare Workers / Vercel Edge**: the runtime sandbox
  forbids `new Function()`, which rules out `ajv.compile()` at
  runtime. Pre-compiled output sidesteps it.
- **Lambda@Edge / viewer functions**: 1 MB zipped; the full
  library + YAML parser graph doesn't fit. A compile-spec output for
  a small-to-medium spec does.
- **Lambda + API Gateway**: shaves 5–50 ms off cold starts by
  removing spec parse + schema compile from the critical path.
- **Single-file drops** (Deno subhosting, Val.town, `deno compile`,
  `bun build --compile`): one `.mjs`, no node_modules.

### Flags

- **`--overlay <file>`** (repeatable): applies overlays at build
  time. Same semantics as `oav resolve`.
- **`--dialect <name>`**: forces a specific schema dialect. Default
  is auto-detected from the spec's `openapi` field.
- **`--output-mode flat|tree|predicate`**: result shape of the emitted
  validators, mirroring `createValidator`'s `output`. Default `flat`
  (a de-nested `errors` list); `tree` for the nested `error` tree;
  `predicate` for a bare boolean.
- **`--max-errors <n>`**: leaf-error cap baked into the validators,
  mirroring `maxErrors`. A positive integer or `all` (unbounded).
  Default `1` (fast-fail). A failing result sets `truncated: true`
  when the cap was reached.
- **`--requests-only`**: skips response-validator emit.
  `validateResponse` / `validateFetchResponse` are still exported but
  report every response as valid (a passing result in the configured
  output mode). Output shrinks significantly on response-heavy specs
  (rough rule of thumb: ~50% smaller on Stripe-shape, ~20–30% on
  petstore-shape).
- **`--only "METHOD PATH"`** (repeatable): restricts emit to
  specified operations. OR-combined across multiple flags. Paths not
  matching any `--only` are dropped from the router. Methods dropped
  from a partially-filtered path return `code: "route"` (404),
  treating the filtered emit as "this deployment's surface" rather
  than "a partial view of the full spec". Gateway-routing layers
  that expect 405 (method not implemented here, try another
  service) need to account for this.

### Bundle size

Output size scales with op count and schema complexity:

| Spec shape     | Ops  | Output (bundled) |
| -------------- | ---- | ---------------- |
| petstore       | 2    | ~20 KB           |
| Adyen Checkout | 23   | ~200 KB          |
| Stripe         | 400+ | ~2–3 MB          |

Fits Cloudflare Workers' 10 MB compressed limit through Stripe-scale.
Fits Lambda@Edge's 1 MB viewer-function limit through low-hundreds
of ops. `--requests-only` and `--only` both shrink output materially.

### Not serialised

Same limits as `compile-schema`, plus:

- **Custom formats / custom keywords**: the validator function
  can't be serialised. Compile dynamically with `createValidator`
  if you need them.
- **External `$ref`s**: internal refs within the document compile
  fine; multi-file external refs must be pre-inlined via `oav
resolve` or `resolveSpec` before running `compile-spec`.

### Relationship to ajv's `standaloneCode`

Ajv's `standaloneCode` covers the schema layer: it emits a compiled
JSON Schema validator as module source. `compile-schema` does the
same thing. `compile-spec` covers the HTTP layer on top: router
matching, content-type dispatch, parameter deserialisation
(style / explode), response status matching, and shape-only
security checks. Rebuilding that layer on top of ajv's standalone
output is re-implementing `express-openapi-validator`
from scratch; `compile-spec` emits it directly.

## Exit codes

| Code | Meaning               |
| ---- | --------------------- |
| 0    | valid                 |
| 1    | validation errors     |
| 2    | spec resolution error |
| 3    | input / usage error   |

## `.http` file format

```
POST /pets?limit=10 HTTP/1.1
Content-Type: application/json
X-Tenant-Id: abc-123

{"name": "Fido", "species": "dog"}
```

A blank line separates headers from body. CRLF and LF both work.
