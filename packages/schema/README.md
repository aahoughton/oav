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

## Writing a custom keyword

```ts
import { type KeywordDefinition } from "@oav/schema";

export const divisibleBy: KeywordDefinition = {
  keyword: "divisibleBy",
  vocabulary: "x-extensions",
  compile(ctx) {
    const divisor = ctx.schema as number;
    ctx.gen.if(`typeof ${ctx.data} === "number" && ${ctx.data} % ${divisor} !== 0`, (g) =>
      ctx.error({ code: "divisibleBy", message: `must be divisible by ${divisor}` }),
    );
  },
};
```

Keyword authors receive only what they need: `gen` (codegen handle),
`data` / `path` / `errors` (JS expressions), `subschema()`,
`resolveRef()`, `error()`. There is no `this` threading of the compiler.

## `$ref` and cycles

`$ref` / `$dynamicRef` compile to function calls through a
schema-identity-keyed cache, so a self-referential schema emits a normal
recursive call rather than blowing the stack at compile time. See
`resolve()` / `createRefResolver()` for the resolution pipeline.
