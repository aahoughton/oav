# Overlays

Overlays patch an OpenAPI document in memory before the validator is
constructed. They exist for a specific job: letting you consume a spec
you don't own (an upstream framework's published document, a
gateway's spec, a vendor API) and add, augment, replace, or remove
parts of it to match your deployment, without forking the file.

## When you want one

- **Your deployment requires headers or query parameters the upstream
  spec doesn't declare.** Use `overrides` with `upsertParameters`.
- **The upstream schema is close to what you ship but missing a
  field.** Use `extendSchemas`: adds constraints via `allOf` while
  preserving the original shape.
- **The upstream schema is wrong for your deployment.** Use
  `replaceSchemas`: swaps the schema out entirely, no merge.
- **You need a route the upstream doesn't expose.** Use `addPaths`.
- **Upstream declares something you want gone** (a parameter you
  don't accept, a response status you never return, a path you don't
  serve). Use one of the `remove*` verbs.
- **An operation needs a complete rewrite** rather than piecemeal
  patching. Use `overrides.operations.<method>.replace`.

The alternative (forking the spec, keeping the fork in sync as the
upstream evolves, rebasing your patches on every update) is what
overlays exist to avoid.

## Verb matrix

Every overlay verb falls into one of four categories.

| Target                | add                | augment                  | replace                            | remove              |
| --------------------- | ------------------ | ------------------------ | ---------------------------------- | ------------------- |
| Paths                 | `addPaths`         | (via `overrides`)        | (via `overrides.replace`)          | `removePaths`       |
| Component schemas     |                    | `extendSchemas`          | `replaceSchemas`                   | `removeSchemas`     |
| Operations            |                    | (via additive op fields) | `overrides.operations.<m>.replace` | (via `removePaths`) |
| Parameters (per op)   | `upsertParameters` |                          | `upsertParameters`                 | `removeParameters`  |
| Request body (per op) |                    |                          | `requestBody`                      |                     |
| Responses (per op)    | `responses`        |                          | `responses`                        | `removeResponses`   |

## Applying an overlay

Two entry points, same result.

**`applyOverlays`** takes an already-resolved base document:

```ts
import { applyOverlays } from "@aahoughton/oav/spec";
import { createValidator } from "@aahoughton/oav";

const patched = applyOverlays(base, [overlay1, overlay2]);
const validator = createValidator(patched);
```

**`loadSpec`** resolves external `$ref`s and applies overlays in one
pass; use this for multi-file specs or remote documents:

```ts
import { loadSpec, composeReaders, createFileReader } from "@aahoughton/oav/spec";

const reader = composeReaders([createFileReader()]);
const { document } = await loadSpec({
  reader,
  entry: "openapi.yaml",
  overlays: [overlay1, overlay2],
});
const validator = createValidator(document);
```

Overlays apply in order. Later overlays win on conflict. The base
document is deep-cloned; the input is never mutated.

## Shape

```ts
interface SpecOverlay {
  addPaths?: Record<string, PathItem>;
  removePaths?: string[];
  overrides?: Record<string, PathOverride>;
  extendSchemas?: Record<string, SchemaObject>;
  replaceSchemas?: Record<string, SchemaObject>;
  removeSchemas?: string[];
}

interface PathOverride {
  operations?: Partial<Record<HttpMethod, OperationOverride>>;
  pathItem?: Partial<PathItem>;
}

interface OperationOverride {
  replace?: OperationObject;
  upsertParameters?: ParameterObject[];
  removeParameters?: Array<{ name: string; in: ParameterLocation }>;
  requestBody?: RequestBodyObject;
  responses?: Record<string, ResponseObject>;
  removeResponses?: string[];
}
```

Each field is independent; use any subset.

### `addPaths` / `removePaths`

Add new routes or drop upstream ones. Both fail fast: `addPaths`
throws if a target path already exists; `removePaths` throws if it
doesn't. The fail-fast choice is deliberate: you want the overlay to
notice when upstream shifts a path you've referenced instead of
silently no-op'ing.

### `extendSchemas` / `replaceSchemas` / `removeSchemas`

Patch the `components.schemas` map. `extend` wraps the original in
`allOf`, keeping upstream constraints plus yours. `replace` swaps
wholesale. `remove` drops the entry (throws if the name isn't
present). Multiple overlays targeting the same schema via `extend`
stack: each adds a new `allOf` branch.

### `overrides`

Patches existing paths. Two things can be modified:

- `operations`: per-method patches (see below).
- `pathItem`: fields on the `PathItem` itself (e.g. path-level
  `parameters`).

Wildcards: use `"*"` as an operation key to apply the same override
to every method on a path, or as a path key at the top of `overrides`
to apply it to every path.

#### Per-operation verbs

- **`replace`**: wholesale swap of the `OperationObject`. Cannot be
  combined with the additive / removal fields below in the same
  operation override; setting both throws at apply time.
- **`upsertParameters`**: append new parameters or replace existing
  concrete entries by (`name`, `in`). `{ $ref: … }` parameters in the
  base can't be matched without resolution; new parameters with the
  same key append alongside refs rather than replacing them.
- **`removeParameters`**: drop parameters by (`name`, `in`). Silent
  no-op on missing entries (wildcards fan out to many operations).
- **`requestBody`**: replace the request body entirely.
- **`responses`**: merge by status code; override wins on clashes.
- **`removeResponses`**: drop status codes. Silent no-op on missing.

### Full operation replacement

```ts
const overlay: SpecOverlay = {
  overrides: {
    "/pets": {
      operations: {
        post: { replace: { responses: { "201": { description: "created" } } } },
        // other methods on /pets untouched
      },
    },
  },
};
```

Use when the upstream `OperationObject` is so different from what
your deployment serves that patching it piecewise is noisier than
starting fresh.

Runnable demo:
[`examples/overlay-petstore-endpoint.ts`](../examples/overlay-petstore-endpoint.ts).
Adds a gateway-required `X-Tenant` header to `POST /pets`.

## Things to know

- **`$ref` resolution timing.** Overlays target the resolved
  document. `loadSpec` inlines external refs first, then applies
  overlays; if you're calling `applyOverlays` directly, pass in a
  spec that has already been through `resolveSpec`.
- **Internal `$ref`s stay internal.** `#/components/...` refs aren't
  inlined by the resolver, so editing an operation's response entry
  in place doesn't affect other operations that reference the same
  component: a handy way to augment one endpoint's response shape
  via `allOf` + the shared `$ref` without mutating the shared
  component for everyone else.
- **Reference-object parameters.** `upsertParameters` can only match
  against concrete parameter entries for replacement purposes. A
  `{ $ref: "#/components/parameters/Tenant" }` in the base is left
  alone, and any new parameter with the same `name` + `in` appends
  alongside rather than replacing. `removeParameters` follows the
  same rule.
- **Multiple extensions to one schema.** Each overlay that targets
  the same schema name via `extendSchemas` adds a new `allOf` branch.
  The compiled validator runs every branch; they all have to pass.
- **Same-overlay conflicts fail fast.** `addPaths` + `removePaths`
  naming the same path, or `replaceSchemas` + `removeSchemas` naming
  the same schema, throws at apply time. Contradictory intents in a
  single overlay are almost certainly bugs.

## Related

- [`examples/overlay-petstore-schema.ts`](../examples/overlay-petstore-schema.ts)
  and
  [`examples/overlay-petstore-endpoint.ts`](../examples/overlay-petstore-endpoint.ts):
  runnable end-to-end demos.
