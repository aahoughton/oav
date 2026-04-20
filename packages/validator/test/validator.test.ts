import { describe, expect, it } from "vitest";
import type { OpenAPIDocument, ValidationError } from "@oav/core";
import { collectLeaves } from "@oav/core";
import { createValidator } from "../src/validator.js";
import type { CustomKeywordValidator } from "../src/index.js";

function leafCodes(err: ValidationError | null | undefined): string[] {
  return err === null || err === undefined ? [] : collectLeaves(err).map((l) => l.code);
}

function leafAt(
  err: ValidationError | null | undefined,
  pathStr: string,
): ValidationError | undefined {
  if (err === null || err === undefined) return undefined;
  return collectLeaves(err).find((l) => l.path.join(".") === pathStr);
}

function petSpec(): OpenAPIDocument {
  return {
    openapi: "3.1.0",
    info: { title: "Pets", version: "1" },
    paths: {
      "/pets": {
        get: {
          parameters: [
            {
              name: "limit",
              in: "query",
              required: false,
              schema: { type: "integer", minimum: 1 },
            },
            { name: "X-Tenant", in: "header", required: true, schema: { type: "string" } },
          ],
          responses: {
            "200": {
              description: "ok",
              content: {
                "application/json": { schema: { type: "array", items: { type: "object" } } },
              },
            },
          },
        },
        post: {
          parameters: [
            { name: "X-Tenant", in: "header", required: true, schema: { type: "string" } },
          ],
          requestBody: {
            required: true,
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  required: ["name"],
                  properties: { name: { type: "string" }, age: { type: "integer", minimum: 0 } },
                },
              },
            },
          },
          responses: {
            "201": { description: "created" },
            "4XX": { description: "client err" },
          },
        },
      },
      "/pets/{petId}": {
        get: {
          parameters: [{ name: "petId", in: "path", required: true, schema: { type: "integer" } }],
          responses: { "200": { description: "ok" } },
        },
      },
    },
  };
}

describe("validateRequest", () => {
  const v = createValidator(petSpec());

  it("returns null for a valid request", () => {
    expect(
      v.validateRequest({
        method: "POST",
        path: "/pets",
        contentType: "application/json",
        headers: { "x-tenant": "t1" },
        body: { name: "Fido" },
      }),
    ).toBeNull();
  });

  it("errors for a body that violates its schema", () => {
    const err = v.validateRequest({
      method: "POST",
      path: "/pets",
      contentType: "application/json",
      headers: { "x-tenant": "t1" },
      body: { age: -1 },
    });
    expect(err?.code).toBe("request");
    expect(leafAt(err, "body.age")?.code).toBe("minimum");
  });

  it("errors when required header is missing", () => {
    const err = v.validateRequest({
      method: "POST",
      path: "/pets",
      contentType: "application/json",
      body: { name: "x" },
    });
    expect(leafCodes(err)).toContain("header-param");
  });

  it("errors for unknown route", () => {
    const err = v.validateRequest({ method: "DELETE", path: "/nope" });
    expect(err?.code).toBe("route");
  });

  it("errors for wrong Content-Type", () => {
    const err = v.validateRequest({
      method: "POST",
      path: "/pets",
      contentType: "text/plain",
      headers: { "x-tenant": "t1" },
      body: "raw",
    });
    expect(leafCodes(err)).toContain("content-type");
  });

  it("deserializes path parameters to their declared type", () => {
    expect(v.validateRequest({ method: "GET", path: "/pets/42" })).toBeNull();
    const err = v.validateRequest({ method: "GET", path: "/pets/abc" });
    expect(leafCodes(err)).toContain("type");
  });

  it("deserializes query parameters (string → integer)", () => {
    const err = v.validateRequest({
      method: "GET",
      path: "/pets",
      query: { limit: "0" },
      headers: { "x-tenant": "t1" },
    });
    expect(leafCodes(err)).toContain("minimum");
  });

  it("aggregates body + query + header errors into a single tree", () => {
    const err = v.validateRequest({
      method: "POST",
      path: "/pets",
      contentType: "application/json",
      // missing X-Tenant, invalid body
      body: { age: "not a number" },
    });
    expect(leafCodes(err)).toContain("header-param");
  });
});

