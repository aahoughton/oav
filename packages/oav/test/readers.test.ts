import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { composeReaders, createFileReader, resolveSpec } from "@oav/spec";
import { createYamlFileReader, createYamlHttpReader, parseYamlString } from "../src/index.js";

describe("createYamlFileReader", () => {
  let dir: string;

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), "oav-loaders-"));
    writeFileSync(join(dir, "plain.yaml"), "a: 1\nb:\n  - 2");
    writeFileSync(join(dir, "has space.yaml"), "x: 1");
    writeFileSync(join(dir, "has+plus.yml"), "x: 2");
  });

  afterAll(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("claims only yaml extensions", () => {
    const r = createYamlFileReader(dir);
    expect(r.canRead("x.yaml")).toBe(true);
    expect(r.canRead("x.yml")).toBe(true);
    expect(r.canRead("x.json")).toBe(false);
    expect(r.canRead("http://example.com/x.yaml")).toBe(false);
  });

  it("reads .yaml and .yml files", async () => {
    const r = createYamlFileReader(dir);
    expect(await r.read("plain.yaml")).toEqual({ a: 1, b: [2] });
    expect(await r.read("has+plus.yml")).toEqual({ x: 2 });
  });

  it("decodes percent-escaped spaces and `+` in paths (#37)", async () => {
    const r = createYamlFileReader(dir);
    expect(await r.read("has%20space.yaml")).toEqual({ x: 1 });
    expect(await r.read("has%2Bplus.yml")).toEqual({ x: 2 });
  });

  it("accepts file:// URIs", async () => {
    const r = createYamlFileReader(dir);
    expect(await r.read("file://plain.yaml")).toEqual({ a: 1, b: [2] });
  });
});

describe("createYamlHttpReader", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("claims only http(s) URIs with a yaml extension", () => {
    const r = createYamlHttpReader();
    expect(r.canRead("https://example.com/spec.yaml")).toBe(true);
    expect(r.canRead("http://example.com/spec.yml")).toBe(true);
    expect(r.canRead("https://example.com/spec.json")).toBe(false);
    expect(r.canRead("file:///x.yaml")).toBe(false);
  });

  it("fetches and parses .yaml responses", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("openapi: 3.1.0\ninfo: { title: X, version: '1' }", { status: 200 }),
      ),
    );
    const r = createYamlHttpReader();
    expect(await r.read("https://example.com/spec.yaml")).toEqual({
      openapi: "3.1.0",
      info: { title: "X", version: "1" },
    });
  });

  it("throws when the response is non-ok, including the status", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 404 })),
    );
    const r = createYamlHttpReader();
    await expect(r.read("https://example.com/missing.yaml")).rejects.toThrow(/HTTP 404 fetching/);
  });
});

describe("composed with the main-package JSON readers", () => {
  it("resolveSpec works against a YAML-fronted compose chain", async () => {
    const { readFile: readFileSync, writeFile: writeFileSync2 } = await import("node:fs/promises");
    const d = mkdtempSync(join(tmpdir(), "oav-loaders-compose-"));
    try {
      await writeFileSync2(
        join(d, "main.yaml"),
        "openapi: 3.1.0\ninfo:\n  title: X\n  version: '1'\npaths:\n  /x: { get: { responses: { '200': { description: ok } } } }",
      );
      const reader = composeReaders([createYamlFileReader(d), createFileReader(d)]);
      const { document } = await resolveSpec({ reader, entry: "main.yaml" });
      expect(document.info.title).toBe("X");
      // sanity: readFileSync import used above as part of the setup chain
      void readFileSync;
    } finally {
      rmSync(d, { recursive: true, force: true });
    }
  });
});

describe("parseYamlString", () => {
  it("parses a YAML source to a JSON-compatible value", () => {
    expect(parseYamlString("a: 1\nb: [2, 3]")).toEqual({ a: 1, b: [2, 3] });
    expect(parseYamlString("42")).toBe(42);
  });
});
