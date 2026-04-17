import { describe, expect, it } from "vitest";
import type { OpenAPIDocument } from "@oav/core";
import { applyOverlays } from "../src/overlay.js";

function base(): OpenAPIDocument {
  return {
    openapi: "3.1.0",
    info: { title: "X", version: "1" },
    paths: {
      "/pets": {
        get: {
          parameters: [{ name: "limit", in: "query", schema: { type: "integer" } }],
          responses: { "200": { description: "ok" } },
        },
        post: {
          requestBody: { content: { "application/json": { schema: { type: "object" } } } },
          responses: { "201": { description: "created" } },
        },
      },
    },
    components: {
      schemas: {
        Pet: { type: "object", properties: { name: { type: "string" } } },
      },
    },
  };
}

describe("applyOverlays", () => {
  it("addPaths inserts new paths and rejects conflicts", () => {
    const patched = applyOverlays(base(), [
      {
        addPaths: {
          "/vets": { get: { responses: { "200": { description: "ok" } } } },
        },
      },
    ]);
    expect(patched.paths?.["/vets"]).toBeDefined();
    expect(() =>
      applyOverlays(base(), [
        { addPaths: { "/pets": { get: { responses: { "200": { description: "dup" } } } } } },
      ]),
    ).toThrow(/already exists/);
  });

  it("overrides.addParameters appends, replacing same (name,in) pairs", () => {
    const patched = applyOverlays(base(), [
      {
        overrides: {
          "/pets": {
            operations: {
              get: {
                addParameters: [
                  { name: "limit", in: "query", schema: { type: "string" } },
                  { name: "X-Tenant", in: "header", schema: { type: "string" } },
                ],
              },
            },
          },
        },
      },
    ]);
    const params = patched.paths?.["/pets"]?.get?.parameters ?? [];
    expect(params).toHaveLength(2);
    const byKey = Object.fromEntries(params.map((p) => [`${p.in}:${p.name}`, p]));
    expect(byKey["query:limit"]?.schema).toEqual({ type: "string" });
    expect(byKey["header:X-Tenant"]).toBeDefined();
  });

  it("overrides with wildcard `*` path applies to every path", () => {
    const patched = applyOverlays(base(), [
      {
        overrides: {
          "*": {
            operations: {
              get: { addParameters: [{ name: "trace", in: "header", schema: { type: "string" } }] },
            },
          },
        },
      },
    ]);
    const params = patched.paths?.["/pets"]?.get?.parameters ?? [];
    expect(params.some((p) => p.name === "trace")).toBe(true);
  });

  it("extendSchemas wraps the existing schema in allOf", () => {
    const patched = applyOverlays(base(), [{ extendSchemas: { Pet: { required: ["name"] } } }]);
    const pet = patched.components?.schemas?.["Pet"];
    expect(pet).toMatchObject({ allOf: expect.any(Array) });
  });

  it("replaceSchemas fully replaces the entry", () => {
    const patched = applyOverlays(base(), [{ replaceSchemas: { Pet: { type: "string" } } }]);
    expect(patched.components?.schemas?.["Pet"]).toEqual({ type: "string" });
  });

  it("overlays apply in order: later wins", () => {
    const patched = applyOverlays(base(), [
      { replaceSchemas: { Pet: { type: "number" } } },
      { replaceSchemas: { Pet: { type: "string" } } },
    ]);
    expect(patched.components?.schemas?.["Pet"]).toEqual({ type: "string" });
  });
});
