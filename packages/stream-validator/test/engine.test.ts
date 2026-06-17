import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { describe, expect, it } from "vitest";
import type { SchemaOrBoolean } from "@oav/core";
import {
  createStreamValidator,
  type StreamValidator,
  ValidationFailedError,
} from "../src/index.js";
import { JsonParseError } from "../src/tokenizer/index.js";

const enc = new TextEncoder();

function chunkedSource(text: string, chunkSize: number): Readable {
  const bytes = enc.encode(text);
  const chunks: Buffer[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    chunks.push(Buffer.from(bytes.subarray(i, Math.min(i + chunkSize, bytes.length))));
  }
  return Readable.from(chunks);
}

function collector(): { sink: Writable; bytes: () => Buffer } {
  const out: Buffer[] = [];
  const sink = new Writable({
    write(chunk: Buffer, _enc, cb) {
      out.push(Buffer.from(chunk));
      cb();
    },
  });
  return { sink, bytes: () => Buffer.concat(out) };
}

async function runValid(
  schema: SchemaOrBoolean,
  text: string,
  chunkSize = 4,
): Promise<{ echoed: Buffer; validator: StreamValidator }> {
  const validator = createStreamValidator(schema);
  const { sink, bytes } = collector();
  await pipeline(chunkedSource(text, chunkSize), validator, sink);
  return { echoed: bytes(), validator };
}

describe("createStreamValidator: byte-exact echo", () => {
  it("echoes the input verbatim for valid data, across chunk boundaries", async () => {
    const schema: SchemaOrBoolean = {
      type: "object",
      properties: { name: { type: "string" }, tags: { type: "array", items: { type: "string" } } },
      required: ["name"],
    };
    const text = '{"name":"héllo","tags":["a","b"],"x":42}';
    for (const chunkSize of [1, 3, 7, 1000]) {
      const validator = createStreamValidator(schema);
      const { sink, bytes } = collector();
      await pipeline(chunkedSource(text, chunkSize), validator, sink);
      expect(bytes().toString("utf8")).toBe(text);
      await expect(validator.result).resolves.toMatchObject({ valid: true });
    }
  });

  it("emits a verdict event and resolves the result for valid data", async () => {
    const { validator } = await runValid({ type: "integer" }, "42");
    const verdict = await validator.result;
    expect(verdict.valid).toBe(true);
  });
});

describe("createStreamValidator: terminate policy (default)", () => {
  it("rejects the pipeline with ValidationFailedError on a violation", async () => {
    const validator = createStreamValidator({
      type: "object",
      properties: { n: { type: "integer" } },
    });
    const violations: unknown[] = [];
    validator.on("violation", (v) => violations.push(v));
    const { sink } = collector();
    await expect(
      pipeline(chunkedSource('{"n":"notint"}', 4), validator, sink),
    ).rejects.toBeInstanceOf(ValidationFailedError);
    const verdict = await validator.result;
    expect(verdict.valid).toBe(false);
    expect(violations).toHaveLength(1);
    expect((violations[0] as { byteOffset: number }).byteOffset).toBeGreaterThan(0);
  });
});

describe("createStreamValidator: detach policy", () => {
  it("finishes cleanly, echoes all bytes, and reports an invalid verdict", async () => {
    const validator = createStreamValidator(
      { type: "array", items: { type: "integer" } },
      { policy: "detach", maxErrors: Number.POSITIVE_INFINITY },
    );
    const violations: unknown[] = [];
    validator.on("violation", (v) => violations.push(v));
    const text = '[1,"two",3,"four"]';
    const { sink, bytes } = collector();
    await pipeline(chunkedSource(text, 2), validator, sink);
    expect(bytes().toString("utf8")).toBe(text);
    const verdict = await validator.result;
    expect(verdict.valid).toBe(false);
    expect(violations.length).toBeGreaterThanOrEqual(2);
  });
});

describe("createStreamValidator: parse errors are fatal", () => {
  it("rejects the pipeline and the result with JsonParseError", async () => {
    const validator = createStreamValidator(true);
    const { sink } = collector();
    const resultGuard = validator.result.catch((e) => e);
    await expect(pipeline(chunkedSource("{bad json", 3), validator, sink)).rejects.toBeInstanceOf(
      JsonParseError,
    );
    expect(await resultGuard).toBeInstanceOf(JsonParseError);
  });
});

describe("createStreamValidator: compile-time fast-fail", () => {
  it("throws at construction for a schema needing TEE/BUFFER", () => {
    expect(() => createStreamValidator({ allOf: [{ type: "string" }] })).toThrow();
    expect(() =>
      createStreamValidator({ oneOf: [{ const: { a: 1 } }, { const: { b: 2 } }] }),
    ).toThrow();
  });

  it("throws at construction for an unknown / unstreamable keyword", () => {
    expect(() => createStreamValidator({ type: "object", unevaluatedProperties: false })).toThrow();
    expect(() => createStreamValidator({ frobnicate: true } as SchemaOrBoolean)).toThrow();
  });
});
