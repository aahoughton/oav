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

  it("empty-string query param is not treated as missing", () => {
    const spec: OpenAPIDocument = {
      openapi: "3.1.0",
      info: { title: "t", version: "1" },
      paths: {
        "/search": {
          get: {
            parameters: [{ name: "q", in: "query", required: true, schema: { type: "string" } }],
            responses: { "200": { description: "ok" } },
          },
        },
      },
    };
    const sv = createValidator(spec);
    expect(sv.validateRequest({ method: "GET", path: "/search", query: { q: "" } })).toBeNull();
  });

  it("empty-string query param is rejected by a minLength:1 schema", () => {
    const spec: OpenAPIDocument = {
      openapi: "3.1.0",
      info: { title: "t", version: "1" },
      paths: {
        "/search": {
          get: {
            parameters: [
              {
                name: "q",
                in: "query",
                required: true,
                schema: { type: "string", minLength: 1 },
              },
            ],
            responses: { "200": { description: "ok" } },
          },
        },
      },
    };
    const sv = createValidator(spec);
    const err = sv.validateRequest({ method: "GET", path: "/search", query: { q: "" } });
    expect(leafCodes(err)).toContain("minLength");
  });

  it("accepts Buffer / Uint8Array for type:string, format:binary body fields", () => {
    // openapi-backend #860 / #809: multipart binary fields arrive as
    // Buffer / Uint8Array / framework-specific objects, not JS strings.
    // A strict string-type check here would reject every file upload.
    const spec: OpenAPIDocument = {
      openapi: "3.1.0",
      info: { title: "t", version: "1" },
      paths: {
        "/upload": {
          post: {
            requestBody: {
              required: true,
              content: {
                "multipart/form-data": {
                  schema: {
                    type: "object",
                    required: ["file"],
                    properties: {
                      name: { type: "string" },
                      file: { type: "string", format: "binary" },
                    },
                  },
                },
              },
            },
            responses: { "201": { description: "ok" } },
          },
        },
      },
    };
    const sv = createValidator(spec);

    // Buffer-backed field passes.
    expect(
      sv.validateRequest({
        method: "POST",
        path: "/upload",
        contentType: "multipart/form-data",
        body: { name: "hello.txt", file: Buffer.from("hello") },
      }),
    ).toBeNull();
    // Uint8Array also passes.
    expect(
      sv.validateRequest({
        method: "POST",
        path: "/upload",
        contentType: "multipart/form-data",
        body: { name: "x", file: new Uint8Array([1, 2, 3]) },
      }),
    ).toBeNull();
    // But format:byte (base64) stays a string and is checked normally.
    const strictSpec: OpenAPIDocument = {
      ...spec,
      paths: {
        "/upload": {
          post: {
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["file"],
                    properties: { file: { type: "string", format: "byte" } },
                  },
                },
              },
            },
            responses: { "201": { description: "ok" } },
          },
        },
      },
    };
    const strictSv = createValidator(strictSpec);
    const err = strictSv.validateRequest({
      method: "POST",
      path: "/upload",
      contentType: "application/json",
      body: { file: Buffer.from("nope") },
    });
    expect(leafAt(err, "body.file")?.code).toBe("type");
  });

  it("operation-level parameters replace path-level ones with the same name+in", () => {
    // openapi-backend #46. Path-level param: minLength 1; op-level
    // override: minLength 10. Per OAS 3.x the op-level fully replaces
    // the path-level — a single error with the op-level constraint.
    const spec: OpenAPIDocument = {
      openapi: "3.1.0",
      info: { title: "t", version: "1" },
      paths: {
        "/users": {
          parameters: [
            {
              name: "id",
              in: "query",
              required: true,
              schema: { type: "string", minLength: 1 },
            },
          ],
          get: {
            parameters: [
              {
                name: "id",
                in: "query",
                required: true,
                schema: { type: "string", minLength: 10 },
              },
            ],
            responses: { "200": { description: "ok" } },
          },
        },
      },
    };
    const sv = createValidator(spec);
    // "x" fails the op-level constraint (len 1 < 10) and would have
    // passed the path-level (len 1 >= 1). The op-level must win.
    const err = sv.validateRequest({ method: "GET", path: "/users", query: { id: "x" } });
    const leaves = collectLeaves(err ?? undefined!).filter((l) => l.path.join(".") === "query.id");
    // Exactly one leaf, carrying the op-level constraint.
    expect(leaves).toHaveLength(1);
    expect(leaves[0]?.params).toMatchObject({ minLength: 10 });
    // And a value that passes the op-level constraint validates cleanly.
    expect(
      sv.validateRequest({ method: "GET", path: "/users", query: { id: "0123456789" } }),
    ).toBeNull();
  });

  it("enforces item-level schemas on array query parameters", () => {
    // eov #917: per-item pattern / minLength checks must run on each
    // element of a deserialized array query param.
    const spec: OpenAPIDocument = {
      openapi: "3.1.0",
      info: { title: "t", version: "1" },
      paths: {
        "/search": {
          get: {
            parameters: [
              {
                name: "tag",
                in: "query",
                required: true,
                explode: false,
                schema: {
                  type: "array",
                  items: { type: "string", pattern: "^[a-z]+$", minLength: 2 },
                },
              },
            ],
            responses: { "200": { description: "ok" } },
          },
        },
      },
    };
    const sv = createValidator(spec);
    expect(
      sv.validateRequest({ method: "GET", path: "/search", query: { tag: "foo,bar" } }),
    ).toBeNull();
    const patternErr = sv.validateRequest({
      method: "GET",
      path: "/search",
      query: { tag: "foo,BAR" },
    });
    expect(leafCodes(patternErr)).toContain("pattern");
    const lengthErr = sv.validateRequest({
      method: "GET",
      path: "/search",
      query: { tag: "foo,b" },
    });
    expect(leafCodes(lengthErr)).toContain("minLength");
  });

  it("resolves parameters declared via $ref", () => {
    // eov #803: operations frequently reference shared parameters from
    // components.parameters.
    const spec: OpenAPIDocument = {
      openapi: "3.1.0",
      info: { title: "t", version: "1" },
      components: {
        parameters: {
          Tenant: { name: "X-Tenant", in: "header", required: true, schema: { type: "string" } },
        },
      },
      paths: {
        "/pets": {
          get: {
            parameters: [{ $ref: "#/components/parameters/Tenant" }],
            responses: { "200": { description: "ok" } },
          },
        },
      },
    };
    const sv = createValidator(spec);
    expect(
      sv.validateRequest({ method: "GET", path: "/pets", headers: { "x-tenant": "t1" } }),
    ).toBeNull();
    const err = sv.validateRequest({ method: "GET", path: "/pets" });
    expect(leafCodes(err)).toContain("header-param");
  });

  it("accepts an optional-body POST with no body and no content-type", () => {
    // eov #397 / #646 / #655: when requestBody is not required and the
    // caller sends nothing, there's nothing to validate — don't error
    // on the missing content-type.
    const spec: OpenAPIDocument = {
      openapi: "3.1.0",
      info: { title: "t", version: "1" },
      paths: {
        "/ping": {
          post: {
            requestBody: {
              required: false,
              content: { "application/json": { schema: { type: "object" } } },
            },
            responses: { "204": { description: "ok" } },
          },
        },
      },
    };
    const sv = createValidator(spec);
    expect(sv.validateRequest({ method: "POST", path: "/ping" })).toBeNull();
  });

  it("format validators let null pass through on nullable OAS 3.0 fields", () => {
    // eov #382 / #108: format checks should not fire for null values on
    // nullable properties — the format predicate only applies to strings.
    const spec: OpenAPIDocument = {
      openapi: "3.0.3",
      info: { title: "t", version: "1" },
      paths: {
        "/t": {
          post: {
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      when: { type: "string", format: "date-time", nullable: true },
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
    const sv = createValidator(spec);
    expect(
      sv.validateRequest({
        method: "POST",
        path: "/t",
        contentType: "application/json",
        body: { when: null },
      }),
    ).toBeNull();
  });

  it("discriminator failures inside an array carry the index in the body path", () => {
    // eov #669: when a polymorphic body element fails, the error tree
    // must identify which array index broke. Exercises the full
    // body-validation path, not just the schema compiler.
    const spec: OpenAPIDocument = {
      openapi: "3.1.0",
      info: { title: "t", version: "1" },
      components: {
        schemas: {
          Cat: {
            type: "object",
            required: ["kind", "purr"],
            properties: { kind: { const: "Cat" }, purr: { type: "boolean" } },
          },
          Dog: {
            type: "object",
            required: ["kind", "bark"],
            properties: { kind: { const: "Dog" }, bark: { type: "string" } },
          },
        },
      },
      paths: {
        "/pack": {
          post: {
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "array",
                    items: {
                      discriminator: { propertyName: "kind" },
                      oneOf: [
                        { $ref: "#/components/schemas/Cat" },
                        { $ref: "#/components/schemas/Dog" },
                      ],
                    },
                  },
                },
              },
            },
            responses: { "201": { description: "ok" } },
          },
        },
      },
    };
    const sv = createValidator(spec);
    const err = sv.validateRequest({
      method: "POST",
      path: "/pack",
      contentType: "application/json",
      body: [
        { kind: "Cat", purr: true },
        { kind: "Dog" }, // missing bark
      ],
    });
    const leaf = leafAt(err, "body.1.bark");
    expect(leaf?.code).toBe("required");
  });

  it("readOnly properties are rejected in request bodies", () => {
    const spec: OpenAPIDocument = {
      openapi: "3.1.0",
      info: { title: "t", version: "1" },
      paths: {
        "/users": {
          post: {
            requestBody: {
              required: true,
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    required: ["id", "name"],
                    properties: {
                      id: { type: "string", readOnly: true },
                      name: { type: "string" },
                    },
                  },
                },
              },
            },
            responses: { "201": { description: "ok" } },
          },
        },
      },
    };
    const sv = createValidator(spec);

    // Client sends readOnly id → rejected.
    const err = sv.validateRequest({
      method: "POST",
      path: "/users",
      contentType: "application/json",
      body: { id: "x", name: "n" },
    });
    expect(leafAt(err, "body.id")).toBeDefined();

    // Client omits readOnly id → passes (not required on the request side).
    expect(
      sv.validateRequest({
        method: "POST",
        path: "/users",
        contentType: "application/json",
        body: { name: "n" },
      }),
    ).toBeNull();
  });

  it("writeOnly properties are rejected in response bodies", () => {
    const spec: OpenAPIDocument = {
      openapi: "3.1.0",
      info: { title: "t", version: "1" },
      paths: {
        "/users": {
          get: {
            responses: {
              "200": {
                description: "ok",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      required: ["id", "password"],
                      properties: {
                        id: { type: "string" },
                        password: { type: "string", writeOnly: true },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    };
    const sv = createValidator(spec);

    // Server returns writeOnly password → rejected.
    const err = sv.validateResponse(
      { method: "GET", path: "/users" },
      {
        status: 200,
        contentType: "application/json",
        body: { id: "u1", password: "secret" },
      },
    );
    expect(leafAt(err, "response.body.password")).toBeDefined();

    // Server omits writeOnly password → passes (not required on the response side).
    expect(
      sv.validateResponse(
        { method: "GET", path: "/users" },
        { status: 200, contentType: "application/json", body: { id: "u1" } },
      ),
    ).toBeNull();
  });

  it("readOnly inside an allOf-referenced subschema is enforced on request bodies", () => {
    // eov #149 / #389: the classic OpenAPI composition pattern — a
    // per-entity schema extends a shared "timestamps" fragment via
    // allOf + $ref. The shared fragment's readOnly fields (and their
    // required-ness) must be transformed on the request side.
    const spec: OpenAPIDocument = {
      openapi: "3.1.0",
      info: { title: "t", version: "1" },
      components: {
        schemas: {
          Timestamps: {
            type: "object",
            required: ["createdAt"],
            properties: { createdAt: { type: "string", readOnly: true } },
          },
          User: {
            allOf: [
              { $ref: "#/components/schemas/Timestamps" },
              {
                type: "object",
                required: ["name"],
                properties: { name: { type: "string" } },
              },
            ],
          },
        },
      },
      paths: {
        "/users": {
          post: {
            requestBody: {
              required: true,
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/User" } },
              },
            },
            responses: { "201": { description: "ok" } },
          },
        },
      },
    };
    const sv = createValidator(spec);
    // Omitting createdAt should pass — the readOnly field is exempt
    // from required on the request side.
    expect(
      sv.validateRequest({
        method: "POST",
        path: "/users",
        contentType: "application/json",
        body: { name: "n" },
      }),
    ).toBeNull();
    // Sending createdAt should fail — clients must not supply it.
    const err = sv.validateRequest({
      method: "POST",
      path: "/users",
      contentType: "application/json",
      body: { name: "n", createdAt: "2026-01-01" },
    });
    expect(leafAt(err, "body.createdAt")).toBeDefined();
  });

  it("writeOnly inside an allOf-referenced subschema is enforced on response bodies", () => {
    const spec: OpenAPIDocument = {
      openapi: "3.1.0",
      info: { title: "t", version: "1" },
      components: {
        schemas: {
          Secrets: {
            type: "object",
            required: ["password"],
            properties: { password: { type: "string", writeOnly: true } },
          },
          User: {
            allOf: [
              { $ref: "#/components/schemas/Secrets" },
              {
                type: "object",
                required: ["id"],
                properties: { id: { type: "string" } },
              },
            ],
          },
        },
      },
      paths: {
        "/users": {
          get: {
            responses: {
              "200": {
                description: "ok",
                content: {
                  "application/json": { schema: { $ref: "#/components/schemas/User" } },
                },
              },
            },
          },
        },
      },
    };
    const sv = createValidator(spec);
    // Response omits writeOnly password — should pass.
    expect(
      sv.validateResponse(
        { method: "GET", path: "/users" },
        { status: 200, contentType: "application/json", body: { id: "u1" } },
      ),
    ).toBeNull();
    // Response includes writeOnly password — rejected.
    const err = sv.validateResponse(
      { method: "GET", path: "/users" },
      {
        status: 200,
        contentType: "application/json",
        body: { id: "u1", password: "secret" },
      },
    );
    expect(leafAt(err, "response.body.password")).toBeDefined();
  });

  it("readOnly via $ref is still enforced on request bodies", () => {
    const spec: OpenAPIDocument = {
      openapi: "3.1.0",
      info: { title: "t", version: "1" },
      components: {
        schemas: {
          ServerId: { type: "string", readOnly: true },
          User: {
            type: "object",
            required: ["id", "name"],
            properties: {
              id: { $ref: "#/components/schemas/ServerId" },
              name: { type: "string" },
            },
          },
        },
      },
      paths: {
        "/users": {
          post: {
            requestBody: {
              required: true,
              content: {
                "application/json": { schema: { $ref: "#/components/schemas/User" } },
              },
            },
            responses: { "201": { description: "ok" } },
          },
        },
      },
    };
    const sv = createValidator(spec);
    const err = sv.validateRequest({
      method: "POST",
      path: "/users",
      contentType: "application/json",
      body: { id: "x", name: "n" },
    });
    expect(leafAt(err, "body.id")).toBeDefined();
  });

  it("parameter.content parses JSON and validates its schema", () => {
    // OpenAPI 3.1 §4.8.12.1 lets a parameter carry `content` instead of
    // `schema` — standard pattern for structured-JSON query params.
    const spec: OpenAPIDocument = {
      openapi: "3.1.0",
      info: { title: "t", version: "1" },
      paths: {
        "/items": {
          get: {
            parameters: [
              {
                name: "filter",
                in: "query",
                content: {
                  "application/json": {
                    schema: {
                      type: "object",
                      required: ["x"],
                      properties: { x: { type: "integer" } },
                    },
                  },
                },
              },
            ],
            responses: { "200": { description: "ok" } },
          },
        },
      },
    };
    const sv = createValidator(spec);

    // Valid JSON against schema → ok.
    expect(
      sv.validateRequest({
        method: "GET",
        path: "/items",
        query: { filter: '{"x":1}' },
      }),
    ).toBeNull();

    // JSON that violates the schema → schema error (not a parse error).
    const schemaErr = sv.validateRequest({
      method: "GET",
      path: "/items",
      query: { filter: '{"x":"nope"}' },
    });
    expect(leafCodes(schemaErr)).toContain("type");

    // Malformed JSON → dedicated content-parse error.
    const parseErr = sv.validateRequest({
      method: "GET",
      path: "/items",
      query: { filter: "{not-json}" },
    });
    const leaf = collectLeaves(parseErr ?? undefined!).find(
      (l) => l.params?.reason === "content-parse",
    );
    expect(leaf?.params).toMatchObject({
      name: "filter",
      in: "query",
      mediaType: "application/json",
    });
  });

  it("allowEmptyValue on a query parameter exempts empty-string from schema validation", () => {
    const spec: OpenAPIDocument = {
      openapi: "3.1.0",
      info: { title: "t", version: "1" },
      paths: {
        "/search": {
          get: {
            parameters: [
              {
                name: "debug",
                in: "query",
                required: false,
                allowEmptyValue: true,
                // A schema that would normally reject "" — allowEmptyValue skips it.
                schema: { type: "string", minLength: 4 },
              },
            ],
            responses: { "200": { description: "ok" } },
          },
        },
      },
    };
    const sv = createValidator(spec);
    expect(sv.validateRequest({ method: "GET", path: "/search", query: { debug: "" } })).toBeNull();
    const err = sv.validateRequest({ method: "GET", path: "/search", query: { debug: "ab" } });
    expect(leafCodes(err)).toContain("minLength");
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
