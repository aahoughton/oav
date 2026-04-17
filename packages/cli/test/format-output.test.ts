import { describe, expect, it } from "vitest";
import { createBranchError, createLeafError } from "@oav/core";
import { formatError } from "../src/format-output.js";

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

  it("renders as GitHub Actions annotations", () => {
    expect(formatError(sample, "github")).toContain("::error title=body.age::");
  });

  it("respects depth truncation in text mode", () => {
    const out = formatError(sample, "text", 0);
    expect(out.split("\n").length).toBeLessThan(3);
  });
});
