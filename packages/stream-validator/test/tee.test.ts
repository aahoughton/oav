import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { describe, expect, it } from "vitest";
import type { SchemaOrBoolean } from "@oav/core";
import { createStreamValidator } from "../src/index.js";

const enc = new TextEncoder();

function collector(): { sink: Writable; bytes: () => Buffer } {
  const out: Buffer[] = [];
  const sink = new Writable({
    write(c: Buffer, _e, cb) {
      out.push(Buffer.from(c));
      cb();
    },
  });
  return { sink, bytes: () => Buffer.concat(out) };
}

describe("TEE streams forward composition (no materialization)", () => {
  it("validates a large composition body under a tiny maxBufferedBytes", async () => {
    // A BUFFER island would exceed maxBufferedBytes: 4; TEE fans the
    // events to per-branch sub-spines and never materializes, so the cap
    // is not tripped.
    const schema: SchemaOrBoolean = { oneOf: [{ type: "object" }, { type: "array" }] };
    const big = `{${Array.from({ length: 200 }, (_, i) => `"k${i}":${i}`).join(",")}}`;
    const validator = createStreamValidator(schema, {
      maxBufferedBytes: 4,
      policy: "detach",
      maxErrors: Number.POSITIVE_INFINITY,
    });
    validator.on("error", () => {});
    const { sink, bytes } = collector();
    await pipeline(Readable.from([Buffer.from(enc.encode(big))]), validator, sink);
    expect(bytes().toString("utf8")).toBe(big); // byte-exact echo
    await expect(validator.result).resolves.toMatchObject({ valid: true });
  });

  it("echoes a composition body verbatim across chunk boundaries", async () => {
    const schema: SchemaOrBoolean = {
      type: "object",
      properties: {
        kind: { oneOf: [{ const: "a" }, { const: "b" }] },
        n: { anyOf: [{ type: "integer" }] },
      },
    };
    const text = '{"kind":"a","n":5}';
    const chunks = enc.encode(text);
    const validator = createStreamValidator(schema);
    const { sink, bytes } = collector();
    await pipeline(
      Readable.from(
        Array.from({ length: chunks.length }, (_, i) => Buffer.from([chunks[i] as number])),
      ),
      validator,
      sink,
    );
    expect(bytes().toString("utf8")).toBe(text);
    await expect(validator.result).resolves.toMatchObject({ valid: true });
  });

  it("oneOf enforces exactly-one across a deep value", async () => {
    const schema: SchemaOrBoolean = {
      oneOf: [
        { type: "object", required: ["a"] },
        { type: "object", required: ["b"] },
      ],
    };
    const verdict = async (json: string): Promise<boolean> => {
      const v = createStreamValidator(schema, {
        policy: "detach",
        maxErrors: Number.POSITIVE_INFINITY,
      });
      v.on("error", () => {});
      v.resume();
      const r = v.result;
      v.end(Buffer.from(enc.encode(json)));
      return (await r).valid;
    };
    expect(await verdict('{"a":1}')).toBe(true); // one branch
    expect(await verdict('{"a":1,"b":2}')).toBe(false); // both branches
    expect(await verdict('{"c":3}')).toBe(false); // neither
  });
});
