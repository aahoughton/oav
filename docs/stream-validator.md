# Streaming JSON Schema Validator (`@oav/stream-validator`)

Design and build spec for a streaming JSON validator. It parses JSON on the
fly, validates against a resolved JSON Schema 2020-12 schema, and echoes the
bytes through unchanged while reporting violations on a side channel. Memory is
bounded for forward-decidable schemas with structural bounds (or configured
caps), not by document size, so multi-GB bodies validate without materializing
in heap. Schemas with BUFFER islands, forced-buffer scalars, or `uniqueItems`
can grow with the document; `strict` mode plus caps is the recommended
production setting for untrusted input (see "Resource model"). A new package in
the OAV monorepo that reuses OAV's error model and formats, and delegates
ambiguous subtrees to OAV's in-memory compiler.

This document is both the design (the invariants an implementation must honor)
and the build spec (what to build, in what order). Read "Invariants" and
"Architecture" first; they constrain everything else.

## What to build

- **Surface:** a Node `Transform` (bytes in, bytes out) plus a side channel of
  flat validation events (no tree output mode) and a final verdict (delivered as
  both an event and a resolved promise).
- **Package:** `@oav/stream-validator` (published `@aahoughton/oav-stream-validator`),
  a new top-level package in the OAV monorepo, sibling to `@oav/validator`,
  depending on `core` / `formats` / `schema` / `spec` (no cycle).
- **Engine shape:** a SAX tokenizer drives forward state machines on an explicit
  heap scope stack (the _spine_). A compile-time classifier marks each subschema
  STREAM / TEE / BUFFER / REJECT. BUFFER subtrees are materialized and handed to
  `@oav/schema`'s in-memory validator. Output bytes echo through unchanged.
- **Prerequisite (only change outside the new package):** two additive exports
  from `@oav/schema`, the registered keyword **definitions** (name →
  `KeywordDefinition`, including the `applicator` / `annotation` / `evaluates` /
  `implements` flags the classifier reads) and a public `schemaUsesUnevaluated`.
  Both widen the surface; neither changes behavior. Tracked as #405.

### v1 scope

Validate-only, large HTTP **request** bodies, against one resolved schema. Any
OAV-supported OpenAPI version (3.0 / 3.1 / 3.2): the engine classifies a
2020-12-shaped schema it produces via its own normalization pass (3.0 needs the
most; 3.1 / 3.2 are 2020-12-native), so version support is gated only
per-keyword. There is no ready-made normalized schema from OAV to consume (see
"OpenAPI dialect normalization"). No routing, no response validation, no
`readOnly`/`writeOnly` direction transform; the `@oav/spec` touch point is
`resolveSpec()`, then the normalization pass, then classification.

Deferred to post-v1: response-body validation; the HTTP adapter
(`validateRequestStream` + a public `bodySchemaFor` in `@oav/validator`);
spine-recursion into large islands (v1 materializes islands wholesale);
exact-OAV-message parity mode; framed multi-document input; a per-keyword
strategy override for custom keywords.

## Invariants

Honor these everywhere. Most bugs in a streaming validator are violations of one
of these.

1. **Output is the verbatim input byte stream plus edit-hook appends, nothing
   else.** The engine never reconstructs output from parsed values. All
   buffering, a forced-buffer scalar or a BUFFER island, is validation-internal
   and invisible to output. This is what keeps echo byte-exact while validation
   materializes things internally.
2. **A schema either compiles to a sound validator or it throws at compile.**
   Classification is a data-free schema walk; an unhandleable schema is rejected
   up front with the keyword and JSON path, before any byte is read. Never a
   half-working validator that fails partway through a 2 GB body.
3. **Bounded memory.** Everything that can grow unbounded in heap is a _buffer_
   (a forced-buffer scalar or a BUFFER island) governed by one cap,
   `maxBufferedBytes`. The non-buffer unbounded dimensions are depth
   (`maxDepth`), raw input size (`maxTotalBytes`, a policy lever the STREAM path
   does not otherwise need), and `uniqueItems` (it retains a hash per distinct
   item, O(array length); see "Resource model"), the one keyword that is not
   bounded-memory.
4. **Correctness and memory are distinct levers.** Unhandleable schemas
   fast-fail at compile (invariant 2). Sound-but-unbounded schemas get a
   compile-time warning and are capped only via opt-in limits / strict mode. One
   is never silently downgraded to the other.
5. **Provisional bytes.** Emitted bytes are "accepted so far," which a later
   parse error or violation can retract. Consumers do not trust bytes until a
   clean finish or a valid verdict.
6. **Match `JSON.parse` semantics** wherever a choice arises (numbers as JS
   doubles, lone surrogates accepted, trailing non-whitespace rejected, multiple
   top-level texts rejected), because the verdict must equal what OAV's
   in-memory engine, which validates the `JSON.parse`'d value, would produce.
   The one documented exception is duplicate keys (see "Duplicate keys").

## Prior art

The capability exists in pieces; this composition does not. RapidJSON (C++) is
the closest: a SAX schema validator with schema-bounded memory that forwards SAX
_events_, but it re-serializes rather than echoing bytes, stops at the first
error, and targets Draft 4. JSONSchemaParse (JS) streams parse-and-validate but
terminates on first violation, has no byte pass-through, and is unmaintained.
Theory is settled (VPAs accept the same documents as any JSON Schema; the
STREAM = finite-state / BUFFER = stack split is the practical form), and the XML
world solved the analog 15+ years ago by restricting the schema language to the
one-pass-decidable subset. Production gateways punt (cap-and-buffer, or document
payload access during streaming as an antipattern). Novel here: byte-exact
echo-through, a side channel that _continues_ past violations, OpenAPI dialect
handling, and the provisional-bytes / two-lifecycle / edit-hook / key-event
model. The event-reserialize and terminate-only forks were considered and
rejected.

