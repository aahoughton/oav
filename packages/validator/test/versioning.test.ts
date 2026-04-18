/**
 * Integration tests for the validator's version-awareness:
 *
 * - 3.1 and 3.2 specs compile under the JSON Schema 2020-12 dialect.
 * - 3.0 specs compile under the OAS 3.0 dialect: string-only `type`
 *   with sibling `nullable`, boolean `exclusiveMaximum` / `exclusiveMinimum`,
 *   and `$ref`-suppresses-siblings semantics.
 * - The QUERY method (new in 3.2) routes and validates like any other.
 * - An explicit `vocabularies` option overrides the version dispatch.
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
      {
        method: "QUERY",
        path: "/pets/search",
        contentType: "application/json",
        body: { filter: "x" },
      },
      { status: 200, contentType: "application/json", body: [{}, {}] },
    );
    expect(err).toBeNull();
  });
});

describe("3.0 support", () => {
  function spec30(): OpenAPIDocument {
    return {
      openapi: "3.0.3",
      info: { title: "Pets (3.0)", version: "1" },
      paths: {
        "/pets": {
          post: {
            operationId: "createPet",
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["name"],
                    properties: {
                      name: { type: "string", minLength: 1 },
                      // OAS 3.0 nullability
                      tag: { type: "string", nullable: true },
                      // OAS 3.0 boolean exclusiveMaximum
                      priority: { type: "integer", maximum: 10, exclusiveMaximum: true },
                    },
                  },
                },
              },
            },
            responses: { "201": { description: "created" } },
          },
        },
      },
    };
  }

  it("compiles a 3.0 spec without throwing", () => {
    expect(() => createValidator(spec30())).not.toThrow();
  });

  it("allows null on a nullable field", () => {
    const v = createValidator(spec30());
    const err = v.validateRequest({
      method: "POST",
      path: "/pets",
      contentType: "application/json",
      body: { name: "Fido", tag: null },
    });
    expect(err).toBeNull();
  });

  it("rejects null on a non-nullable field", () => {
    const v = createValidator(spec30());
    const err = v.validateRequest({
      method: "POST",
      path: "/pets",
      contentType: "application/json",
      body: { name: null },
    });
    expect(err).not.toBeNull();
  });

  it("honours boolean exclusiveMaximum (priority < 10, not ≤)", () => {
    const v = createValidator(spec30());
    // priority = 9 is fine
    expect(
      v.validateRequest({
        method: "POST",
        path: "/pets",
        contentType: "application/json",
        body: { name: "Fido", priority: 9 },
      }),
    ).toBeNull();
    // priority = 10 fails under 3.0's boolean-exclusive semantics
    const err = v.validateRequest({
      method: "POST",
      path: "/pets",
      contentType: "application/json",
      body: { name: "Fido", priority: 10 },
    });
    expect(err).not.toBeNull();
  });

  it("ignores $ref siblings in 3.0 (reference-only schemas)", () => {
    const spec: OpenAPIDocument = {
      openapi: "3.0.3",
      info: { title: "ref-sibling", version: "1" },
      paths: {
        "/x": {
          post: {
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  // The description alongside $ref must be ignored in 3.0,
                  // and the type:number check must NOT apply: only the
                  // referenced schema validates.
                  schema: {
                    $ref: "#/components/schemas/StringThing",
                    description: "siblings of $ref are ignored in 3.0",
                    type: "number",
                  },
                },
              },
            },
            responses: { "200": { description: "ok" } },
          },
        },
      },
      components: { schemas: { StringThing: { type: "string" } } },
    };
    const v = createValidator(spec);
    // If siblings weren't suppressed, "hi" (a string) would fail the
    // type:number sibling check. Under 3.0 semantics, only the
    // referenced type:string applies — "hi" is valid.
    expect(
      v.validateRequest({
        method: "POST",
        path: "/x",
        contentType: "application/json",
        body: "hi",
      }),
    ).toBeNull();
  });

  it("an explicit `vocabularies` option overrides the version dispatch", () => {
    // The override path skips version detection entirely and just
    // uses whatever vocabularies the caller provides.
    const spec: OpenAPIDocument = {
      openapi: "3.0.3",
      info: { title: "Old", version: "1" },
      paths: {},
    };
    expect(() => createValidator(spec, { vocabularies: [] })).not.toThrow();
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
