import { describe, expect, it } from "vitest";
import { createBranchError, createLeafError, formatError, isOutputFormat } from "../src/index.js";

const sample = createBranchError("request", [], "request validation failed", [
  createLeafError("type", ["body", "age"], "must be number", { expected: "number" }),
]);

describe("formatError", () => {
  it("renders as indented text", () => {
    const out = formatError(sample, "text");
    expect(out).toContain("[request]");
    expect(out).toContain("body.age");
  });

  it("renders as JSON that round-trips", () => {
    const out = formatError(sample, "json");
    expect(JSON.parse(out).code).toBe("request");
  });

  it("renders as flat one-line-per-leaf", () => {
    expect(formatError(sample, "flat").split("\n")).toHaveLength(1);
  });

  it("respects depth truncation in text mode", () => {
    const out = formatError(sample, "text", 0);
    expect(out.split("\n").length).toBeLessThan(3);
  });

  it("accepts a custom renderer function", () => {
    const out = formatError(sample, (err) => `custom:${err.code}:${err.children.length}`);
    expect(out).toBe("custom:request:1");
  });
});

describe("isOutputFormat", () => {
  it("narrows valid names", () => {
    expect(isOutputFormat("text")).toBe(true);
    expect(isOutputFormat("json")).toBe(true);
    expect(isOutputFormat("flat")).toBe(true);
  });

  it("rejects unknown names", () => {
    expect(isOutputFormat("github")).toBe(false);
    expect(isOutputFormat("xml")).toBe(false);
    expect(isOutputFormat("")).toBe(false);
  });
});