## Architecture

### Core constraint (why this is a new engine, not an OAV mode)

OAV's compiler generates JS over a fully-parsed, random-access value
(`data["email"]`, `data.length`, `data[i]`, `for...in` over the keyset), and
`@oav/validator` calls `JSON.parse` before validating. That model is pull-based
over a materialized value. A streaming validator is push-based over an event
stream. The codegen cannot be the spine. This is a second engine that delegates
back to the first at the subtrees the classifier marks BUFFER.

### Spine, classifier, islands

- **Spine:** the SAX tokenizer feeds forward state machines that carry scope
  (path, seen-keys, counters, depth) on an explicit heap stack. `$ref` recursion
  pushes onto this stack, so deep nesting does not overflow the native call
  stack (it is bounded by `maxDepth`). Most validation happens here in one pass.
- **Classifier:** a compile-time walk assigns each subschema a strategy. See
  "Classification."
- **BUFFER islands:** a subtree marked BUFFER is materialized from the SAX
  events (no re-parse) and handed to the in-memory validator via
  `compileSchema(subschema).validate(value, startPath)`. The streaming path
  stack is passed as `startPath`, so island errors slot into the right path. v1
  materializes islands wholesale; recursing the spine into an island's
  forward-decidable sub-parts is a later optimization behind this same boundary.

An island's cost is the materialized JS value in heap, limited via
`maxBufferedBytes` by the island's UTF-8 source-byte span (heap is proportional,
not exactly bounded; see "Island materialization").

### Source-agnostic

The engine is a `Transform` over arbitrary `Readable` chunks with normal
backpressure. A consumer may spool the raw request to disk and run the engine
over the replay; nothing assumes a live socket.

## Classification

Each subschema node is assigned one strategy, after OpenAPI dialect
normalization (see "OpenAPI dialect"), so the classifier sees a resolved
2020-12-shaped schema. The same distinction also applies at the scalar level
(below).

### STREAM (forward, no buffering)

- `type`, `format`, `pattern`, `min*` / `max*`, `enum` / `const` on scalars.
- `$ref` (self- and mutually-recursive), via the explicit scope stack.
- `properties`, `required`, `propertyNames`: track seen keys; validate a value
  as it arrives, a key at key-time, `required` at object-close.
- `additionalProperties` / `patternProperties`: with `properties` /
  `patternProperties` fixed at compile time, reject an unexpected key on sight
  (subschema `false`) or validate its value as it arrives.
- `dependentRequired`: object-scope presence tracking; missing dependency at
  object-close.
- `items` / `prefixItems`: per element.
- `contains` / `minContains` / `maxContains`: match counter at array-close, but
  **only STREAM when the contained predicate subschema is forward-decidable**. If
  the predicate is non-forward (a non-forward `oneOf`, object `enum`/`const`, a
  `dependentSchemas`), each item must be materialized and tested as a BUFFER
  sub-validation, with `maxBufferedBytes` implications. (This is the general rule
  for any per-item / per-property applicator: it inherits the applied subschema's
  strategy. `items`, `additionalProperties`, etc. follow it too.)
- `uniqueItems`: canonical incremental hash per item (canonicalize key order /
  number form so deep-equal items hash equal). **This is a deliberate non-parity
  mode:** treating a hash-match as equal is not exact JSON Schema equality unless
  collisions are impossible; with a strong hash the false-positive probability is
  negligible but nonzero, so a streaming `uniqueItems` verdict can in principle
  differ from in-memory on a hash collision. The exact alternative is to retain
  canonical forms and confirm collisions, or classify `uniqueItems` over
  object/array items as BUFFER; offer that as an opt-in exact mode, default to
  the hash mode. Hashing an object item buffers it briefly to canonicalize,
  bounded per-item by `maxBufferedBytes`. **Memory exception:** detecting
  duplicates in one pass requires retaining the hash of every distinct item, so
  this is the one STREAM keyword whose memory is O(array length), unbounded by
  the schema unless `maxItems` bounds the array. The seen-hash set is not raw
  bytes, so `maxBufferedBytes` does not cover it (see "Resource model"). Not
  worse than the in-memory engine (which materializes the whole array), but it
  is the one place STREAM is not bounded-memory.

Timing: over-limits (`maxItems`, `maxLength`, `maxProperties`) fire **eagerly**
(the offending token, before its bytes are fully consumed). Under-limits
(`minItems`, `minProperties`, `required`, `minContains`, `dependentRequired`)
fire at **scope-close** (falling short is knowable only then). The support
matrix records both columns.

### Scalar-level STREAM vs. buffer

A string whose only constraints are incrementally checkable (`minLength` /
`maxLength`, or none) streams chunk by chunk with no retention. A string with
`pattern` or `format` must accumulate its content to run the predicate at
scalar-end. Numbers and keys are accumulated whole (to parse, and to dispatch).
These are _bounded buffered scalars_, governed by `maxBufferedBytes`. `enum` /
`const` scalars are bounded by their own literals.

### TEE (fan out events, no buffering)

Replicate the event stream to sub-state-machines, combine at scope-close, when
every child is forward:

- `allOf` (AND), `not` (negate), `anyOf` (OR, stop at first success).
- `oneOf`: cannot short-circuit (must prove a second branch does not also
  match), so every branch runs to scope-close and the match count is checked
  there; TEE still avoids materializing the value.

`oneOf` / `anyOf` / `if`-`then`-`else` TEE when their branches are
forward-decidable; otherwise they BUFFER.

