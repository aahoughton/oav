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

  it("overrides.upsertParameters appends new and replaces by (name, in)", () => {
    const patched = applyOverlays(base(), [
      {
        overrides: {
          "/pets": {
            operations: {
              get: {
                upsertParameters: [
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
              get: {
                upsertParameters: [{ name: "trace", in: "header", schema: { type: "string" } }],
              },
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

  it("extendSchemas inserts the extension verbatim when the target schema doesn't exist", () => {
    // Pin the silent-create behaviour explicitly so a future "throw on
    // missing target" change is a deliberate decision, not an accident.
    const patched = applyOverlays(base(), [
      { extendSchemas: { NewType: { type: "string", minLength: 1 } } },
    ]);
    expect(patched.components?.schemas?.["NewType"]).toEqual({
      type: "string",
      minLength: 1,
    });
  });

  it("overrides targeting an unknown (non-wildcard) path throws", () => {
    expect(() =>
      applyOverlays(base(), [
        {
          overrides: {
            "/missing": { operations: { get: { upsertParameters: [] } } },
          },
        },
      ]),
    ).toThrow(/overlay override targets unknown path/);
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

  it("removePaths drops the target path; missing target throws", () => {
    const patched = applyOverlays(base(), [{ removePaths: ["/pets"] }]);
    expect(patched.paths?.["/pets"]).toBeUndefined();

    expect(() => applyOverlays(base(), [{ removePaths: ["/missing"] }])).toThrow(
      /removePaths targets unknown path/,
    );
  });

  it("removeSchemas drops the target schema; missing target throws", () => {
    const patched = applyOverlays(base(), [{ removeSchemas: ["Pet"] }]);
    expect(patched.components?.schemas?.["Pet"]).toBeUndefined();

    expect(() => applyOverlays(base(), [{ removeSchemas: ["Missing"] }])).toThrow(
      /removeSchemas targets unknown schema/,
    );
  });

  it("addPaths + removePaths naming the same path in one overlay throws", () => {
    expect(() =>
      applyOverlays(base(), [
        {
          addPaths: { "/foo": { get: { responses: { "200": { description: "ok" } } } } },
          removePaths: ["/foo"],
        },
      ]),
    ).toThrow(/self-conflict/);
  });

  it("replaceSchemas + removeSchemas naming the same schema in one overlay throws", () => {
    expect(() =>
      applyOverlays(base(), [
        { replaceSchemas: { Pet: { type: "string" } }, removeSchemas: ["Pet"] },
      ]),
    ).toThrow(/self-conflict/);
  });

  it("removeParameters drops by (name, in); missing entries silently no-op", () => {
    const patched = applyOverlays(base(), [
      {
        overrides: {
          "/pets": {
            operations: {
              get: {
                removeParameters: [
                  { name: "limit", in: "query" },
                  { name: "nope", in: "header" }, // not present → no-op
                ],
              },
            },
          },
        },
      },
    ]);
    expect(patched.paths?.["/pets"]?.get?.parameters ?? []).toHaveLength(0);
  });

  it("removeResponses drops status codes; missing entries silently no-op", () => {
    const patched = applyOverlays(base(), [
      {
        overrides: {
          "/pets": {
            operations: {
              post: { removeResponses: ["201", "404"] },
            },
          },
        },
      },
    ]);
    const responses = patched.paths?.["/pets"]?.post?.responses ?? {};
    expect(responses["201"]).toBeUndefined();
    expect(Object.keys(responses)).not.toContain("404");
  });

  it("operation-level replace: wholesale swap; conflict with additive fields throws", () => {
    const replacement = {
      operationId: "listPets",
      responses: { "200": { description: "fresh" } },
    };
    const patched = applyOverlays(base(), [
      { overrides: { "/pets": { operations: { get: { replace: replacement } } } } },
    ]);
    expect(patched.paths?.["/pets"]?.get).toEqual(replacement);
    // post unchanged
    expect(patched.paths?.["/pets"]?.post?.responses?.["201"]).toBeDefined();

    expect(() =>
      applyOverlays(base(), [
        {
          overrides: {
            "/pets": {
              operations: {
                get: {
                  replace: replacement,
                  upsertParameters: [{ name: "x", in: "header", schema: { type: "string" } }],
                },
              },
            },
          },
        },
      ]),
    ).toThrow(/replace cannot be combined with upsertParameters/);
  });
});