describe("validateResponse", () => {
  const v = createValidator(petSpec());

  it("returns null for a valid response", () => {
    expect(
      v.validateResponse(
        { method: "GET", path: "/pets", headers: { "x-tenant": "t1" } },
        { status: 200, contentType: "application/json", body: [{ name: "x" }] },
      ),
    ).toBeNull();
  });

  it("matches XX status class", () => {
    const err = v.validateResponse(
      { method: "POST", path: "/pets", headers: { "x-tenant": "t1" }, body: { name: "x" } },
      { status: 418 },
    );
    expect(err).toBeNull();
  });

  it("errors when the response Content-Type is unexpected", () => {
    const err = v.validateResponse(
      { method: "GET", path: "/pets", headers: { "x-tenant": "t1" } },
      { status: 200, contentType: "text/plain", body: "nope" },
    );
    expect(leafCodes(err)).toContain("content-type");
  });

  it("errors when the body violates the schema", () => {
    const err = v.validateResponse(
      { method: "GET", path: "/pets", headers: { "x-tenant": "t1" } },
      { status: 200, contentType: "application/json", body: "should be array" },
    );
    expect(leafCodes(err)).toContain("type");
  });

  it("errors for an undeclared status code", () => {
    const err = v.validateResponse(
      { method: "GET", path: "/pets", headers: { "x-tenant": "t1" } },
      { status: 500 },
    );
    expect(leafCodes(err)).toContain("status");
  });
});

describe("custom keywords via createValidator", () => {
  function sku(): OpenAPIDocument {
    return {
      openapi: "3.1.0",
      info: { title: "sku", version: "1" },
      paths: {
        "/items": {
          post: {
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["sku"],
                    properties: {
                      sku: { type: "string", skuPrefix: "OAV-" } as Record<string, unknown>,
                    },
                  },
                },
              },
            },
            responses: { "200": { description: "ok" } },
          },
        },
      },
    };
  }

  const skuPrefix: CustomKeywordValidator = (data, schemaValue) => {
    if (typeof data !== "string") return true;
    const prefix = schemaValue as string;
    if (data.startsWith(prefix)) return true;
    return { message: `must start with ${prefix}`, params: { prefix } };
  };

  it("applies the custom keyword to request bodies", () => {
    const v = createValidator(sku(), { keywords: { skuPrefix } });
    expect(
      v.validateRequest({
        method: "POST",
        path: "/items",
        contentType: "application/json",
        body: { sku: "OAV-42" },
      }),
    ).toBeNull();
    const err = v.validateRequest({
      method: "POST",
      path: "/items",
      contentType: "application/json",
      body: { sku: "nope" },
    });
    expect(err).not.toBeNull();
    const leaf = collectLeaves(err as ValidationError).find((l) => l.code === "skuPrefix");
    expect(leaf).toBeDefined();
    expect(leaf?.message).toBe("must start with OAV-");
    expect(leaf?.params).toEqual({ prefix: "OAV-" });
    expect(leaf?.path).toEqual(["body", "sku"]);
  });

  describe("lazy response-schema compilation", () => {
    // Observable contract: response-body and response-header schemas are
    // compiled lazily on first validateResponse touch. We probe this by
    // planting a schema that throws deterministically at compileSchema
    // time — `type: [...]` is illegal in the OAS 3.0 dialect, so its
    // keyword throws at compile. If response compilation were eager,
    // createValidator would throw. If lazy, it succeeds and the throw
    // appears at first validateResponse for the offending op.
    function specWithBrokenResponseBody(): OpenAPIDocument {
      return {
        openapi: "3.0.3",
        info: { title: "x", version: "1" },
        paths: {
          "/a": {
            post: {
              requestBody: {
                required: true,
                content: {
                  "application/json": { schema: { type: "object" } },
                },
              },
              responses: {
                "200": {
                  description: "ok",
                  content: {
                    "application/json": {
                      schema: { type: ["string", "null"] as unknown as string },
                    },
                  },
                },
              },
            },
          },
        },
      };
    }

    it("doesn't compile response bodies at createValidator time", () => {
      expect(() => createValidator(specWithBrokenResponseBody())).not.toThrow();
    });

    it("doesn't compile response bodies during validateRequest", () => {
      const v = createValidator(specWithBrokenResponseBody());
      expect(() =>
        v.validateRequest({
          method: "POST",
          path: "/a",
          contentType: "application/json",
          body: {},
        }),
      ).not.toThrow();
    });

    it("compiles the response body on first validateResponse touch", () => {
      const v = createValidator(specWithBrokenResponseBody());
      expect(() =>
        v.validateResponse(
          { method: "POST", path: "/a" },
          { status: 200, contentType: "application/json", body: "ok" },
        ),
      ).toThrow(/OpenAPI 3\.0 'type' must be a single string/);
    });

    it("doesn't compile response headers whose values are absent", () => {
      const spec: OpenAPIDocument = {
        openapi: "3.0.3",
        info: { title: "x", version: "1" },
        paths: {
          "/a": {
            get: {
              responses: {
                "200": {
                  description: "ok",
                  headers: {
                    "X-Opt": {
                      schema: { type: ["string", "null"] as unknown as string },
                    },
                  },
                },
              },
            },
          },
        },
      };
      const v = createValidator(spec);
      expect(() =>
        v.validateResponse({ method: "GET", path: "/a" }, { status: 200 }),
      ).not.toThrow();
    });
  });
});