TEE has no buffering cost but a _fan-out_ cost: nested applicators multiply the
number of live sub-state-machines and the per-event CPU (an `allOf` of `anyOf`s
over a subtree runs every event through the product of branches). It is no worse
than the in-memory engine, but it is a scalability cliff worth a compile-time
warning when the live-machine product crosses a threshold (and an optional
branch/state budget). This is CPU, not memory; it is bounded by the schema's
branch structure, not the document.

### BUFFER (materialize the subtree, hand to the in-memory validator)

- `oneOf` / `anyOf` / `if`-`then`-`else` with a non-forward branch (or in parity
  mode).
- `enum` / `const` with object or array values (exact equality, via
  materialization).
- `dependentSchemas`: a late trigger key can constrain properties already
  streamed past, so the object scope is held (a dependent subschema that is
  itself forward can avoid the hold).

### REJECT (compile error): fast-fail

A node the classifier cannot assign a sound strategy throws at compile, naming
the keyword and JSON path. The reject set:

- `unevaluatedProperties` / `unevaluatedItems`: need the merged evaluated-key set
  across applicators and branches, whole-scope and cross-branch coupled. (Drive
  the gate off the public `walkSubschemas`; `@oav/schema` exposes a public
  `schemaUsesUnevaluated`.)
- Unknown keywords `@oav/schema` does not understand: cannot be delegated.
- Known-but-unclassified keywords (drift backstop; the CI drift test prevents
  shipping this, the compile reject covers a consumer on a newer `@oav/schema`).

Custom keywords: a custom keyword registered with `@oav/schema`'s compiler is
BUFFER-delegated (the in-memory validator knows it); an unrecognized one is
REJECT, never silent BUFFER (silent BUFFER of an unknown keyword would
mis-validate). v1 always BUFFERs delegable custom keywords; a STREAM/TEE
override is a post-v1 option.

## Components

### Tokenizer (SAX)

A small, custom tokenizer, a first-class module with its own unit + fuzz /
property tests. It owns byte offsets, echo coordination, terminate/detach
behavior, and parse-boundary limits. Strings stream as chunks; keys and numbers
are delivered whole (a key because dispatch to `properties[k]` needs all of it,
a number because the value needs the complete literal), both bounded buffered
scalars.

**Realize the contract as a handler-callback interface, not per-token objects.**
This is a hot loop: a large document is tens of millions of tokens, so allocating
one event object per token is GC thrash that can dominate runtime. The tokenizer
calls a handler (`onStartObject()`, `onString(start, end)`, `onNumber(raw, …)`,
…) with primitive arguments, or reuses a single mutable event struct. Standalone
testability is preserved by attaching a recording handler. The type below
documents the _logical_ shapes; it is not a mandate to allocate. Offsets are raw
_byte_ offsets, never decoded character positions.

```ts
type JsonEvent = // logical shapes; implement as handler callbacks, not allocations
  | { type: "startObject"; offset: number }
  | { type: "endObject"; offset: number }
  | { type: "startArray"; offset: number }
  | { type: "endArray"; offset: number }
  | { type: "key"; value: string; startOffset: number; endOffset: number }
  | { type: "stringStart"; offset: number }
  | { type: "stringChunk"; chunk: string; offset: number } // 0+ per string
  | { type: "stringEnd"; startOffset: number; endOffset: number }
  | { type: "number"; value: number; raw: string; startOffset: number; endOffset: number }
  | { type: "boolean"; value: boolean; startOffset: number; endOffset: number }
  | { type: "null"; startOffset: number; endOffset: number };
```

**Decode lazily.** Decoding UTF-8 to a JS string is hot-path cost most strings do
not need: the echo path consumes only bytes, and an unconstrained or
`maxLength`-only string needs no decoded value at all. Pass byte ranges and
materialize the JS string only when a keyword consumes it (`pattern`, `format`,
`enum`/`const`, or a key for dispatch). In particular, count `maxLength` /
`minLength` as Unicode **code points** without allocating the JS string, but the
counter must be **escape-aware**, not a raw byte count. A JSON string's length is
in code points of the _decoded_ value: a six-char `\u` escape is 1 code point
(not 6), a two-char escape like newline is 1, and a `\u`+`\u` surrogate-escape
pair is 1. So the counter scans the source recognizing JSON escapes (`\u` escapes,
two-char escapes, and surrogate-pair `\u`+`\u`) and counts plain UTF-8 runs by
non-continuation bytes. Never use a decoded string's `.length` (UTF-16 units, wrong for astral
characters, and forces the decode you are avoiding).

A `pattern`/`format` string position accumulates its own chunks to run the
predicate at `stringEnd`; a stream-classified position consumes chunks without
retaining them.

Parity policy: **match `JSON.parse`.** Accept lone/invalid surrogates as JS
does; reject trailing non-whitespace; reject multiple top-level JSON texts
(unless a framed mode is added later); numbers are JS doubles (a huge literal
yields the same `Infinity` / rounded value `JSON.parse` gives, no rejection, no
extra precision).

Edge cases that must be explicit tests: UTF-8 and escape sequences split across
chunks; surrogate pairs (valid and invalid); **escaped-string length** (a
six-char `\u` escape = 1 code point, a `\u`+`\u` surrogate-escape pair = 1,
escapes split across chunks, lone surrogate escapes), which catches the
escape-aware-counter bug early; the exact JSON number grammar
and huge numbers; top-level primitives; trailing whitespace vs. garbage; multiple
top-level texts; duplicate keys; max nesting depth; consumer abort mid-parse.

### Classifier

Walks the schema assigning each node a strategy, and emits a per-node strategy
map plus compile-time warnings (see "Resource model"). The classification table
lives in this package, keyed off `@oav/schema`'s keyword identity.

