import { describe, expect, it } from "vitest";
import { composeReaders, createMemoryReader } from "../src/reader.js";

describe("memory reader", () => {
  it("returns parsed JSON when given a string source", async () => {
    const r = createMemoryReader(new Map([["x.json", '{"a":1}']]));
    expect(await r.read("x.json")).toEqual({ a: 1 });
  });

  it("returns parsed YAML for .yaml suffix", async () => {
    const r = createMemoryReader(new Map([["x.yaml", "a: 1\nb:\n  - 2"]]));
    expect(await r.read("x.yaml")).toEqual({ a: 1, b: [2] });
  });

  it("returns prepared values verbatim", async () => {
    const value = { pre: "parsed" };
    const r = createMemoryReader(new Map<string, unknown>([["x", value]]));
    expect(await r.read("x")).toBe(value);
  });

  it("reports canRead() truthfully", () => {
    const r = createMemoryReader(new Map([["x", "y"]]));
    expect(r.canRead("x")).toBe(true);
    expect(r.canRead("nope")).toBe(false);
  });
});

describe("composeReaders", () => {
  it("tries each reader until one claims the URI", async () => {
    const a = createMemoryReader(new Map([["a.json", '{"from":"a"}']]));
    const b = createMemoryReader(new Map([["b.json", '{"from":"b"}']]));
    const composed = composeReaders([a, b]);
    expect(await composed.read("a.json")).toEqual({ from: "a" });
    expect(await composed.read("b.json")).toEqual({ from: "b" });
  });

  it("throws when no reader accepts", async () => {
    const composed = composeReaders([createMemoryReader(new Map())]);
    await expect(composed.read("nope")).rejects.toThrow(/no reader/);
  });
});
