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
validator for the subtrees a compile-time classifier marks BUFFER (so
format assertion and built-in formats come from that delegate), and
reuses `@oav/core`'s flat error model.

> **Incubating, unpublished.** This package is `private` and ships
> TypeScript source, not a build. It is consumed inside the OAV monorepo
> via `workspace:*`; there is no `@oav/stream-validator` on npm. The
> import path below resolves to the workspace source.

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

Count and length limits resolve as early as the input allows: an
**over-limit** (`maxItems`, `maxProperties`, `maxLength`) fails at the
offending element / key / code point, before the rest of the value
streams, so under `terminate` an over-count body is rejected without
echoing its tail downstream. An **under-limit** (`minItems`,
`minProperties`, `minLength`) can only be known once the scope closes, so
it reports at the closing delimiter. The verdict is identical either way;
eager enforcement only moves _when_ the violation surfaces (and its byte
offset points at the cause rather than the delimiter).

### Supported schemas (incubation)

The STREAM keyword set (`type`, scalar/string/number constraints,
`properties` / `items` / `required` / bounds / `propertyNames` /
`dependentRequired`, `$ref` recursion, boolean schemas) validates on the
forward spine in one pass. Forward composition (`allOf` / `anyOf` /
`oneOf` / `not` / `if`, all branches forward) **TEEs**: the value's events
fan out to one forward sub-spine per branch, so a composition body still
streams without materializing. Everything that genuinely needs the whole
value (object/array `enum` / `const`, `dependentSchemas`, `discriminator`,
`contains`, `uniqueItems`, a composition with a non-forward branch, or
`format` under an OpenAPI dialect) is a **BUFFER island**: the subtree is
materialized and delegated to `@oav/schema`'s in-memory validator,
bounded by `maxBufferedBytes`. Only a REJECT keyword
(`unevaluatedProperties` / `unevaluatedItems`), an unknown keyword, or an
unresolvable `$ref` fails fast at construction.

OpenAPI: pass `openApiVersion: "3.0" | "3.1" | "3.2"`. 3.0 is normalized
to 2020-12 shape (`nullable`, boolean `exclusive*`, `$ref` sibling
suppression) before classification; all three select OpenAPI semantics
(`format` asserts).

The engine validates one resolved schema and resolves `$ref` against
**the schema you pass**, not a separate document. An extracted request
body that is (or contains) an internal ref like
`#/components/schemas/Pet` must carry the document's ref containers
(`components` / `$defs` / `definitions`) alongside it, or construction
throws `unresolvable $ref`. Routing, content negotiation, OpenAPI version
detection, and body-schema lookup stay the caller's job; this package
validates one resolved schema, so those concerns sit above it. The
bridge from a resolved document is short:

```ts
import { resolveSpec } from "@oav/spec";
import { createStreamValidator } from "@oav/stream-validator";

const doc = await resolveSpec(source); // inlines external refs; internal refs stay
const op = doc.paths["/pets"].post; // your router selects the operation
const bodySchema = op.requestBody.content["application/json"].schema;

const validator = createStreamValidator(
  { ...bodySchema, components: doc.components }, // carry the ref container
  { openApiVersion: "3.1" },
);
```

Observability and edit hooks: `keyEvents` emits a `key` event per object
key (optionally path-filtered); `onScopeClose(at, cb)` observes a
forward-decidable scope at its close, and `editClose(at, cb)` appends
bytes before a scope's closing delimiter (append-only; appended bytes are
not validated). A `ScopeContext` carries the scope path, verdict, member
count, and a `field(name, value)` helper.

Recovering scalar fields: `valueEvents` emits a `value` event when a
scalar object-member value completes, carrying the member's absolute
input-byte span (`valueStart` / `valueEnd`). Code that needs a few small
top-level scalars (an id, a version, a timestamp) recovers them without
materializing the body or running a second parser: slice
`[valueStart, valueEnd)` from its own copy of the input (a string span
includes its quotes, so the slice is valid JSON) and `JSON.parse` it. The
span is in the same pre-injection input space as `editClose` and
violations, so slice the **input**, not the echoed output (under
`editClose` the output is respliced and its offsets shift).

```ts
const captured = new Map<string, unknown>();
const validator = createStreamValidator(bodySchema, {
  // Decode the matched scalars under a byte cap.
  valueEvents: { at: (path) => path.length === 1, capture: true },
});
validator.on("value", (e) => captured.set(e.key, e.value));
// `e.value` is the decoded scalar (present when within `maxCaptureBytes`);
// `e.truncated` flags an over-cap value (span still reported). Omit
// `capture` for span-only events and slice the bytes yourself.
```

`valueEvents` fires for scalar object members on both the STREAM path and
scalar BUFFER islands, so a `format`-bearing string (`date-time`, `uri`,
`uuid`) reports its value even under an asserting OpenAPI dialect that
delegates it to the in-memory engine. Array elements, the root value,
container-valued members, and members under a TEE composition branch do
not fire. `capture` retains a matched member's decoded bytes bounded by
`maxCaptureBytes` (default 64 KiB); an over-cap value reports
`truncated: true` rather than buffering unbounded. A delegated scalar is
already buffered for its own check, so there `maxCaptureBytes` only gates
delivery (the memory bound is `maxBufferedBytes`).

`onScopeClose` / `editClose` fire for STREAM scopes only. A scope the
classifier routes to a BUFFER island (`uniqueItems`, `contains`, an
object-valued `const`) or a TEE composition branch
(`oneOf`/`anyOf`/`allOf`) does not emit a scope-close hook, so which
scopes a hook sees depends on the schema's classification. Use the hooks
for observing/editing forward-decidable structure, not as a general JSON
visitor over an arbitrary schema.

## Status

Incubating and **unpublished** (`private`). The package lives in the
monorepo via `workspace:*` so its classifier can co-evolve with
`@oav/schema`'s keyword set (a CI drift test makes that a build failure
rather than silent breakage).
