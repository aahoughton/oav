/**
 * Cross-library benchmarks for @oav/schema vs ajv (2020) vs
 * @hyperjump/json-schema (2020-12).
 *
 * Measures two numbers per schema:
 *   - compile: cold-start cost (includes any codegen / parsing)
 *   - validate: steady-state validator invocation (already-compiled)
 *
 * Both with the same realistic schemas in ./schemas.ts, against both
 * valid and invalid inputs so neither path is skipped.
 *
 * Usage:
 *   pnpm tsx performance/run.ts
 *   pnpm tsx performance/run.ts --filter=petstore    # only one schema
 *   pnpm tsx performance/run.ts --iterations=2       # quick smoke
 */

import { Bench } from "tinybench";
import Ajv from "ajv/dist/2020.js";
import {
  registerSchema,
  unregisterSchema,
  validate as hjValidate,
} from "@hyperjump/json-schema/draft-2020-12";
import { compileSchema, defaultVocabularies } from "../packages/schema/src/index.ts";
import { builtInFormats } from "../packages/formats/src/index.ts";
import { perfSchemas, type PerfSchema } from "./schemas.ts";

const args = process.argv.slice(2);
const filterArg = args.find((a) => a.startsWith("--filter="));
const filter = filterArg?.slice("--filter=".length);
const timeArg = args.find((a) => a.startsWith("--time="));
const time = timeArg ? Number.parseInt(timeArg.slice("--time=".length), 10) : 500;

type Result = {
  schema: string;
  metric: "compile" | "validate";
  lib: "ajv" | "hyperjump" | "oav";
  hz: number; // ops/sec
  mean: number; // µs/op
  variant?: string; // full task name (e.g. "oav validate (valid)")
};
const results: Result[] = [];

function fmtHz(hz: number): string {
  if (hz >= 1e6) return (hz / 1e6).toFixed(2) + "M";
  if (hz >= 1e3) return (hz / 1e3).toFixed(1) + "K";
  return hz.toFixed(0);
}
function fmtUs(us: number): string {
  if (us < 1) return (us * 1000).toFixed(2) + "ns";
  if (us < 1000) return us.toFixed(2) + "µs";
  return (us / 1000).toFixed(2) + "ms";
}

