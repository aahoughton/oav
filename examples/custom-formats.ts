/**
 * Custom formats: register a string format (here, E.164 phone numbers)
 * and have it enforced alongside the built-ins. A format is any
 * `(value: string) => boolean`; merged on top of
 * `@aahoughton/oav/formats`' defaults at validator-construction time.
 *
 * Run from the repo root:
 *   pnpm tsx examples/custom-formats.ts
 */

import type { OpenAPIDocument } from "../packages/core/src/index.ts";
import { formatText } from "../packages/core/src/index.ts";
import { createValidator } from "../packages/validator/src/index.ts";

const spec: OpenAPIDocument = {
  openapi: "3.1.0",
  info: { title: "Contacts", version: "1" },
  paths: {
    "/contacts": {
      post: {
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["phone"],
                properties: {
                  phone: { type: "string", format: "e164-phone" },
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

const e164 = (s: string): boolean => /^\+[1-9]\d{6,14}$/.test(s);

const v = createValidator(spec, {
  formats: { "e164-phone": e164 },
});

const ok = v.validateRequest({
  method: "POST",
  path: "/contacts",
  contentType: "application/json",
  body: { phone: "+14155550123" },
});
console.log("+14155550123 →", ok === null ? "ok" : "FAIL");

const bad = v.validateRequest({
  method: "POST",
  path: "/contacts",
  contentType: "application/json",
  body: { phone: "415-555-0123" }, // not E.164
});
if (bad !== null) {
  console.log("\n415-555-0123:\n" + formatText(bad));
}