**`$ref` is a graph problem requiring an SCC fixpoint, not an optimistic tree
walk.** `walkSubschemas` visits `$ref` nodes but does not descend them, and
`resolveSpec()` leaves internal and circular refs in place (circular external
refs are materialized under `$defs.__ext__/<uri>`). So the classifier resolves
each `$ref` to its target and classifies the _target_, or it under-classifies
everything behind a ref. A node's strategy is the join of its own keywords and
its referenced target's strategy (a STREAM node behind a `$ref` to a BUFFER
target is BUFFER at the reference site).

Recursion needs care: treating an in-progress target as STREAM is **only sound
if the whole reference cycle classifies as STREAM**. A recursive target can
contain BUFFER or REJECT keywords elsewhere in the cycle, which an optimistic
"in-progress → STREAM" would miss. So compute strongly-connected components of
the ref graph and classify by fixpoint:

- Build the ref graph; find SCCs (each ref cycle is an SCC).
- For each SCC, join the strategies of _all_ member nodes (BUFFER dominates
  STREAM/TEE; REJECT dominates everything). That join is the SCC's strategy.
- Mark every recursive back-edge with the SCC's final strategy. A self-recursive
  schema that is STREAM throughout becomes a recursive spine call (like OAV
  emitting a recursive function); one whose cycle contains a BUFFER node is
  BUFFER (materialize the recursive subtree), and a REJECT anywhere in the cycle
  fails the compile.
- Memoize per SCC, classify once, reuse.

**Drift test (required):** a CI test imports `@oav/schema`'s registered-keyword
list and asserts every keyword has a classification, and covers the dialect
rules (3.0 normalizations) too. A new keyword or dialect rule cannot land
without the engine consciously handling it.

### Forward state machines + scope stack

Per-keyword forward state machines for the STREAM set, driven by tokenizer
events, carrying scope on an explicit heap stack. `$ref` pushes onto it.

### Island materialization

A BUFFER island is built **incrementally in heap as a JS value** from the SAX
events (no raw-byte buffer, no re-parse), then handed to
`compileSchema(...).validate(value, startPath)`. It is bounded by
`maxBufferedBytes`, measured as the island subtree's **UTF-8 source-byte span**
(from its start to its close, free to track from byte offsets), which refuses an
oversize island before the JS value grows large. The source-byte span is a
proportional proxy for the heap the materialized value will take, not an exact
heap bound (see "Resource model"). A consumer that wants to spool the whole
request to disk before validating does so outside the engine.

### Output model: echo-through

Raw echo-through: emit input bytes as they arrive, never gated on validation or
parser acceptance (invariants 1 and 5). The only output mutation is an edit hook
appending bytes before a scope's closing delimiter, which defers that single
delimiter (a bounded one-token hold, not value buffering). With no hook bound,
output is a blind byte copy. Not parser-gated and not validate-gated (those
trade latency for a "guaranteed-syntactic" or "guaranteed-valid" byte stream;
out of scope).

### Channels and events

Two channels: the output byte stream, and a side channel of validation /
lifecycle events. Node's `error` is terminal and cannot carry up-to-`maxErrors`
non-fatal violations, so events are distinct:

- `violation`: well-formed JSON failing the schema. Non-fatal, up to
  `maxErrors`. Carries `{ code, params, path, byteOffset }` (reuse OAV's flat
  error shapes). **Flat violations only; there is no tree output mode.** A tree
  cannot be finalized until all descendants are known, the opposite of
  incremental emission, so OAV's tree assembler is unused here and a tree
  `output` mode is not offered.
- `error`: fatal infrastructure failure (parse error or I/O). Terminal, destroys
  the stream, triggers cleanup.
- `verdict`: the final valid/invalid result and counts, delivered as **both** a
  side-channel event and a resolved promise. Never inferred from the byte
  stream.

Three outcomes, kept distinct: a `violation` (non-fatal); an `error` (fatal by
mechanism, parse / I/O); and a **terminal validation failure** (fatal by policy
under `terminate`), surfaced as a dedicated `ValidationFailedError` carrying the
verdict, never reusing the parse/I/O `error`. A consumer must distinguish "bytes
were garbage" from "bytes were fine but did not match."

**Backpressure model.** The engine is a `Transform` that respects output
backpressure: when the byte sink is slow (`push()` returns false), it stops
pulling input, so validation does not run ahead of consumption and the side
channel cannot queue unboundedly. Events advance in lockstep with bytes
consumed. There is no decoupled internal queue in v1; if a future mode ever
keeps validating while output is paused, it must carry a bounded queue with an
explicit cap, never an unbounded one.

The two channels can still desynchronize by a _bounded_ window: the side
channel (an `EventEmitter`, not itself backpressured) can be ahead of the bytes
the consumer has _drained_ by up to the in-flight processing window. So every
violation carries a byte offset to let a consumer re-sync. Generation order is
preserved within each channel.

### Two lifecycles and terminal policy

Separate the validation lifecycle (bounded by `maxErrors`, produces the verdict)
from the byte lifecycle (the echo stream). The verdict is its own signal.

Default: **`terminate` with `maxErrors: 1`** (reject on first violation, stream
destroyed, `pipeline` rejects with `ValidationFailedError`). `detach` is opt-in:
stop validating at the budget, seal the verdict on its channel, raw-copy the
tail (no parsing, no schema checks, no buffering). A parse error is always
terminal (no healthy continuation).

| `maxErrors` | Policy              | Behavior                                                  |
| ----------- | ------------------- | --------------------------------------------------------- |
| 1 (default) | terminate (default) | Reject on the first violation.                            |
| finite      | terminate           | Stop at the Nth violation, reject.                        |
| finite      | detach              | Stop validating at the Nth, seal verdict, raw-copy tail.  |
| Infinity    | (moot)              | All violations collected, all bytes flow, verdict at end. |

