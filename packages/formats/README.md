# @oav/formats

Built-in string format validators for `@oav/schema`'s `format` keyword.

```ts
import { builtInFormats, validateUuid } from "@oav/formats";
import { compileSchema, defaultVocabularies } from "@oav/schema";

const { validate } = compileSchema(
  { type: "string", format: "uuid" },
  { vocabularies: defaultVocabularies, formats: builtInFormats },
);

validate("550e8400-e29b-41d4-a716-446655440000"); // { valid: true }
validateUuid("not a uuid"); // false
```

Formats:

- **date / time** — `date-time`, `date`, `time`, `duration` (RFC 3339)
- **email** — `email` (ASCII), `idn-email` (RFC 6531)
- **hostname** — `hostname`, `idn-hostname`
- **ip** — `ipv4`, `ipv6`
- **uri** — `uri`, `uri-reference`, `iri`, `iri-reference`, `uri-template`
- **json pointer** — `json-pointer`, `relative-json-pointer`
- **misc** — `regex`, `uuid`

Each validator is a pure `(value: string) => boolean`.

## Registering a custom format

The validator and compiler both accept a `formats` option that merges on
top of the built-ins:

```ts
import { createValidator } from "@oav/validator";

const v = createValidator(spec, {
  formats: {
    "e164-phone": (s) => /^\+[1-9]\d{6,14}$/.test(s),
  },
});
```

In the spec, reference the format as you would any built-in:

```yaml
Phone:
  type: string
  format: e164-phone
```

See [`examples/custom-formats.ts`](../../examples/custom-formats.ts) for
a runnable end-to-end.
