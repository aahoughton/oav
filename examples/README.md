# Examples

Self-contained TypeScript examples that exercise the most common
`oav` entry points. Each file loads a spec from [`specs/`](./specs)
and prints what it did to stdout — the same pattern a real application
uses, so the example code translates 1:1 into production use.

## Running

From the repo root, after `pnpm install`:

```bash
pnpm dlx tsx examples/<example>.ts
```

The examples import from `packages/*/src` directly so they work without
`pnpm build`. Third-party consumers would write
`import { ... } from "@aahoughton/oav"` / `"@aahoughton/oav/spec"`
instead; the logic translates 1:1. Consumers on the lean
`@aahoughton/oav-core` package can substitute `@aahoughton/oav-core`
for `@aahoughton/oav` in import specifiers that don't touch
`createYamlFileReader` (oav-core is JSON-only).

## What's in here

| File                           | Spec                  | Shows                                                                               |
| ------------------------------ | --------------------- | ----------------------------------------------------------------------------------- |
| `basic-validation.ts`          | `petstore.yaml`       | Load a spec → `createValidator` → request + response checks                         |
| `custom-formats.ts`            | `contacts.yaml`       | Register a user format (E.164 phone) via the `formats` option                       |
| `custom-keywords.ts`           | `widgets.yaml`        | Register a schema keyword (`activeTenant`) via the `keywords` option                |
| `cross-field-validation.ts`    | `ranges.yaml`         | Cross-field constraint (`max >= min`) via an object-level custom keyword            |
| `max-errors.ts`                | `items.yaml`          | Fast-fail and bounded error collection on a bulk-invalid payload                    |
| `versions.ts`                  | `pets-3.{0,1,2}.yaml` | 3.0, 3.1, and 3.2 side by side: `nullable`, QUERY method, etc.                      |
| `overlay.ts`                   | `petstore.yaml`       | Minimal overlay: merge a gateway header requirement into one op                     |
| `overlay-petstore-schema.ts`   | `petstore.yaml`       | Extend the `Pet` component with a deployment-required field                         |
| `overlay-petstore-endpoint.ts` | `petstore.yaml`       | Require an `X-Tenant` header on `POST /pets` via an endpoint overlay                |
| `spec-digest.ts`               | `uploads.yaml`        | Derive middleware config (multer limits, required headers) from the spec at startup |

See [`docs/overlays.md`](../docs/overlays.md) for a walk-through of the overlay
shape and when to use each section (`extendSchemas`, `replaceSchemas`,
`overrides`, `addPaths`).

## Conventions

- Specs live in [`specs/`](./specs) as YAML files, loaded via
  `loadSpec` + `createYamlFileReader`. The same pattern works for a
  real application's spec; swap the entry path.
- Success paths print `ok`; failure paths print the formatted error
  tree so you can see what the validator surfaces.