### Edit hooks

Two primitives, fired at a scope's close, after its verdict is known, before its
delimiter:

```ts
type ScopeContext = {
  path: JsonPath;
  kind: "object" | "array";
  verdict: "valid" | "invalid";
  memberCount: number;           // members (object) or elements (array)
};

validator.onScopeClose(at, (ctx: ScopeContext) => void): void;          // observe
validator.editClose(at, (ctx: ScopeContext) => Bytes | Readable | null): void; // edit
// at: JsonPath | ((path, kind) => boolean); root = []. null = no-op.
```

The engine holds the delimiter, runs the callback, writes the returned bytes (a
`Readable` is drained fully first), then writes the delimiter. Provide a
`field(name, value)` helper that handles the leading comma (`memberCount > 0`).

Rules:

- **Append-only, permanently.** Hooks add sibling content; they never suppress,
  rename, or transform streamed content (that would force value buffering, comma
  rewriting, and offset rebasing, breaking invariant 1). The persisted document
  is the input verbatim plus appended siblings.
- **Appended bytes are not validated.** The engine validates the input; hook
  output is spliced after the verdict and is never checked against the schema. A
  hook can therefore make the persisted output violate the very schema the input
  passed (e.g. appending a field the schema's `additionalProperties: false` or
  `maxProperties` would reject). Keeping appends schema-valid is the caller's
  responsibility.
- **Forward-decidable scopes only.** A scope whose verdict is not final at its
  own close (a `oneOf` branch, a BUFFER island, an object constrained by a later
  `dependentSchemas`) cannot host a hook. The root object is always safe.
- **Terminal-policy interaction.** Under `terminate` a root hook fires only on
  the valid path (the first violation tears down before the root close). A hook
  sees `verdict: "invalid"` only under `detach`.
- **Cross-scope state:** to append a field derived from a child scope (e.g. a
  root-level count of an inner array), `onScopeClose` the child and read it in
  the parent's `editClose`. A child always closes before its parent, so the
  observer has run. The engine does not retain arbitrary child state for lookup.
- **Byte offsets** in violations are input offsets; after a splice, output
  offset != input offset.

### Key events (opt-in observability)

A compile-time-specialized channel (the same approach as `maxErrors` /
`maxDepth`): unset, codegen is byte-identical to the no-events spine; set,
matching scopes emit `{ type: "key", path, key, byteOffset }`. The spine already
tokenizes every key, so this adds no retained engine state.

```ts
keyEvents?: boolean | { at: PathFilter };  // absent = off, byte-identical codegen
```

The filter is client-specified (not inferred), so it does not reintroduce
implicit per-scope behavior. For statically-distinct scopes it is fully static
(no emission code in unmatched scopes); filtering by runtime depth through a
recursive `$ref` needs the runtime depth counter. The channel grants
observe-and-abort (log, or keep a seen-set and destroy the stream on a repeat),
not control: it cannot choose collapse semantics or dedupe echoed bytes.

Recipe a consumer can build on it (duplicate canonicalization): compile with
`keyEvents`, keep a seen-set, and on a clean finish, if duplicates were seen and
the document is within a size you will hold, `JSON.parse` + `JSON.stringify` to
collapse last-write-wins. Gated behind valid + duplicates-present, so a
well-behaved client never pays it; re-materialization is the caller's explicit
choice.

### Cleanup

Release engine state (buffered scalars, island values, the `uniqueItems`
hash set, any in-flight delegate) on every exit path: normal completion, budget
short-circuit, fatal `error`, and consumer abort (the most leaked). Tie teardown
to `finally` / `_destroy`. The engine holds no temp files, so cleanup is
heap-only.

### Developer contract

The blessed path uses `stream.pipeline` (it propagates errors and destroys the
destination; `.pipe` does not):

```js
try {
  await pipeline(input, validator, fs.createWriteStream(tmp));
  await rename(tmp, final); // reached only on a clean finish = valid
} catch (err) {
  await unlink(tmp).catch(() => {}); // validation failed or parse error
}
```

| Signal                                     | Meaning                                                            | Action                                           |
| ------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------ |
| `data` chunks                              | Provisional bytes accepted so far; a later error can retract them. | Stage provisionally. Do not trust.               |
| `violation` (+ offset)                     | Diagnostics. Document will be invalid.                             | Log, or abort early.                             |
| clean `finish` / `pipeline` resolves       | All-clear.                                                         | Commit.                                          |
| `pipeline` rejects `ValidationFailedError` | Well-formed but failed the schema.                                 | Discard staged.                                  |
| `error` / parse-or-I/O rejection           | Unparseable or I/O failure.                                        | Discard staged.                                  |
| `verdict` (event or promise)               | Explicit final result.                                             | For `detach` consumers keeping bytes regardless. |

## Reference

### Keyword support matrix

"Decision point" = when the verdict is known; "diagnostic timing" = when a
violation fires. Eager = the offending token; scope-close = the enclosing
object/array close. Run after dialect normalization.

