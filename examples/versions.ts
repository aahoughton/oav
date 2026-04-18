/**
 * Multi-version support: the same conceptual "create a pet" operation,
 * written three different ways, one per OpenAPI version. The validator
 * reads `openapi` once at construction and picks the right dialect —
 * no per-request branching.
 *
 * - 3.0.x: `nullable: true`, boolean `exclusiveMaximum`
 * - 3.1.x: `type: ["string", "null"]`, numeric `exclusiveMaximum`
 * - 3.2.x: like 3.1 but can use the new `QUERY` HTTP method
 *
 * Run from the repo root:
 *   pnpm tsx examples/versions.ts
 */

import type { OpenAPIDocument } from "../packages/core/src/index.ts";
import { formatText } from "../packages/core/src/index.ts";
import { createValidator } from "../packages/validator/src/index.ts";

// --- OpenAPI 3.0.x ---------------------------------------------------------
const spec30: OpenAPIDocument = {
  openapi: "3.0.3",
  info: { title: "Pets 3.0", version: "1" },
  paths: {
    "/pets": {
      post: {
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: { type: "string", minLength: 1 },
                  tag: { type: "string", nullable: true }, // 3.0 flavour
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
const v30 = createValidator(spec30);
console.log(
  "3.0.3  tag=null        →",
  v30.validateRequest({
    method: "POST",
    path: "/pets",
    contentType: "application/json",
    body: { name: "Fido", tag: null },
  }) === null
    ? "ok"
    : "FAIL",
);
console.log(
  "3.0.3  priority=10     →",
  (() => {
    const e = v30.validateRequest({
      method: "POST",
      path: "/pets",
      contentType: "application/json",
      body: { name: "Fido", priority: 10 }, // exclusiveMaximum: true means must be < 10
    });
    return e === null ? "ok (should fail!)" : "rejected (as expected)";
  })(),
);

// --- OpenAPI 3.1.x ---------------------------------------------------------
const spec31: OpenAPIDocument = {
  openapi: "3.1.0",
  info: { title: "Pets 3.1", version: "1" },
  paths: {
    "/pets": {
      post: {
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: {
                  name: { type: "string", minLength: 1 },
                  tag: { type: ["string", "null"] }, // JSON Schema 2020-12 way
                  priority: { type: "integer", maximum: 10, exclusiveMaximum: 10 },
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
const v31 = createValidator(spec31);
console.log(
  "3.1.0  tag=null        →",
  v31.validateRequest({
    method: "POST",
    path: "/pets",
    contentType: "application/json",
    body: { name: "Fido", tag: null },
  }) === null
    ? "ok"
    : "FAIL",
);

// --- OpenAPI 3.2.x ---------------------------------------------------------
const spec32: OpenAPIDocument = {
  openapi: "3.2.0",
  info: { title: "Pets 3.2", version: "1" },
  paths: {
    "/pets/search": {
      query: {
        // <-- New in 3.2
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
        responses: { "200": { description: "ok" } },
      },
    },
  },
};
const v32 = createValidator(spec32);
const r = v32.validateRequest({
  method: "QUERY",
  path: "/pets/search",
  contentType: "application/json",
  body: { filter: "cats" },
});
console.log("3.2.0  QUERY /search  →", r === null ? "ok" : "FAIL:\n" + formatText(r));
