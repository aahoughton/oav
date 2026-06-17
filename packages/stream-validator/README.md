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