| Keyword                                              | Strategy                 | Decision point              | Diagnostic timing            | Notes                                                                                                                                               |
| ---------------------------------------------------- | ------------------------ | --------------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`                                               | STREAM                   | value start                 | eager                        | —                                                                                                                                                   |
| `format`                                             | STREAM                   | scalar end                  | token-close                  | reuses `@oav/formats`; buffers the scalar                                                                                                           |
| `pattern`                                            | STREAM                   | string end                  | token-close                  | buffers the scalar                                                                                                                                  |
| `maxLength`                                          | STREAM                   | over-limit char             | eager                        | streams, no buffer                                                                                                                                  |
| `minLength`                                          | STREAM                   | string end                  | token-close                  | streams, no buffer                                                                                                                                  |
| `minimum`/`maximum`/`multipleOf`                     | STREAM                   | number end                  | token-close                  | JS double; OAS3.0 boolean `exclusive*` normalized first                                                                                             |
| `maxItems` / `maxProperties`                         | STREAM                   | (max+1)th start             | eager                        | rejects over-count without reading the rest                                                                                                         |
| `minItems` / `minProperties`                         | STREAM                   | scope-close                 | scope-close                  | knowable only at close                                                                                                                              |
| `enum`/`const` (scalar)                              | STREAM                   | scalar end                  | token-close                  | bounded by literals                                                                                                                                 |
| `enum`/`const` (object/array)                        | BUFFER                   | scope-close                 | scope-close                  | exact equality via materialization                                                                                                                  |
| `properties`                                         | STREAM / BUFFER / REJECT | per-property value          | token/scope-close            | inherits each property subschema's strategy                                                                                                         |
| `required`                                           | STREAM                   | object-close                | scope-close                  | presence-only (own strategy is always STREAM)                                                                                                       |
| `propertyNames`                                      | STREAM                   | key time                    | token-close (key)            | —                                                                                                                                                   |
| `additionalProperties`                               | STREAM / BUFFER / REJECT | key time / value            | eager (`false` → reject key) | inherits the value subschema's strategy; needs fixed `properties`/`patternProperties`                                                               |
| `patternProperties`                                  | STREAM / BUFFER / REJECT | key time / value            | token-close                  | inherits the value subschema's strategy                                                                                                             |
| `dependentRequired`                                  | STREAM                   | object-close                | scope-close                  | presence-only                                                                                                                                       |
| `dependentSchemas`                                   | BUFFER                   | object-close                | scope-close                  | forward dependent subschema can avoid the hold                                                                                                      |
| `items` / `prefixItems`                              | STREAM / BUFFER / REJECT | per element                 | token/scope-close            | inherits the element subschema's strategy                                                                                                           |
| `contains`/`min`/`maxContains`                       | STREAM / BUFFER          | match counter               | eager / scope-close          | STREAM iff the contained predicate is forward; else per-item BUFFER                                                                                 |
| `uniqueItems`                                        | STREAM (hash)            | canonical hash per item     | eager on hash-match          | hash-match = equal; retains a hash per distinct item, O(array length) memory (see Resource model)                                                   |
| `allOf`                                              | TEE / BUFFER             | scope-close                 | scope-close                  | TEE when children forward                                                                                                                           |
| `anyOf`                                              | TEE / BUFFER             | first success / scope-close | scope-close                  | TEE when children forward                                                                                                                           |
| `oneOf`                                              | TEE / BUFFER             | scope-close (count)         | scope-close                  | cannot short-circuit                                                                                                                                |
| `not`                                                | TEE / BUFFER             | scope-close                 | scope-close                  | TEE when child forward                                                                                                                              |
| `if`/`then`/`else`                                   | TEE / BUFFER             | when `if` resolves          | scope-close                  | BUFFER when the branch decision trails consumed bytes                                                                                               |
| `$ref`                                               | target/SCC strategy      | explicit scope stack        | —                            | takes the joined strategy of its target's ref cycle (STREAM / BUFFER / REJECT), not always forward; STREAM recursion is bounded by `maxDepth`       |
| `$dynamicRef`                                        | STREAM                   | anchor lookup               | —                            | behaves like `$ref` + anchor (inherits OAV's limitation)                                                                                            |
| `unevaluatedProperties`/`Items`                      | REJECT                   | compile time                | —                            | clear compile error                                                                                                                                 |
| `dependencies` (draft-07 compat)                     | per entry                | —                           | —                            | array form → `dependentRequired` (STREAM); schema form → `dependentSchemas` (BUFFER)                                                                |
| `discriminator`                                      | BUFFER                   | scope-close                 | scope-close                  | implements `oneOf`/`anyOf`; v1 delegates. A streaming discriminator (select the branch once the discriminator key arrives) is a future optimization |
| `contentEncoding`/`contentMediaType`/`contentSchema` | no-op                    | —                           | —                            | annotation-only (OAV does not decode + re-validate)                                                                                                 |
| annotations (`title`, `default`, …)                  | no-op                    | —                           | —                            | not validated                                                                                                                                       |

### Duplicate keys

**This is a real parity gap, not a footnote.** It affects ordinary `properties`,
`required`, `enum`/`const`, and branch schemas, any document with a duplicated
key, not an exotic corner. Default behavior: **not detected.** There is no
policy that both matches `JSON.parse`'s last-write-wins collapse and stays on the
forward spine, and detecting duplicates in an open (arbitrary-key) scope needs
unbounded key retention. So STREAM scopes validate every occurrence; BUFFER
islands materialize last-write-wins.

Consequences (the documented exception to invariant 6): a value constraint on a
duplicated key is order-sensitive where `JSON.parse` is not (`{"a":"x","a":1}`
against `properties: {a: {type: number}}` fails streaming but passes
in-memory); and a STREAM scope and an object-`enum`/`const` island disagree on
the same bytes.

v1 default is the documented non-parity behavior above. This is safe to revisit
later: a `duplicateKeys` mode (e.g. `reject`, cheap for closed/named scopes via
the seen-key set `properties`/`required` already maintain) is a purely additive
option, and flipping the default is a verdict change confined to spec-undefined
input (RFC 8259 leaves duplicate keys unspecified), a defensible tightening, not
an API redesign. A consumer that needs canonical keys today builds it on the
key-event channel (see the recipe).

### OpenAPI dialect normalization

There is no ready-made 2020-12-shaped schema to consume. `resolveSpec()` only
inlines _external_ `$ref`s (internal and circular refs remain); and OAV's
`dialectFor(version)` is a private validator helper that returns a `Dialect`,
not a rewritten schema, OAV applies the 3.0 rules during compile, not as a
schema-rewrite pass. So the streaming engine must **build its own normalization
pass** (or consume OAV's dialect rules directly) before classification. It is a
named v1 component, not a free input.

3.1 / 3.2 are 2020-12-native and need none of this. 3.0 is the outlier; the
normalization pass must, before the classifier runs:

- widen `nullable: true` into a `type` union (`["string","null"]`);
- fold boolean `exclusiveMinimum`/`exclusiveMaximum` into the 2020-12 numeric
  form;
- apply `$ref` sibling suppression (a 3.0 `$ref` ignores its siblings).

Mirror OAV's existing dialect rules as the source of truth (the drift test
should cover dialect coverage too, not just keyword coverage). Independent of
version: body schemas may be direction-transformed (`readOnly`/`writeOnly`) by
OAV's HTTP validator; v1 validates raw schema objects and does not apply that
transform. Run `resolveSpec()`, then normalization, then classification.

### Resource model

All numeric limits default **off** (unset = zero overhead). For a
forward-decidable schema whose structural bounds cover its strings, arrays, and
nesting, a spec-matching document streams in bounded memory and needs no cap. But
a _valid_ document can still be unbounded where the schema leaves a dimension
open: an unbounded `pattern`/`format` string, an unbounded BUFFER island, or
`uniqueItems` without `maxItems`. So caps are not always unnecessary; for
untrusted input, `strict` + caps is the recommended setting (this matches the
intro). The knobs that cover the unbounded surface:

- `maxBufferedBytes`: one cap on any single internal buffer (forced-buffer scalar
  or BUFFER island). **Unit: UTF-8 source bytes** spanned by the buffered region
  (a scalar's content, or an island's subtree, both measurable from byte
  offsets). It is _not_ a JS-heap ceiling: a decoded string or materialized value
  costs more than its source bytes (UTF-16, object overhead). Source-byte
  accounting is what is implementable and consistent across scalars and islands;
  treat it as a proportional proxy for heap and size it with headroom.
- `maxDepth`: stack growth; also guards the native-stack `RangeError` an
  in-memory island delegate throws on deep nesting.
- `maxTotalBytes`: policy ("refuse oversize regardless of validity").
- `maxUniqueItems` (or fold into `maxBufferedBytes`'s accounting): `uniqueItems`
  retains a hash of every distinct item, so its memory is O(array length), not
  raw bytes and not otherwise capped. It is the one STREAM keyword that is not
  bounded-memory; `maxItems` on the array bounds it, otherwise it needs this
  accounting. The seen-hash set must count toward whatever memory ceiling is
  enforced, even though it is not a byte buffer.

For a _sound but unbounded_ schema, the response is warn-by-default +
opt-in-enforce: the classifier emits a compile-time warning for any
structurally-unbounded buffer (a `pattern`/`format` string or unbounded key with
no length bound, an unbounded island), unbounded depth, **or `uniqueItems` on an
array with no `maxItems`**; a `strict` mode turns those into compile errors or
enforced caps. Reference workload for sizing caps: body up to 2 GB, ~8.4M array
elements, 32 KB per string.

## Options

A sketch; share names with OAV's `CompileOptions` / `ValidatorOptions` where they
overlap (`maxErrors`, `maxDepth`, `formats`, `keywords`, `regexCompiler`). The
`keywords` registry is what "registered with `@oav/schema`" means: a keyword
present here is delegable (BUFFER), one absent is REJECT. Both `keywords` and
`regexCompiler` must be threaded into the BUFFER delegate's `compileSchema`
call, and `regexCompiler` also hardens the spine's own `pattern`/`format`.

```ts
interface StreamValidatorOptions {
  maxErrors?: number; // default 1
  policy?: "terminate" | "detach"; // default "terminate"
  formats?: Record<string, (s: string) => boolean>;
  keywords?: Record<string, CustomKeywordValidator>; // delegable custom keywords (matches @oav/schema)
  regexCompiler?: RegexCompiler; // e.g. RE2, for pattern/format regex hardening
  parity?: boolean; // exact OAV messages (forces oneOf/anyOf to BUFFER); default false
  keyEvents?: boolean | { at: PathFilter };
  // resource limits, all off unless set
  maxBufferedBytes?: number;
  maxDepth?: number;
  maxTotalBytes?: number;
  maxUniqueItems?: number; // cap on uniqueItems' seen-hash set (O(array length))
  strict?: boolean; // unbounded-* warnings become compile errors
}
```

## OAV reuse and required changes

| OAV piece        | Reuse  | Notes                                                                                                                                                                                                        |
| ---------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@oav/formats`   | High   | `(s) => boolean`; drops into scalar validation.                                                                                                                                                              |
| `@oav/core`      | High   | Flat error shapes / codes for `violation`. Tree assembler unused.                                                                                                                                            |
| `@oav/schema`    | Medium | BUFFER-island sub-validator (`compileSchema(...).validate(value, startPath)`); public `walkSubschemas` supplies local subschema positions for the classifier, which walks the schema/ref graph on top of it. |
| `@oav/spec`      | Medium | `resolveSpec()` to load and inline external `$ref`s before classification.                                                                                                                                   |
| `@oav/validator` | Low    | HTTP orchestration is replaced; `bodySchemaFor` extraction worth borrowing for the post-v1 HTTP adapter.                                                                                                     |
| `@oav/router`    | None   | —                                                                                                                                                                                                            |

