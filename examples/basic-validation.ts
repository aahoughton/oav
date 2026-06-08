/**
 * Basic HTTP validation: load a petstore spec from disk, build a
 * validator, and check one valid + one invalid request, then a response.
 *
 * Run from the repo root:
 *   pnpm tsx examples/basic-validation.ts
 */

import { fileURLToPath } from "node:url";
import { formatText } from "../packages/core/src/index.ts";
import { createYamlFileReader } from "../packages/oav/src/yaml.ts";
import { loadSpec } from "../packages/spec/src/index.ts";
import { createValidator } from "../packages/validator/src/index.ts";

const specPath = fileURLToPath(new URL("./specs/petstore.yaml", import.meta.url));
const { document } = await loadSpec({ reader: createYamlFileReader(), entry: specPath });
const v = createValidator(document);

const valid = v.validateRequest({
  method: "POST",
  path: "/pets",
  contentType: "application/json",
  body: { name: "Fido", tag: "dog" },
});
console.log("valid request →", valid.valid ? "ok" : "FAIL");

const bad = v.validateRequest({
  method: "POST",
  path: "/pets",
  contentType: "application/json",
  body: { tag: "dog" }, // missing required `name`
});
if (!bad.valid) {
  console.log("\ninvalid request:\n" + formatText(bad.errors));
}

const responseErr = v.validateResponse(
  { method: "POST", path: "/pets", body: { name: "Fido" }, contentType: "application/json" },
  { status: 201 },
);
console.log("\nresponse (201, no body) →", responseErr.valid ? "ok" : "FAIL");
