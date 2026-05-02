# Modules

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

`oav` also exports `createYamlFileReader`, `createSmartHttpReader`
(HTTP reader that handles both JSON and YAML by inspecting
`Content-Type`), and `parseYamlString` at the root entry, and ships
the `oav` CLI as a `bin`.

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
