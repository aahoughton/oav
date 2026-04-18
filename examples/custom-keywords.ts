/**
 * Custom keywords: register a schema keyword whose behaviour depends on
 * runtime state the spec itself can't capture — here, an "active tenant"
 * check backed by an in-memory cache. Good for Luhn checks, tick-size
 * multiples, currency-whitelists, etc.
 *
 * Run from the repo root:
 *   pnpm tsx examples/custom-keywords.ts
 */

import type { OpenAPIDocument } from "../packages/core/src/index.ts";
import { formatText } from "../packages/core/src/index.ts";
import { createValidator } from "../packages/validator/src/index.ts";
import type { CustomKeywordValidator } from "../packages/validator/src/index.ts";

const tenantCache = new Set(["t_acme", "t_globex"]);

const activeTenant: CustomKeywordValidator = (data) => {
  if (typeof data !== "string") return true;
  if (tenantCache.has(data)) return true;
  return { message: `tenant "${data}" is not active`, params: { tenantId: data } };
};

const spec: OpenAPIDocument = {
  openapi: "3.1.0",
  info: { title: "Multi-tenant API", version: "1" },
  paths: {
    "/widgets": {
      post: {
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["tenantId"],
                properties: {
                  // Custom keyword in action:
                  tenantId: {
                    type: "string",
                    pattern: "^t_[a-z0-9]+$",
                    activeTenant: true,
                  } as Record<string, unknown>,
                  name: { type: "string" },
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

const v = createValidator(spec, {
  keywords: { activeTenant },
});

const ok = v.validateRequest({
  method: "POST",
  path: "/widgets",
  contentType: "application/json",
  body: { tenantId: "t_acme", name: "Widget A" },
});
console.log("t_acme (active) →", ok === null ? "ok" : "FAIL");

const bad = v.validateRequest({
  method: "POST",
  path: "/widgets",
  contentType: "application/json",
  body: { tenantId: "t_unknown", name: "Widget B" },
});
if (bad !== null) {
  console.log("\nt_unknown:\n" + formatText(bad));
}
