/**
 * Overlays: merge environment-specific patches into a base OpenAPI
 * document before constructing the validator. Common uses include adding
 * a gateway-injected header to every operation, extending a schema with
 * extra properties, or replacing a response shape in test environments.
 *
 * Run from the repo root:
 *   pnpm tsx examples/overlay.ts
 */

import type { OpenAPIDocument } from "../packages/core/src/index.ts";
import { formatText } from "../packages/core/src/index.ts";
import { applyOverlays, type SpecOverlay } from "../packages/spec/src/index.ts";
import { createValidator } from "../packages/validator/src/index.ts";

const base: OpenAPIDocument = {
  openapi: "3.1.0",
  info: { title: "Widgets", version: "1" },
  paths: {
    "/widgets": {
      get: {
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

// Gateway adds `X-Request-Id` to every operation in prod. Rather than
// edit the base spec, we overlay the requirement in at load time.
const overlay: SpecOverlay = {
  overrides: {
    "/widgets": {
      operations: {
        get: {
          upsertParameters: [
            { name: "X-Request-Id", in: "header", required: true, schema: { type: "string" } },
          ],
        },
      },
    },
  },
};

const merged = applyOverlays(base, [overlay]);
const v = createValidator(merged);

// Without the header — should fail.
const missing = v.validateRequest({ method: "GET", path: "/widgets" });
console.log("without X-Request-Id:");
if (missing !== null) console.log(formatText(missing));

// With the header — clean.
const ok = v.validateRequest({
  method: "GET",
  path: "/widgets",
  headers: { "x-request-id": "abc-123" },
});
console.log("\nwith X-Request-Id →", ok === null ? "ok" : "FAIL");
