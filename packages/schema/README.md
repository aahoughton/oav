# @oav/schema

JSON Schema 2020-12 compiler. Emits JavaScript via code generation (think
Ajv-style) rather than interpreting at runtime. Every compiled validator
returns a `{ valid, error? }` object where `error` is a `ValidationError`
tree.

## Quick start

```ts
import { compileSchema, defaultVocabularies } from "@oav/schema";

const { validate } = compileSchema(
  { type: "object", required: ["name"], properties: { name: { type: "string" } } },
  { vocabularies: defaultVocabularies },
);

validate({ name: "Fido" }); // { valid: true }
validate({}); // { valid: false, error: { code: "required", ... } }
```

## Vocabularies

Five built-in vocabularies compose into `defaultVocabularies`:

- `coreVocabulary` — `$ref`, `$dynamicRef`, `$id`, `$defs`, anchors.
- `validationVocabulary` — `type`, `enum`, `const`, numeric / string /
  array / object bounds, `required`.
- `applicatorVocabulary` — composition keywords (`allOf`, `oneOf`, …),
  nested schemas (`properties`, `items`, …), `if`/`then`/`else`, and
  OpenAPI's `discriminator`.
- `unevaluatedVocabulary` — `unevaluatedProperties`, `unevaluatedItems`.
- `formatVocabulary` — `format` (assertive by default).

## Registering a custom keyword

Pass a `keywords` record at compile time — the compiler wraps each
validator into a `KeywordDefinition`, registers it alongside the
built-ins, and dispatches via generated code on the hot path:

```ts
import { compileSchema, defaultVocabularies } from "@oav/schema";

const { validate } = compileSchema(
  { type: "integer", divisibleBy: 7 },
  {
    vocabularies: defaultVocabularies,
    keywords: {
      divisibleBy: (data, schemaValue) =>
        typeof data !== "number" || data % (schemaValue as number) === 0,
    },
  },
);
```

Return `true` for valid, `false` for a generic failure, or
`{ message?, params? }` for a custom error leaf. Names that collide with
a built-in keyword throw at construction.

For lower-level extensions (applicator keywords, evaluation tracking,
custom emit shapes), write a full `KeywordDefinition` and put it in your
own `Vocabulary`. Keyword authors see only what they need: `gen`, `data`
/ `path` / `errors`, `subschema()`, `resolveRef()`, `pushError()` /
`liftError()`, and `emitSubschemaValidation()`.

## Error-collection modes

`compileSchema(schema, { maxErrors: N })` caps the tree at N leaves and
short-circuits hot loops once the budget is exhausted. `maxErrors: 1` is
classic fast-fail; larger values bound CPU/memory on huge invalid
payloads. The returned `{ valid: false, error, truncated: true }` flags
when the report was shortened. Omit the option for zero-overhead
unlimited collection — codegen is specialised so uncapped callers emit
plain `errors.push` with no budget checks.

## `$ref` and cycles

`$ref` / `$dynamicRef` compile to function calls through a
schema-identity-keyed cache, so a self-referential schema emits a normal
recursive call rather than blowing the stack at compile time. See
`resolve()` / `createRefResolver()` for the resolution pipeline.
