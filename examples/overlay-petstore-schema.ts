/**
 * Overlay: extend a component schema without touching the upstream spec.
 *
 * Scenario: an upstream petstore defines `Pet` as `{ name, tag }`. Your
 * deployment additionally requires `vaccinated: boolean` on every pet
 * accepted by POST /pets. Rather than forking the spec and keeping the
 * fork in sync, you overlay an extension onto the `Pet` component.
 *
 * The overlay merges the extension into the original schema via
 * `allOf` — the original shape still applies; the extension adds to it.
 * Consumers that only know about the upstream `Pet` continue to see a
 * compatible shape; the extra constraint is enforced on top.
 *
 * Run from the repo root:
 *   pnpm tsx examples/overlay-petstore-schema.ts
 */

import type { OpenAPIDocument } from "../packages/core/src/index.ts";
import { formatText } from "../packages/core/src/index.ts";
import { applyOverlays, type SpecOverlay } from "../packages/spec/src/index.ts";
import { createValidator } from "../packages/validator/src/index.ts";

// Upstream petstore. `Pet` is declared under `components/schemas` so
// the overlay can target it by name.
const base: OpenAPIDocument = {
  openapi: "3.1.0",
  info: { title: "Petstore", version: "1" },
  paths: {
    "/pets": {
      post: {
        requestBody: {
          required: true,
          content: {
            "application/json": { schema: { $ref: "#/components/schemas/Pet" } },
          },
        },
        responses: { "201": { description: "created" } },
      },
    },
  },
  components: {
    schemas: {
      Pet: {
        type: "object",
        required: ["name"],
        properties: {
          name: { type: "string" },
          tag: { type: "string" },
        },
      },
    },
  },
};

// Deployment-specific extension: require `vaccinated: boolean`. Because
// `extendSchemas` merges via allOf, the upstream Pet shape is preserved
// (still requires `name`, still permits optional `tag`) and the new
// constraint adds to it.
const overlay: SpecOverlay = {
  extendSchemas: {
    Pet: {
      type: "object",
      required: ["vaccinated"],
      properties: { vaccinated: { type: "boolean" } },
    },
  },
};

const merged = applyOverlays(base, [overlay]);
const v = createValidator(merged);

// Without vaccinated: rejected by the overlaid spec.
const missing = v.validateRequest({
  method: "POST",
  path: "/pets",
  contentType: "application/json",
  body: { name: "Fido" },
});
console.log("POST /pets without `vaccinated`:");
if (missing !== null) console.log(formatText(missing));

// With vaccinated: clean.
const ok = v.validateRequest({
  method: "POST",
  path: "/pets",
  contentType: "application/json",
  body: { name: "Fido", vaccinated: true },
});
console.log("\nPOST /pets with `vaccinated: true` →", ok === null ? "ok" : "FAIL");
