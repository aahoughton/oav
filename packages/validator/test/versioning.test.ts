/**
 * Integration tests for the validator's version-awareness:
 *
 * - 3.1 and 3.2 specs compile under the same (JSON Schema 2020-12) dialect
 * - 3.0 specs fail construction with a clear, actionable error
 * - The QUERY method (new in 3.2) routes and validates like any other
 * - An explicit `vocabularies` option overrides the version-based default
 *   (so future-us can drop in a 3.0 dialect without touching core)
 */

import { describe, expect, it } from "vitest";
import type { OpenAPIDocument } from "@oav/core";
import { createValidator } from "../src/validator.js";

function spec32(): OpenAPIDocument {
  return {
    openapi: "3.2.0",
    info: { title: "Pets (3.2)", version: "1" },
    paths: {
      "/pets/search": {
        query: {
          operationId: "searchPets",
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["filter"],
                  properties: { filter: { type: "string", minLength: 1 } },
                },
              },
            },
          },
          responses: {
            "200": {
              description: "ok",
              content: {
                "application/json": {
                  schema: { type: "array", items: { type: "object" } },
                },
              },
            },
          },
        },
      },
    },
  };
}

describe("3.2 support", () => {
  it("compiles a 3.2 spec with the 2020-12 dialect", () => {
    expect(() => createValidator(spec32())).not.toThrow();
  });

  it("routes the new QUERY method", () => {
    const v = createValidator(spec32());
    const ok = v.validateRequest({
      method: "QUERY",
      path: "/pets/search",
      contentType: "application/json",
      body: { filter: "cats" },
    });
    expect(ok).toBeNull();
  });

  it("validates QUERY request bodies", () => {
    const v = createValidator(spec32());
    const err = v.validateRequest({
      method: "QUERY",
      path: "/pets/search",
      contentType: "application/json",
      body: { filter: "" }, // minLength: 1
    });
    expect(err).not.toBeNull();
    expect(err?.code).toBe("request");
  });

  it("validates QUERY responses", () => {
    const v = createValidator(spec32());
    const err = v.validateResponse(
      { method: "QUERY", path: "/pets/search", contentType: "application/json", body: { filter: "x" } },
      { status: 200, contentType: "application/json", body: [{}, {}] },
    );
    expect(err).toBeNull();
  });
});

describe("3.0 deferral", () => {
  it("throws a clear, actionable error when given a 3.0 spec", () => {
    const spec30: OpenAPIDocument = {
      openapi: "3.0.3",
      info: { title: "Old", version: "1" },
      paths: {},
    };
    expect(() => createValidator(spec30)).toThrow(/3\.0\.x is not yet supported/);
  });

  it("an explicit `vocabularies` option bypasses the 3.0 guard", () => {
    // When a user has their own dialect (e.g. a future 3.0 pack),
    // passing it explicitly short-circuits the version check.
    const spec30: OpenAPIDocument = {
      openapi: "3.0.3",
      info: { title: "Old", version: "1" },
      paths: {},
    };
    // Minimum viable vocab list — the schema package already tolerates
    // empty-ish schemas, and this validator has no paths, so nothing
    // will actually compile. Just checking the override path survives
    // construction.
    expect(() => createValidator(spec30, { vocabularies: [] })).not.toThrow();
  });
});

describe("unknown version", () => {
  it("falls through to the 3.1 dialect for missing `openapi` fields", () => {
    const bare: OpenAPIDocument = {
      openapi: "" as unknown as string,
      info: { title: "bare", version: "1" },
      paths: {},
    };
    expect(() => createValidator(bare)).not.toThrow();
  });
});
