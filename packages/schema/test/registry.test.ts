import { describe, expect, it } from "vitest";
import { SchemaRegistry } from "../src/resolve/registry.js";

describe("SchemaRegistry", () => {
  it("stores and retrieves schemas by URI", () => {
    const reg = new SchemaRegistry();
    const schema = { type: "object" };
    reg.add("https://example.com/Pet", schema);
    expect(reg.get("https://example.com/Pet")).toBe(schema);
    expect(reg.has("https://example.com/Pet")).toBe(true);
  });

  it("returns undefined for unknown URIs", () => {
    const reg = new SchemaRegistry();
    expect(reg.get("nope")).toBeUndefined();
    expect(reg.has("nope")).toBe(false);
  });

  it("throws on duplicate registration (caller must remove first)", () => {
    const reg = new SchemaRegistry();
    reg.add("uri", true);
    expect(() => reg.add("uri", false)).toThrow(/already registered/);
  });

  it("removes an entry and reports whether it was present", () => {
    const reg = new SchemaRegistry();
    reg.add("uri", true);
    expect(reg.remove("uri")).toBe(true);
    expect(reg.remove("uri")).toBe(false);
  });

  it("accepts boolean schemas (true and false)", () => {
    const reg = new SchemaRegistry();
    reg.add("true", true);
    reg.add("false", false);
    expect(reg.get("true")).toBe(true);
    expect(reg.get("false")).toBe(false);
  });

  it("reports size and clears", () => {
    const reg = new SchemaRegistry();
    reg.add("a", true);
    reg.add("b", false);
    expect(reg.size).toBe(2);
    reg.clear();
    expect(reg.size).toBe(0);
  });
});
