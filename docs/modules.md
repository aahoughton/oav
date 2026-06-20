# Modules

The package publishes a root entry and five public subpath
entrypoints (plus the not-semver-covered `*/internals` subpaths listed
further down). `oav-core` mirrors the same paths; substitute
`oav-core/...` to import from the lean package.

| Import                         | Surface                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------- |
| `@aahoughton/oav`              | `createValidator`, `combineValidators`, error helpers, formatters, types        |
| `@aahoughton/oav/schema`       | `compileSchema`, dialects, vocabularies, custom keywords, keyword introspection |
| `@aahoughton/oav/spec`         | `loadSpec`, `loadSpecSync`, `resolveSpec`, `applyOverlays`, readers             |
| `@aahoughton/oav/overlay-spec` | `translateOverlay`, `applySpecOverlay`: OpenAPI Overlay 1.0 → typed SpecOverlay |
| `@aahoughton/oav/formats`      | Built-in string format validators                                               |
| `@aahoughton/oav/core`         | Error tree model, shared OpenAPI / HTTP types                                   |

`oav` also exports `loadSpecSync` (YAML-defaulting, so a `.yaml`
spec loads with no reader composition), `createYamlFileReader`,
`createSmartHttpReader` (HTTP reader that handles both JSON and YAML
by inspecting `Content-Type`), and `parseYamlString` at the root
entry, and ships the `oav` CLI as a `bin`.

## Internal subpaths (not covered by semver)

Each public package also exposes lower-level primitives behind a
`/internals` path. They exist for advanced plugins, tooling, and
tests, and sit deliberately outside the semver contract: compare
against the public barrel before reaching for them. `oav-core` mirrors
each at the matching `oav-core/...` path.

| Import                                | Surface                                                                                           |
| ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `@aahoughton/oav/schema/internals`    | Codegen mechanics, runtime helpers, and resolve internals below the keyword-author API            |
| `@aahoughton/oav/spec/internals`      | Synchronous resolver primitives (`resolveSpecSync`, `createFileReaderSync`, `composeReadersSync`) |
| `@aahoughton/oav/validator/internals` | Parameter deserialization, query assembly, and the operation-level `$ref` resolver                |

## Companion adapter packages

Per-framework adapter packages share the same export names and option
shapes as each other; only the framework-typed argument differs. Each
has its own README:

- [`oav-express4`](../packages/oav-express4/README.md): Express 4 (peer: `express ^4`).
- [`oav-express5`](../packages/oav-express5/README.md): Express 5 (peer: `express ^5`); promise-native middleware shape.
- [`oav-fastify`](../packages/oav-fastify/README.md): Fastify (peer: `fastify ^5`); ships a `preValidation` hook instead of middleware.

For Next.js, Hono, Bun, and Deno, use the Web Standards adapter
(`httpRequestFromFetch`, `validateFetchRequest`) directly; no
framework-specific package. See
[`docs/integration.md`](./integration.md).

The `httpRequestFrom*` family is not shape-uniform across the
boundary: the Fetch variant is async and returns
`{ httpRequest, body }` (it reads the body stream), while the
framework variants (`httpRequestFromExpress`,
`httpRequestFromFastify`) are sync and return a bare `HttpRequest`.
`httpResponseFromFetch` has no framework sibling by design: the
Express and Fastify adapters intercept responses inside
`validateResponses` (a `res.send` wrap / `onSend` hook), so a
standalone response extractor exists only for the Fetch world,
where responses are first-class values.
