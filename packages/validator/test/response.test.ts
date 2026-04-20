import type { OpenAPIDocument } from "@oav/core";
import { describe, expect, it } from "vitest";
import { createValidator } from "../src/validator.js";
import { leafAt, leafCodes, petSpec } from "./fixtures.js";

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
});
