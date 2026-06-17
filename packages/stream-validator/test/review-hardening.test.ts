import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { describe, expect, it } from "vitest";
import type { RegexCompiler, SchemaOrBoolean } from "@oav/core";
import { compileSchema, jsonSchemaDialect, openapi31Dialect } from "@oav/schema";
import {
  createStreamValidator,
  type StreamValidatorOptions,
  type StreamVerdict,
} from "../src/index.js";

const enc = new TextEncoder();

function source(text: string, chunkSize = 4): Readable {
  const bytes = enc.encode(text);
  const chunks: Buffer[] = [];
  for (let i = 0; i < bytes.length; i += chunkSize) {
    chunks.push(Buffer.from(bytes.subarray(i, Math.min(i + chunkSize, bytes.length))));
  }
  return Readable.from(chunks);
}

/** Run the engine to completion (detach + unbounded) and return the verdict. */
async function verdictOf(
  schema: SchemaOrBoolean,
  value: unknown,
  opts: StreamValidatorOptions = {},
): Promise<StreamVerdict> {
  const validator = createStreamValidator(schema, {
    policy: "detach",
    maxErrors: Number.POSITIVE_INFINITY,
    ...opts,
  });
  validator.on("error", () => {});
  validator.resume();
  const result = validator.result;
  validator.end(Buffer.from(enc.encode(JSON.stringify(value))));
  return result;
}

describe("B1: propertyNames beyond type/length/pattern (delegated)", () => {
  const cases: Array<{ schema: SchemaOrBoolean; value: unknown }> = [
    { schema: { type: "object", propertyNames: { const: "a" } }, value: { a: 1 } },
    { schema: { type: "object", propertyNames: { const: "a" } }, value: { c: 1 } },
    { schema: { type: "object", propertyNames: { enum: ["a", "b"] } }, value: { a: 1, b: 2 } },
    { schema: { type: "object", propertyNames: { enum: ["a", "b"] } }, value: { a: 1, x: 2 } },
  ];
  for (const { schema, value } of cases) {
    it(`${JSON.stringify(schema)} vs ${JSON.stringify(value)} matches in-memory`, async () => {
      const streamed = (await verdictOf(schema, value)).valid;
      const inMem = compileSchema(schema as never, {
        dialect: jsonSchemaDialect,
        maxErrors: Number.POSITIVE_INFINITY,
      }).validate(value).valid;
      expect(streamed).toBe(inMem);
    });
  }
});

describe("B2: format asserts under an OpenAPI dialect", () => {
  const schema: SchemaOrBoolean = { type: "string", format: "email" };
  for (const value of ["a@b.co", "not-an-email"]) {
    it(`format email "${value}" matches in-memory under openapi3.1`, async () => {
      const streamed = (await verdictOf(schema, value, { dialect: openapi31Dialect })).valid;
      const inMem = compileSchema(schema as never, {
        dialect: openapi31Dialect,
        maxErrors: Number.POSITIVE_INFINITY,
      }).validate(value).valid;
      expect(streamed).toBe(inMem);
    });
  }
});

describe("B3: forced-buffer scalar is capped by maxBufferedBytes", () => {
  it("fails fatally when a pattern scalar exceeds the cap", async () => {
    const validator = createStreamValidator(
      { type: "string", pattern: "^a*$" },
      { maxBufferedBytes: 8 },
    );
    validator.on("error", () => {});
    validator.resume();
    const guard = validator.result.catch((e) => e as Error);
    const big = `"${"a".repeat(200)}"`;
    await expect(
      pipeline(source(big, 16), validator, new Writable({ write: (_c, _e, cb) => cb() })),
    ).rejects.toThrow(/maxBufferedBytes/);
    expect((await guard).message).toMatch(/maxBufferedBytes/);
  });
});

describe("B4: regexCompiler hardens the spine's own pattern check", () => {
  it("routes pattern through the supplied compiler", async () => {
    let called = 0;
    const compiler: RegexCompiler = (pattern) => {
      called += 1;
      void pattern;
      return { test: () => false }; // force every pattern to fail
    };
    // "a" matches /^a$/ natively, but the compiler vetoes it.
    const verdict = await verdictOf({ type: "string", pattern: "^a$" }, "a", {
      regexCompiler: compiler,
    });
    expect(called).toBeGreaterThan(0);
    expect(verdict.valid).toBe(false);
  });
});

describe("S1: maxTotalBytes / maxDepth", () => {
  it("rejects input larger than maxTotalBytes", async () => {
    const validator = createStreamValidator(true, { maxTotalBytes: 4 });
    validator.on("error", () => {});
    validator.resume();
    const guard = validator.result.catch((e) => e as Error);
    await expect(
      pipeline(source('"abcdefghij"', 3), validator, new Writable({ write: (_c, _e, cb) => cb() })),
    ).rejects.toThrow(/maxTotalBytes/);
    expect((await guard).message).toMatch(/maxTotalBytes/);
  });

  it("reports a depth violation past maxDepth instead of growing unbounded", async () => {
    const schema: SchemaOrBoolean = { type: "object", properties: { next: { $ref: "#" } } };
    const depth = 12;
    const json = `${'{"next":'.repeat(depth)}{}${"}".repeat(depth)}`;
    const validator = createStreamValidator(schema, {
      policy: "detach",
      maxErrors: Number.POSITIVE_INFINITY,
      maxDepth: 5,
    });
    validator.on("error", () => {});
    validator.resume();
    const result = validator.result;
    validator.end(Buffer.from(enc.encode(json)));
    const verdict = await result;
    expect(verdict.valid).toBe(false);
    expect(verdict.violations.some((v) => v.code === "depth")).toBe(true);
  });
});

describe("S4: destroy settles the result promise", () => {
  it("rejects result on abort before completion", async () => {
    const validator = createStreamValidator({ type: "object" });
    validator.on("error", () => {});
    const guard = validator.result.catch((e) => e as Error);
    validator.destroy(new Error("aborted"));
    expect((await guard).message).toBe("aborted");
  });
});
