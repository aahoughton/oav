# oav vs Ajv (+ express-openapi-validator)

Ajv is the canonical JSON Schema validator for JavaScript, and
`express-openapi-validator` is the most widely-used middleware built
on top of it. Together they cover most real-world OpenAPI validation
in the ecosystem and have done so for years. This document maps what
each project does so you can pick the one that fits.

oav covers the same ground as Ajv + `express-openapi-validator`
combined — schema validation plus HTTP-layer checks — and trades
differently on a handful of specifics, catalogued below.

This document is about behaviour and capabilities. For runtime
performance, see [`performance/README.md`](./performance/README.md),
which runs both libraries on the same benchmark fixtures.

## Where Ajv (+ express-openapi-validator) does more

Capabilities that the Ajv stack covers and oav does not.

- **Multiple JSON Schema drafts.** Ajv supports draft-04, draft-06,
  draft-07, draft-2019-09, 2020-12, and JTD. oav compiles 2020-12 and
  OpenAPI 3.0's constrained dialect only; earlier drafts and JTD are
  not supported.
- **Data-mutating options.** `coerceTypes`, `removeAdditional`, and
  `useDefaults` let Ajv mutate the validated value in place — coercing
  strings to numbers, stripping undeclared properties, filling missing
  properties from `default`. oav treats validation as a yes/no
  question and does not mutate inputs.
- **Ahead-of-time code generation — programmatic surface.** Ajv
  ships a `standaloneCode` API plus Node APIs that emit compiled
  validators as module source. oav's AOT story is CLI-only (`oav