async function benchSchema(s: PerfSchema): Promise<void> {
  console.log(`\n=== ${s.name} — ${s.description} ===`);

  // Pre-allocate per-iteration scratch that is NOT part of what we want
  // to measure so the hot loop reduces to the library's work.
  // - Hyperjump caches compiled validators per URI, so we need a fresh
  //   URI per iteration; pre-generate the pool.
  // - Compile options for oav / ajv are identical each iteration, so
  //   hoist them.
  const URI_POOL = 50_000;
  const hjCompileUris = Array.from({ length: URI_POOL }, (_, i) => `bench://c-${s.name}-${i}`);
  let hjCompileIdx = 0;
  const oavOpts = { vocabularies: defaultVocabularies, formats: builtInFormats };
  const ajvFactory = () => new Ajv({ allErrors: true, strict: false });

  // COMPILE BENCH: each task turns a fresh schema object into a callable
  // validator. For ajv that includes `new Ajv()` (it's part of the
  // cold-start cost — a pool of compiled schemas still needs an instance
  // to own them). For hyperjump, `registerSchema` + `validate(uri)`.
  const compileBench = new Bench({ time });
  compileBench
    .add("ajv compile", () => {
      ajvFactory().compile(s.schema);
    })
    .add("hyperjump compile", async () => {
      const uri = hjCompileUris[hjCompileIdx];
      hjCompileIdx += 1;
      if (uri === undefined) throw new Error("uri pool exhausted; raise URI_POOL");
      registerSchema(s.schema, uri);
      try {
        await hjValidate(uri);
      } finally {
        // Registry doesn't need to grow across iterations — unregister keeps
        // registerSchema's cost stable instead of degrading as we add entries.
        unregisterSchema(uri);
      }
    })
    .add("oav compile", () => {
      compileSchema(s.schema as never, oavOpts);
    });

  await compileBench.run();

  console.log("compile:");
  for (const t of compileBench.tasks) {
    const lib = t.name.split(" ")[0] as Result["lib"];
    const hz = t.result?.throughput.mean ?? 0;
    const mean = (t.result?.latency.mean ?? 0) * 1e3; // ms → µs
    console.log(
      `  ${t.name.padEnd(22)}  ${fmtHz(hz).padStart(8)} ops/s   ${fmtUs(mean).padStart(10)} / op`,
    );
    results.push({ schema: s.name, metric: "compile", lib, hz, mean });
  }

  // VALIDATE BENCH: every library pre-compiles its validator OUTSIDE the
  // timed loop; the hot path is just `validator(sample)`. No closure,
  // no modulo, no cursor math — so what we measure is as close as
  // possible to the real production cost of "I already loaded the spec;
  // now validate this one payload".
  const ajv = new Ajv({ allErrors: true, strict: false });
  const ajvValidate = ajv.compile(s.schema);

  const hjUri = `bench://validate-${s.name}`;
  registerSchema(s.schema, hjUri);
  const hjV = await hjValidate(hjUri);

  const oav = compileSchema(s.schema as never, {
    vocabularies: defaultVocabularies,
    formats: builtInFormats,
  });

  // Measure both the happy path (valid) and the failure path (invalid)
  // so nobody gets to win by short-circuiting. Pick one representative
  // sample of each up front — no per-iteration selection work.
  const validSample = s.validInputs[0];
  const invalidSample = s.invalidInputs[0];

  const validateBench = new Bench({ time });
  validateBench
    .add("ajv validate (valid)", () => {
      ajvValidate(validSample);
    })
    .add("ajv validate (invalid)", () => {
      ajvValidate(invalidSample);
    })
    .add("hyperjump validate (valid)", () => {
      hjV(validSample);
    })
    .add("hyperjump validate (invalid)", () => {
      hjV(invalidSample);
    })
    .add("oav validate (valid)", () => {
      oav.validate(validSample);
    })
    .add("oav validate (invalid)", () => {
      oav.validate(invalidSample);
    });
  await validateBench.run();

  console.log("validate:");
  for (const t of validateBench.tasks) {
    const lib = t.name.split(" ")[0] as Result["lib"];
    const hz = t.result?.throughput.mean ?? 0;
    const mean = (t.result?.latency.mean ?? 0) * 1e3;
    console.log(
      `  ${t.name.padEnd(30)}  ${fmtHz(hz).padStart(8)} ops/s   ${fmtUs(mean).padStart(10)} / op`,
    );
    results.push({ schema: s.name, metric: "validate", lib, hz, mean, variant: t.name });
  }

  unregisterSchema(hjUri);
}

const filtered = filter ? perfSchemas.filter((s) => s.name.includes(filter)) : perfSchemas;
for (const s of filtered) await benchSchema(s);

// Relative table: oav ops/sec / ajv ops/sec per row.
console.log("\n=== Relative throughput (vs ajv = 1.00) ===");
console.log(
  "schema".padEnd(14) + "metric".padEnd(20) + "ajv".padEnd(10) + "hyperjump".padEnd(12) + "oav",
);
console.log("-".repeat(70));
const byKey = new Map<string, Record<string, number>>();
for (const r of results) {
  // Distinguish validate-valid vs validate-invalid when we have variants.
  const variantLabel = r.variant ? r.variant.replace(/^\S+\s+/, "") : r.metric;
  const key = `${r.schema}|${variantLabel}`;
  const row = byKey.get(key) ?? {};
  row[r.lib] = r.hz;
  byKey.set(key, row);
}
for (const [key, row] of byKey) {
  const [schema, metric] = key.split("|");
  const ajv = row["ajv"] ?? 0;
  const hj = row["hyperjump"] ?? 0;
  const oav = row["oav"] ?? 0;
  const base = ajv || 1;
  console.log(
    (schema ?? "").padEnd(14) +
      (metric ?? "").padEnd(20) +
      "1.00".padEnd(10) +
      (hj / base).toFixed(2).padEnd(12) +
      (oav / base).toFixed(2),
  );
}

import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const outPath = resolve(dirname(fileURLToPath(import.meta.url)), "results.json");
writeFileSync(outPath, JSON.stringify(results, null, 2));
console.log(`\nRaw numbers written to ${outPath}`);
