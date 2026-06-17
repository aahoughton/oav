import { describe, expect, it } from "vitest";
import type { SchemaOrBoolean } from "@oav/core";
import { createStreamValidator, type StreamValidatorOptions } from "../src/index.js";

const enc = new TextEncoder();

describe("warn surfaces classifier warnings (matches @oav/validator)", () => {
  it("calls warn for an unbounded pattern string", () => {
    const messages: string[] = [];
    // A single options type (StreamValidatorOptions) carries dialect /
    // openApiVersion / warn, matching @oav/validator's ValidatorOptions.
    const opts: StreamValidatorOptions = { warn: (m) => messages.push(m) };
    createStreamValidator({ type: "string", pattern: "^a+$" } as SchemaOrBoolean, opts);
    expect(messages.some((m) => /maxLength|unbounded/.test(m))).toBe(true);
  });

  it("does not call warn for a bounded schema", () => {
    let warned = false;
    createStreamValidator({ type: "string", pattern: "^a$", maxLength: 8 } as SchemaOrBoolean, {
      warn: () => (warned = true),
    });
    expect(warned).toBe(false);
  });

  it("openApiVersion + warn coexist on the one options type", async () => {
    const validator = createStreamValidator({ type: "string", nullable: true } as SchemaOrBoolean, {
      openApiVersion: "3.0",
      policy: "detach",
      maxErrors: Number.POSITIVE_INFINITY,
    });
    validator.on("error", () => {});
    validator.resume();
    const result = validator.result;
    validator.end(Buffer.from(enc.encode("null")));
    await expect(result).resolves.toMatchObject({ valid: true }); // nullable widened
  });
});

// Run one document, collecting the verdict under detach policy (no throw).
async function validate(schema: SchemaOrBoolean, body: string) {
  const validator = createStreamValidator(schema, {
    policy: "detach",
    maxErrors: Number.POSITIVE_INFINITY,
  });
  validator.on("error", () => {});
  validator.resume();
  const result = validator.result;
  validator.end(Buffer.from(enc.encode(body)));
  return result;
}

describe("SchemaViolation field shape", () => {
  it("STREAM-path leaf violation carries code/path/byteOffset, no message", async () => {
    const verdict = await validate({ type: "integer", minimum: 5 } as SchemaOrBoolean, "3");
    expect(verdict.valid).toBe(false);
    const [v] = verdict.violations;
    expect(v?.code).toBe("minimum");
    expect(typeof v?.byteOffset).toBe("number");
    expect(v?.message).toBeUndefined();
  });

  it("BUFFER-island violation preserves the in-memory engine's message/params", async () => {
    const verdict = await validate(
      { type: "array", uniqueItems: true } as SchemaOrBoolean,
      "[1,1]",
    );
    expect(verdict.valid).toBe(false);
    const [v] = verdict.violations;
    expect(v?.code).toBe("uniqueItems");
    expect(v?.message).toBe("must have unique items");
    expect(typeof v?.byteOffset).toBe("number");
    expect(Array.isArray(v?.children)).toBe(true);
  });
});
