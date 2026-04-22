# Overlays

Overlays patch an OpenAPI document in memory before the validator is
constructed. They exist for a specific job: letting you consume a spec
you don't own — an upstream framework's published document, a
gateway's spec, a vendor API — and extend or override parts of it to
match your deployment, without forking the file.

## When you want one

- **The upstream schema is close to what you ship but missing a
  field.** Use `extendSchemas` — adds constraints via `allOf` while
  preserving the original shape.
- **The upstream schema is wrong for your deployment.** Use
  `replaceSchemas` — swaps the schema out entirely, no merge.
- **Your gateway requires headers or query parameters the upstream
  spec doesn't declare.** Use `overrides` to add them to the relevant
  operations.
- **You need a route the upstream doesn't expose.** Use `addPaths`.

The alternative — forking the spec, keeping the fork in sync as the
upstream evolves, rebasing your patches on every update — is what
overlays exist to avoid.

## Shape

An overlay is a plain object with up to four sections. Each is
independent; you can use any subset.

```ts
interface SpecOverlay {
  addPaths?: Record<string, PathItem>;
  overrides?: Record<string, PathOverride>;
  extendSchemas?: Record<string, SchemaObject>;
  replaceSchemas?: Record<string, SchemaObject>;
}
```

### `extendSchemas`

Adds constraints to an existing component schema. The extension merges
in via `allOf`: the original shape still applies, the extension adds
to it.

Runnable demo:
[`examples/overlay-petstore-schema.ts`](./examples/overlay-petstore-schema.ts)
— extends the upstream `Pet` to require a `vaccinated: boolean`.

### `replaceSchemas`

Replaces a component schema entirely. Use when your deployment's
shape is not a superset of the upstream's — for example, a field that
the upstream declares as `string` but your deployment receives as a
structured object.

### `overrides`

Modifies existing paths. Two things can be modified:

- `operations` — per-method patches. Each supports:
  - `addParameters`: append new parameters; replace existing concrete
    entries (matched by `name` + `in`). `$ref`-shaped parameters in
    the base are not matched and the new parameter appends alongside.
  - `requestBody`: replace the request body entirely.
  - `responses`: merge by status code.
- `pathItem` — fields on the `PathItem` itself (e.g. path-level
  `parameters`).

Wildcards: use `"*"` as an operation key to apply the same override to
every method on a path, or as a path key at the top of `overrides` to
apply it to every path.

Runnable demo:
[`examples/overlay-petstore-endpoint.ts`](./examples/overlay-petstore-endpoint.ts)
— adds a gateway-required `X-Tenant` header to `POST /pets`.

### `addPaths`

Extends the `paths` map with new routes. Throws at apply time if the
path already exists in the base document — use `overrides` for that
case.

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
pass — use this for multi-file specs or remote documents:

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
document is deep-cloned — the input is never mutated.

## Things to know

- **`$ref` resolution timing.** Overlays target the resolved
  document. `loadSpec` inlines external refs first, then applies
  overlays; if you're calling `applyOverlays` directly, pass in a
  spec that has already been through `resolveSpec`.
- **Reference-object parameters.** `addParameters` can only match
  against concrete parameter entries for replacement purposes. A
  `{ $ref: "#/components/parameters/Tenant" }` in the base is left
  alone, and any new parameter with the same `name` + `in` appends
  alongside rather than replacing.
- **Multiple extensions to one schema.** Each overlay that targets
  the same schema name via `extendSchemas` adds a new `allOf` branch.
  The compiled validator runs every branch; they all have to pass.
- **Conflicts fail fast.** `addPaths` adding an existing path, or
  `overrides` targeting a missing path, throws at `applyOverlays`
  time. This is intentional — you want to notice when the upstream
  adds or removes a path you've referenced rather than have the
  overlay silently no-op.

## Related

- [`packages/spec/src/overlay.ts`](./packages/spec/src/overlay.ts) —
  the implementation, including the full merge rules for each kind
  of override.
- [`examples/overlay-petstore-schema.ts`](./examples/overlay-petstore-schema.ts)
  and
  [`examples/overlay-petstore-endpoint.ts`](./examples/overlay-petstore-endpoint.ts)
  — runnable end-to-end demos.
- [README "Why (yet another) OpenAPI validator?"](./README.md#why-yet-another-openapi-validator) —
  overlays as one of the three motivating reasons the project exists.