Required additive changes to `@oav/schema` (no behavior change, tracked as
#405): export the registered keyword **definitions** (name → `KeywordDefinition`
with its `applicator` / `annotation` / `evaluates` / `implements` flags, not just
the names), and promote `schemaUsesUnevaluated` to public. The classification
table lives in `stream-validator`, so `@oav/schema` carries no reverse dependency
and the graph stays acyclic.

## Packaging and versioning

New top-level package in the monorepo, sibling to `@oav/validator`, same
leaf-ward deps, no cycle. Same-repo because the classifier's correctness is
coupled to `@oav/schema`'s keyword set (which evolves), and the drift test makes
co-evolution a build failure rather than silent breakage. Lockstep versioning (no
changesets). Maturity by publication gate: `private` (incubation, unpublished,
in-repo via `workspace:*`) → `experimental` dist-tag (installable only via
`@experimental`) → public `latest`. Revisit independent versioning only if the
engine becomes a source of breaking changes orthogonal to core.

When HTTP integration lands (post-v1) it is a paired `validateRequestStream`
adapter (hands the handler a validated stream plus a verdict), not a mode of
`validateRequests`: the streaming consumption contract cannot satisfy gate
semantics (no clean rejection after the first byte is forwarded). Wiring recipes
belong in the package README.