compile schema.json -o v.mjs`, with `--standalone` for a
  zero-import bundle). Ajv's programmatic surface is richer: batch
  emission across many schemas in one file, CommonJS output,
  named-schema references resolved at emit time. If you're running
  emit as a library call inside a build tool, Ajv is more ergonomic.
  oav's CLI covers the "compile one schema at build time" case
  directly (including self-contained output for Lambda / edge-runtime
  deployments via `--standalone`, which uses esbuild to inline the
  runtime helpers) but doesn't expose a batched programmatic API.
- **Named schema registry.** `addSchema` / `getSchema` / `removeSchema`
  give Ajv a name-to-validator map that cross-schema `$ref`s resolve
  through. oav accepts an `external: Map<string, Schema>` on
  `compileSchema`; fine for one-shot compiles, less ergonomic for apps
  that build up a schema collection incrementally.
- **Full RFC 3986 URI resolution.** Ajv handles absolute-URI `$ref`s
  and `$id` base-URI rewrites natively. oav requires external /
  multi-file refs to be pre-inlined by `@aahoughton/oav/spec.resolveSpec()`
  before compile, and accepts fragment-only refs thereafter.
- **Full meta-schema validation.** Ajv can validate your schema
  against the draft's meta-schema at compile time, catching both
  unknown-keyword typos and wrong value shapes (e.g. `minimum: "5"`
  when it should be a number). oav ships a narrower `strict` option
  that catches unknown-keyword typos (`minimumx: 5`) and flags
  partially-implemented features; it doesn't check value shapes
  against the meta-schema.
- **`$data` references.** Ajv's non-standard extension where one
  keyword's value comes from the data being validated
  (`{ minimum: { $data: "1/min" } }`). oav doesn't implement it.
- **Async validation.** Ajv supports async formats and keywords (e.g.
  a format that hits a database). oav's formats and custom keywords
  are synchronous.
- **`express-openapi-validator` conveniences.** `req.body` /
  `req.query` type coercion, `res.json` interception for response
  validation, `fileUploader` (multer integration), `securityHandlers`
  (credential-verifying dispatch — oav does shape-only security
  validation but doesn't verify credentials),
  `operationHandlers` filesystem auto-loading, and `ignorePaths` /
  `ignoreUndocumented` are one-liner options. oav leaves these to the
  adapter — see [`INTEGRATION.md`](./INTEGRATION.md) for recipes.

## Where oav does more

Capabilities oav has that Ajv (alone or with
`express-openapi-validator`) doesn't.

- **HTTP-aware validation.** Route matching, content-type negotiation,
  parameter `style` / `explode` deserialisation, response status
  matching (exact → NXX class → default) are part of one
  `validateRequest` / `validateResponse` call. Ajv is a JSON Schema
  validator; wiring the HTTP layer on top of it is what
  `express-openapi-validator` does, and only for Express.
- **Built-in OpenAPI 3.0 dialect.** `nullable`, boolean
  `exclusiveMaximum` / `exclusiveMinimum`, and
  `$ref`-suppresses-siblings are compiled by a dedicated 3.0 dialect
  selected once at `createValidator` time. Ajv reaches the same
  semantics via `ajv-draft-04` plus a custom `nullable` keyword — the
  functionality is equivalent; oav's version is one dependency with
  no setup step.
- **First-class overlays.** `applyOverlays` rewrites an
  externally-owned base spec at load time — add a required header to
  every operation, extend a component schema, swap a response shape —
  without forking or preprocessing the upstream file.
- **Structured error tree.** Errors preserve the applicator structure
  (`oneOf` with per-branch `children`, `allOf` with failed-conjunct
  children). HTTP consumers can group by HTTP location
  (`body.items[3].name`, `query.limit`) and inspect which branch of a
  composition failed without parsing message strings. Ajv emits a
  flat errors array.
- **Predicate mode.** `compileSchema(schema, { predicate: true })`
  returns `{ validate: (x) => boolean }`. No error tree construction,
  no path snapshotting, no accumulator allocation. Ajv's
  `allErrors: false` still maintains error infrastructure; oav's
  predicate mode compiles to a different function entirely.
- **Bounded error collection.** `maxErrors: N` caps the error tree at
  N leaves; the generated code short-circuits hot loops when the
  budget is exhausted. Ajv has `allErrors: true | false` but no
  explicit count budget. When unset, oav's codegen emits plain
  `errors.push` with no runtime checks — zero overhead for the
  uncapped case.
- **Direction-aware body transforms.** Request-body validators reject
  `readOnly` properties and exempt them from `required`; response-body
  validators do the same for `writeOnly`. Applied as a pre-compile
  transform so the compiler itself is direction-agnostic.
- **Discriminator.** First-class OpenAPI discriminator support — a
  single-dispatch alternative to `oneOf` whose error message names the
  offending property and value rather than listing per-branch
  failures. `express-openapi-validator` supports discriminator via a
  custom Ajv keyword; the functionality is equivalent.
- **Compile-time observability.** `CompiledSchema.stats` exposes
  `functionCount`, `unevaluatedTrackingEmitted`, and
  `emittedTreeRuntime` so tests can assert on compiler optimisations
  directly rather than grepping the generated source.

## Runtime dependencies

Ajv 8 has four runtime dependencies:

| Dependency             | Purpose                                                         |
| ---------------------- | --------------------------------------------------------------- |
| `fast-deep-equal`      | Structural equality for `const` / `enum` / `uniqueItems`        |
| `json-schema-traverse` | Walk schema subtrees                                            |
| `fast-uri`             | RFC 3986 URI parsing for `$id` / `$ref` resolution              |
| `require-from-string`  | Load compiled-validator source as a module (standalone codegen) |

oav's compiler and validator have zero runtime dependencies. The lean
`@aahoughton/oav-core` package ships exactly that — no runtime deps —
and accepts JSON specs. The batteries-included `@aahoughton/oav`
package layers `yaml` on top for `.yaml` spec files and adds the `oav`
CLI (with `commander` as an optional peer). The two efficiency
libraries Ajv pulls in (`fast-deep-equal`, `json-schema-traverse`)
have equivalents in-tree; the two capability libraries (`fast-uri`,
`require-from-string`) map to features oav doesn't implement (see
"Where Ajv does more" above).

## Summary

oav and Ajv + `express-openapi-validator` cover the same ground: both
validate OpenAPI requests and responses by 3.0 / 3.1 / 3.2 rules,
both support custom keywords and formats, both produce
machine-readable errors. Differences are real but bounded.

Pick Ajv + `express-openapi-validator` when you want the fastest
validator, a large userbase, multi-draft support, or the one-line
middleware integration that comes with it. Pick oav when you want a
structured error tree, overlays over specs you don't own, a bundled
OpenAPI 3.0 dialect, or explicit control over where validation runs
in your HTTP stack.

For benchmark numbers rather than feature comparisons, see
[`performance/README.md`](./performance/README.md).
