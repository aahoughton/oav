# @oav/stream-validator (incubating)

A streaming JSON Schema 2020-12 validator. It validates a JSON document
against a resolved schema **as it streams**, echoing the input bytes
through unchanged while reporting violations on a side channel. Memory is
bounded for forward-decidable schemas with structural bounds (or
configured caps), so multi-GB request bodies validate without
materializing in heap.

This is a second engine, not a mode of `@oav/schema`. `@oav/schema`'s
compiler is pull-based over a fully-parsed value; this engine is
push-based over a token stream. It reuses `@oav/schema`'s in-memory
validator for the subtrees a compile-time classifier marks BUFFER, and
reuses `@oav/core`'s flat error model and `@oav/formats`.

## Usage

```ts
import { pipeline } from "node:stream/promises";
import { createStreamValidator } from "@oav/stream-validator";

const validator = createStreamValidator(schema); // throws here if the schema can't be streamed

try {
  await pipeline(request, validator, fs.createWriteStream(tmp));
  await rename(tmp, final); // reached only on a clean finish = valid
} catch (err) {
  // ValidationFailedError (well-formed but invalid) or a parse / I/O error
  await unlink(tmp).catch(() => {});
}

// Or observe the side channel directly:
validator.on("violation", (v) => console.warn(v.code, v.path, v.byteOffset));
const verdict = await validator.result; // { valid, violations }
```

Output bytes are the input verbatim (provisional until a clean finish).
The default policy is `terminate` with `maxErrors: 1` (the first violation
destroys the stream and rejects the `pipeline`); `detach` instead seals
the verdict and raw-copies the tail.

### Supported subset (incubation)

The engine currently validates **fully-streamable** schemas (the STREAM
keyword set: `type`, scalar/string/number constraints, `properties` /
`items` / `required` / bounds / `propertyNames` / `dependentRequired`,
`$ref` recursion, scalar `uniqueItems`, boolean schemas). A schema that
needs TEE (`allOf` / `anyOf` / `oneOf` / `not` / `if`) or BUFFER
(object/array `enum` / `const`, `dependentSchemas`, `discriminator`,
`contains`) fails fast at construction; those land in later build steps
(see the design doc's build sequence).

## Status

Incubating and **unpublished** (`private`). The package lives in the
monorepo via `workspace:*` so its classifier can co-evolve with
`@oav/schema`'s keyword set (a CI drift test makes that a build failure
rather than silent breakage). Maturity gate: `private` -> `experimental`
dist-tag -> public `latest`.

## Design

The full design and build spec is
[docs/stream-validator.md](../../docs/stream-validator.md): the
invariants an implementation must honor, the SAX-spine / classifier /
BUFFER-island architecture, the keyword support matrix, the resource
model, and the 11-step build sequence. Read "Invariants" and
"Architecture" there first.
