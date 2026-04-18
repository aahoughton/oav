# Examples

Self-contained TypeScript examples that exercise the most common
`oav` entry points. Each file is runnable on its own — no build step,
no external services — and prints what it did to stdout.

## Running

From the repo root, after `pnpm install`:

```bash
pnpm tsx examples/<example>.ts
```

The examples import from `packages/*/src` directly so they work without
`pnpm build`. Third-party consumers would write
`import { ... } from "@aahoughton/oav"` / `"@aahoughton/oav/spec"`
instead; the logic translates 1:1.

## What's in here

| File                      | Shows                                                                |
| ------------------------- | -------------------------------------------------------------------- |
| `basic-validation.ts`     | Inline spec → `createValidator` → request + response checks          |
| `custom-formats.ts`       | Register a user format (E.164 phone) via the `formats` option        |
| `custom-keywords.ts`      | Register a schema keyword (`activeTenant`) via the `keywords` option |
| `max-errors.ts`           | Fast-fail and bounded error collection on a bulk-invalid payload     |
| `versions.ts`             | 3.0, 3.1, and 3.2 side by side — `nullable`, QUERY method, etc.      |
| `overlay.ts`              | Merge a gateway-specific header requirement via `applyOverlays`      |

## Conventions

- Inline OpenAPI documents keep everything in one file — swap the
  inline doc for `loadSpec(...)` to read from disk or HTTP.
- Success paths print `ok`; failure paths print the formatted error
  tree so you can see what the validator surfaces.