## Dependencies and related work

- **#405** (keyword-introspection export): the **only** required `@oav/schema`
  change, the registered keyword definitions + flags and a public
  `schemaUsesUnevaluated`. Build step 1 depends on it.
- **#349** (codegen keyword-authoring surface vs. semver line): **not** a
  prerequisite. This engine _reads_ keyword metadata (the #405 slice); it never
  _authors_ codegen keywords, so #349's codegen-tier decision is independent.
- **#258** (bound `readBody` memory + body-stream forwarding): the buffered-world
  sibling. The future `validateRequestStream` adapter should share #258's
  `maxBytes` / `forwardStrategy` (`buffer` | `tee`) surface so the two stay
  consistent. Complementary, not blocking.
- **#398** (OAS 3.2 `itemSchema` for sequential / streaming media types): a
  likely future _consumer_ of this engine. Not blocking.
- **#216** (CLI AOT `--regex-compiler-import`): orthogonal. The runtime
  `regexCompiler` option this engine uses already exists on `CompileOptions`.

## Testing

Lean on existing corpuses; do not hand-author the bulk of cases.

- **Oracle: OAV's in-memory engine.** For any `(schema, document)` whose schema
  is in the supported subset, the streaming verdict must equal the in-memory
  verdict, modulo the two documented divergences (duplicate-key order-sensitivity
  and the `uniqueItems` canonical-hash). This makes correctness a _differential_
  property: stream-validate and in-memory-validate the same inputs, assert equal.
  Fuzz both schemas and documents against this property.
- **Validator/classifier: the JSON Schema Test Suite**, already vendored in
  OAV's `conformance/` harness. Run its `(schema, instance, expected)` triples
  through the streamer; assert the verdict matches both `expected` and OAV
  in-memory. Cases whose schema uses a REJECT'd keyword (`unevaluated*`) must
  _compile-fail_, assert the fast-fail fires (that is itself coverage).
- **Tokenizer: a JSON parser-conformance corpus** (e.g. the `y_`/`n_`/`i_` cases
  of a standard JSON test suite) for well-formedness and `JSON.parse` parity. The
  dimension static corpuses do not cover is chunk boundaries: a harness that
  replays each corpus document split at every byte offset (and specifically at
  multibyte-UTF-8, escape, and surrogate boundaries) is what catches
  split-across-chunks bugs. This is the tokenizer's own fuzz/property suite.
- **Drift test** (classifier vs `@oav/schema`'s keyword list), as specified.
- **Lifecycle/contract tests**: the four cleanup exit paths; terminate vs detach;
  the `pipeline` resolve/reject contract; edit-hook firing rules.

## Build sequence

Each step is testable on its own.

1. **`@oav/schema` additive exports** (registered keyword definitions + flags,
   public `schemaUsesUnevaluated`; #405). Unblocks the classifier and drift test.
2. **Tokenizer** + event contract (strings chunk; keys/numbers whole; match
   `JSON.parse`). Test with a JSON parser-conformance corpus replayed across
   every chunk boundary (see "Testing"). Standalone.
3. **Classifier** over the schema/ref graph (using `walkSubschemas` for local
   subschema positions) + the keyword list; the SCC ref-cycle fixpoint; the
   drift test; the compile-time fast-fail and unbounded warnings. Emits a
   per-node strategy map.
4. **Spine**: forward state machines + scope stack for the STREAM set, driven by
   the tokenizer. Verdict only, no echo yet. Stand up the differential harness
   here (JSON Schema Test Suite + verdict-equivalence vs OAV in-memory).
5. **Channels**: `violation` / `error` / `verdict` (event + promise),
   `ValidationFailedError`, byte offsets.
6. **Terminal policy** (terminate default) + two lifecycles + cleanup.
7. **Echo-through** output as a `Transform`; the `pipeline` contract.
8. **BUFFER islands**: incremental in-heap materialization + delegation to
   `compileSchema(...).validate(value, startPath)`, bounded by `maxBufferedBytes`.
9. **TEE** for forward `allOf` / `not` / `anyOf` / `oneOf`.
10. **Edit hooks** (`onScopeClose` / `editClose`), then **key events**
    (compile-time gated).
11. **OpenAPI entry** (any OAV-supported version): `resolveSpec()` + dialect
    normalization feeding the classifier.
