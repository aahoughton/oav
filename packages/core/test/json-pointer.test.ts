import { describe, expect, it } from "vitest";
import { resolveJsonPointer } from "../src/json-pointer.js";

describe("resolveJsonPointer", () => {
  const doc = {
    a: { b: "value" },
    "slashed/key": "x",
    "tilde~y": "y",
    "50%": "percent",
    paths: { "/v2/apps/{app_id}": { get: { parameters: [{ name: "id" }] } } },
    list: ["zero", "one", "two"],
  };

  it("returns root for empty or `/` pointers", () => {
    expect(resolveJsonPointer(doc, "")).toBe(doc);
    expect(resolveJsonPointer(doc, "/")).toBe(doc);
  });

  it("walks property chains", () => {
    expect(resolveJsonPointer(doc, "/a/b")).toBe("value");
  });

  it("decodes ~1 to '/' and ~0 to '~' (RFC 6901 §4)", () => {
    expect(resolveJsonPointer(doc, "/slashed~1key")).toBe("x");
    expect(resolveJsonPointer(doc, "/tilde~0y")).toBe("y");
  });

  it("percent-decodes escapes before ~-decoding (RFC 6901 §6)", () => {
    // /paths/~1v2~1apps~1%7Bapp_id%7D/get/parameters/0
    expect(resolveJsonPointer(doc, "/paths/~1v2~1apps~1%7Bapp_id%7D/get/parameters/0")).toEqual({
      name: "id",
    });
  });

  it("preserves stray `%` that isn't a valid %XX escape", () => {
    expect(resolveJsonPointer(doc, "/50%")).toBe("percent");
  });

  it("indexes arrays by integer position", () => {
    expect(resolveJsonPointer(doc, "/list/1")).toBe("one");
  });

  it("throws when the path walks into a primitive", () => {
    expect(() => resolveJsonPointer(doc, "/a/b/c")).toThrow(/traverses a primitive/);
  });

  it("throws when the target is missing", () => {
    expect(() => resolveJsonPointer(doc, "/a/missing")).toThrow(/not found/);
  });

  it("rejects non-empty pointers that don't start with `/`", () => {
    expect(() => resolveJsonPointer(doc, "a/b")).toThrow(/invalid JSON pointer/);
  });
});
