/**
 * Bounded error collection: compare the default exhaustive mode with
 * `maxErrors: 1` (classic fast-fail) and `maxErrors: 3` (bounded) on
 * the same invalid payload. Hot loops short-circuit once the budget
 * is exhausted, so a huge invalid array doesn't cost proportional CPU.
 *
 * Run from the repo root:
 *   pnpm tsx examples/max-errors.ts
 */

import type { OpenAPIDocument } from "../packages/core/src/index.ts";
import { collectLeaves } from "../packages/core/src/index.ts";
import { createValidator } from "../packages/validator/src/index.ts";

const spec: OpenAPIDocument = {
  openapi: "3.1.0",
  info: { title: "Bulk", version: "1" },
  paths: {
    "/items": {
      post: {
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "array",
                items: {
                  type: "object",
                  required: ["id"],
                  properties: { id: { type: "integer" } },
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

// 50 array items, all missing the required `id` field.
const bulk = Array.from({ length: 50 }, () => ({ name: "whatever" }));

const runAndCount = (label: string, maxErrors: number | undefined): void => {
  const v = createValidator(spec, maxErrors === undefined ? {} : { maxErrors });
  const start = performance.now();
  const err = v.validateRequest({
    method: "POST",
    path: "/items",
    contentType: "application/json",
    body: bulk,
  });
  const ms = performance.now() - start;
  const leafCount = err === null ? 0 : collectLeaves(err).length;
  console.log(
    `${label.padEnd(20)} leaves=${String(leafCount).padStart(3)}  time=${ms.toFixed(2)}ms`,
  );
};

runAndCount("uncapped (default)", undefined);
runAndCount("fast-fail (1)", 1);
runAndCount("bounded (3)", 3);
runAndCount("bounded (10)", 10);
