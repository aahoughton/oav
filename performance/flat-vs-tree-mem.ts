/**
 * Quick retained-memory comparison of tree mode vs flat mode (#314) on
 * a broadly-invalid large array. Run:
 *   node --expose-gc --import tsx flat-vs-tree-mem.ts
 *
 * Both modes collect every error (maxErrors: Infinity); the cap is the
 * real memory lever, this isolates the per-error cost of the two shapes.
 *
 * Headline finding (N=200000, 1.2M errors): tree retains ~505MB vs flat
 * ~396MB, so the tree shape is ~28% heavier per error. Both retain
 * hundreds of MB at this scale; neither is free.
 */
import { compileSchema, jsonSchemaDialect } from "../packages/schema/src/index.ts";
import type { SchemaOrBoolean } from "../packages/core/src/index.ts";

const SCHEMA = {
  type: "array",
  items: {
    type: "object",
    required: ["id", "name"],
    properties: {
      id: { type: "integer", minimum: 1 },
      name: { type: "string", minLength: 1 },
      tags: { type: "array", items: { type: "string" } },
    },
    additionalProperties: false,
  },
};

const N = Number.parseInt(process.env.LP_N ?? "200000", 10);

function buildInvalid(n: number): unknown[] {
  const out = new Array(n);
  for (let i = 0; i < n; i += 1) out[i] = { id: `oops-${i}`, tags: [1, 2, 3], extra: true };
  return out;
}

const gc = (globalThis as { gc?: () => void }).gc ?? (() => {});
function heapMB(): number {
  gc();
  gc();
  return process.memoryUsage().heapUsed / 1024 / 1024;
}

function countLeaves(node: { children: unknown[] }): number {
  // tree: count leaves recursively
  let n = 0;
  const stack: Array<{ children: unknown[] }> = [node];
  while (stack.length > 0) {
    const x = stack.pop()!;
    if (x.children.length === 0) n += 1;
    else for (const c of x.children) stack.push(c as { children: unknown[] });
  }
  return n;
}

// Isolate each mode in its own process (MODE=tree|flat) so a result is
// the only thing retained beyond the shared data; cross-mode reclaim
// can't undercount.
function main(): void {
  if ((globalThis as { gc?: () => void }).gc === undefined) {
    console.warn("warning: run with --expose-gc for meaningful deltas\n");
  }
  const mode = process.env.MODE ?? "tree";
  const data = buildInvalid(N);
  const schema = SCHEMA as SchemaOrBoolean;
  const v =
    mode === "flat"
      ? compileSchema(schema, {
          dialect: jsonSchemaDialect,
          output: "flat",
          maxErrors: Number.POSITIVE_INFINITY,
        })
      : compileSchema(schema, {
          dialect: jsonSchemaDialect,
          output: "tree",
          maxErrors: Number.POSITIVE_INFINITY,
        });
  const baseline = heapMB(); // data held, no result
  const res = v.validate(data) as {
    valid: boolean;
    error?: { children: unknown[] };
    errors?: unknown[];
  };
  const retained = heapMB() - baseline;
  const count =
    mode === "flat" ? (res.errors?.length ?? 0) : res.error ? countLeaves(res.error) : 0;
  // keep res alive past the measurement
  if (!res.valid && count < 0) throw new Error("unreachable");
  console.log(
    `MODE=${mode} N=${N}: baseline=${baseline.toFixed(1)}MB retained=${retained.toFixed(1)}MB items=${count}`,
  );
}

main();
