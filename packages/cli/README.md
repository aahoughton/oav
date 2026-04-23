# oav (CLI)

The `oav` binary — a thin wrapper around `@aahoughton/oav` for shell
scripts, Makefiles, and CI.

## Install

```bash
# global install
npm install -g @aahoughton/oav commander
oav --help

# one-off via npx (npx installs commander as needed)
npx @aahoughton/oav validate openapi.yaml --request req.http
```

The CLI lives in the batteries-included `@aahoughton/oav` package,
not the lean `@aahoughton/oav-core` — `oav-core` doesn't ship a `bin`
or any CLI glue. Two packages are **optional peer dependencies** on
`@aahoughton/oav`:

- **`commander`** — required by every CLI invocation. Install it
  alongside `@aahoughton/oav`. Running `oav` without it prints an
  install hint and exits with status 2.
- **`esbuild`** — only required by `oav compile --standalone` (see
  [`compile` output](#compile-output) below). Not needed for any
  other command. Install it alongside `@aahoughton/oav` if you use
  `--standalone`, otherwise skip it. Missing-esbuild surfaces as an
  install hint on stderr with exit code 3 at `compile --standalone`
  time only.

Neither is pulled in by the library itself, so consumers who only
use the programmatic API stay on a single runtime dep (`yaml`).

## Commands

```bash
oav resolve <spec>                                           # stitch a multi-file spec
oav resolve <spec> --overlay overlay1.json --overlay overlay2.json

oav validate <spec> --request req.http                       # full HTTP request from a .http file
oav validate <spec> --path "POST /pets" --body body.json     # request body for a known route
oav validate <spec> --path "GET /pets" --response --status 200 --body resp.json

oav compile <schema.json> -o v.mjs                           # emit a validator module
oav compile <schema.json> --dialect openapi-3.0              # pick a non-default dialect
oav compile <schema.json> --standalone -o v.mjs              # inline runtime helpers (needs esbuild)
```

Pass `-` as the file path to read from stdin (e.g. `--body -`).

`<spec>` and `--overlay <file>` accept local paths, `file://` URIs,
and `http://` / `https://` URLs (both JSON and YAML over HTTP). Relative
`$ref`s inside a URL-hosted spec resolve against the URL's base.

`--request` takes a `.http` file — see [`.http` file format](#http-file-format)
below for the expected shape.

## Flags

| Flag                                          | Command            | Meaning                                                                                   |
| --------------------------------------------- | ------------------ | ----------------------------------------------------------------------------------------- |
| `--format text\|json\|flat`                   | validate           | Error rendering. Default `text`.                                                          |
| `--depth <n>`                                 | validate           | Truncate error tree depth (text format).                                                  |
| `--overlay <file>`                            | resolve / validate | Repeatable; applies overlays in order.                                                    |
| `--dialect 2020-12\|openapi-3.1\|openapi-3.0` | compile            | Schema dialect to compile against. Default `2020-12`.                                     |
| `--standalone`                                | compile            | Bundle runtime helpers via esbuild — emit a module with zero `@aahoughton/oav/*` imports. |
| `-o <file>`                                   | all                | Write output to a file instead of stdout.                                                 |
| `--quiet`                                     | resolve / validate | Exit code only, no stdout.                                                                |

## `compile` output

`oav compile <schema.json>` emits an ESM module exporting a
`validate(data)` function whose behaviour matches the dynamic
`compileSchema(schema).validate(data)`, but with no `new Function()`
call at load time. Useful for edge runtimes (Cloudflare Workers,
Vercel Edge) where runtime code generation is forbidden or undesirable.

Two output modes:

- **Default** — the emitted module imports runtime helpers from
  `@aahoughton/oav/core`, `@aahoughton/oav/schema/internals`, and
  `@aahoughton/oav/formats`. Consumers install `@aahoughton/oav`
  alongside the generated file. Smallest emit, shared runtime across
  many validators.
- **`--standalone`** — bundles the runtime helpers into the output via
  esbuild. The resulting module has zero imports and runs without
  `@aahoughton/oav` installed at all. Typical output is ~13 KB for a
  small schema, ~20–40 KB for a schema that touches every built-in
  format. Use for Lambda zips, edge-runtime bundles, or anywhere a
  single-file drop-in matters. Requires `esbuild` as an optional peer
  dependency.

Constraints on the input schema (apply to both modes):

- **Built-in formats only.** If the schema references `format: "..."`
  names not in `@aahoughton/oav/formats`'s built-in set, compile fails
  with exit code 3 and a listing of the unknown names.
- **No custom keywords.** Custom-keyword serialisation is out of scope;
  compile the schema dynamically if you need them.
- **External `$ref`s must be pre-inlined.** Run `oav resolve` over
  your spec first, or use `@aahoughton/oav/spec.resolveSpec`
  programmatically, before piping the schema into `compile`.

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
