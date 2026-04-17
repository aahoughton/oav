/**
 * Basic HTTP validation: build a validator from an inline OpenAPI 3.1
 * document and check one valid + one invalid request, then a response.
 *
 * Run from the repo root:
 *   pnpm tsx examples/basic-validation.ts
 */

import type { OpenAPIDocument } from "../packages/core/src/index.ts";
import { formatText } from "../packages/core/src/index.ts";
import { createValidator } from "../packages/validator/src/index.ts";

const spec: OpenAPIDocument = {
  openapi: "3.1.0",
  info: { title: "Pets", version: "1" },
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
                  tag: { type: "string" },
                },
              },
            },
          },
        },
        responses: {
          "201": { description: "created" },
        },
      },
    },
  },
};

const v = createValidator(spec);

const valid = v.validateRequest({
  method: "POST",
  path: "/pets",
  contentType: "application/json",
  body: { name: "Fido", tag: "dog" },
});
console.log("valid request →", valid === null ? "ok" : "FAIL");

const bad = v.validateRequest({
  method: "POST",
  path: "/pets",
  contentType: "application/json",
  body: { tag: "dog" }, // missing required `name`
});
if (bad !== null) {
  console.log("\ninvalid request:\n" + formatText(bad));
}

const responseErr = v.validateResponse(
  { method: "POST", path: "/pets", body: { name: "Fido" }, contentType: "application/json" },
  { status: 201 },
);
console.log("\nresponse (201, no body) →", responseErr === null ? "ok" : "FAIL");
