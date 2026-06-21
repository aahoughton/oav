/**
 * Bridge an OpenAPI document to a streaming body validator.
 *
 * The stream validator validates one *resolved* schema; routing, content
 * negotiation, and body-schema lookup stay the caller's job (the same
 * split the framework adapters keep). The steps: resolve the spec, pick
 * the operation your router matched, pull its request-body schema, and
 * hand that schema to `createStreamValidator`.
 *
 * The one gotcha: a body schema is usually an internal `$ref`
 * (`#/components/schemas/Pet`). The engine resolves refs against the
 * schema you pass it, not against the original document, so you must
 * carry the document's ref container (`components`) alongside the body
 * schema. Omit it and construction throws `unresolvable $ref` before any
 * byte streams.
 *
 * Translation to the published packages: `resolveSpec` from
 * `@aahoughton/oav-core/spec`, `createStreamValidator` from
 * `@aahoughton/oav-stream-validator`. See ./README.md.
 *
 * Run from the repo root:
 *   pnpm dlx tsx examples/stream-from-spec.ts
 */

import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import type { SchemaObject } from "../packages/core/src/index.ts";
import { createYamlFileReader } from "../packages/oav/src/yaml.ts";
import { resolveSpec } from "../packages/spec/src/index.ts";
import {
  createStreamValidator,
  ValidationFailedError,
} from "../packages/stream-validator/src/index.ts";

const specPath = fileURLToPath(new URL("./specs/petstore.yaml", import.meta.url));
const { document } = await resolveSpec({ reader: createYamlFileReader(), entry: specPath });

// Your router selects the operation; here we hardcode POST /pets. Its
// request body schema is `{ $ref: "#/components/schemas/Pet" }`.
const op = document.paths?.["/pets"]?.post;
const body = op?.requestBody;
if (body === undefined || "$ref" in body) throw new Error("expected an inline requestBody");
const bodySchema = body.content["application/json"]?.schema;
if (bodySchema === undefined || typeof bodySchema === "boolean") {
  throw new Error("expected a JSON body schema");
}

// --- The footgun: a `$ref` with no ref container ----------------------------
try {
  createStreamValidator(bodySchema, { openApiVersion: "3.1" });
  console.log("without components → constructed (unexpected!)");
} catch (err) {
  console.log("without components → throws at construction:");
  console.log("  " + (err as Error).message);
}

// --- The fix: carry `components` so `#/components/schemas/Pet` resolves -----
const schema: SchemaObject = { ...bodySchema, components: document.components } as SchemaObject;

// Drain the echoed bytes; a real caller would forward them to storage.
const drain = async (src: AsyncIterable<Buffer>): Promise<void> => {
  for await (const _ of src) {
    /* discard */
  }
};

async function streamPet(label: string, pet: unknown): Promise<void> {
  const validator = createStreamValidator(schema, { openApiVersion: "3.1" });
  try {
    await pipeline(Readable.from(JSON.stringify(pet)), validator, drain);
    console.log(`${label} → ok`);
  } catch (err) {
    if (err instanceof ValidationFailedError) {
      const v = err.verdict.violations[0];
      const where = v?.path.length ? "/" + v.path.join("/") : "(root)";
      console.log(`${label} → rejected: ${v?.code} at ${where}`);
    } else {
      throw err;
    }
  }
}

console.log();
await streamPet("valid Pet        ", { name: "Fido", tag: "dog" });
await streamPet("Pet missing name ", { tag: "dog" });
