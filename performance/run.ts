/**
 * Cross-library benchmarks for @oav/schema vs ajv (2020) vs
 * @hyperjump/json-schema (2020-12).
 *
 * Two modes:
 *
 *   - Synthetic (default): iterate over ./schemas.ts and measure
 *     compile + validate with hand-authored valid/invalid inputs.
 *   - Spec (--spec <path>): load an OpenAPI document, extract every
 *     unique request/response body schema, and measure each
 *     library's compile time across the set. Validate is skipped in
 *     this mode because real-world schemas come without paired
 *     valid/invalid fixtures.
 *
 * See ./README.md for details.
 */

import $RefParser from "@apidevtools/json-schema-ref-parser";
import { Bench } from "tinybench";
import Ajv from "ajv/dist/2020.js";
import {
  registerSchema,
  unregisterSchema,
  validate as hjValidate,
} from "@hyperjump/json-schema/draft-2020-12";
import { compileSchema, jsonSchemaDialect } from "../packages/schema/src/index.ts";
import { builtInFormats } from "../packages/formats/src/index.ts";
import { perfSchemas, type PerfSchema } from "./schemas.ts";

const args = process.argv.slice(2);
const filterArg = args.find((a) => a.startsWith("--filter="));
const filter = filterArg?.slice("--filter=".length);
const timeArg = args.find((a) => a.startsWith("--time="));
const time = timeArg ? Number.parseInt(timeArg.slice("--time=".length), 10) : 500;
const specArg = args.find((a) => a.startsWith("--spec="));
const specPath = specArg?.slice("--spec=".length);

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

// tinybench v6's Task.result is a union that includes errored / aborted /
// not-started states with no statistics. Probe for throughput/latency
// instead of dereferencing blindly so one failing task can't take the
// whole script down.
function taskStats(t: { result?: unknown }): { hz: number; mean: number } | null {
  const r = t.result as { throughput?: { mean?: number }; latency?: { mean?: number } } | undefined;
  const hz = r?.throughput?.mean;
  const latency = r?.latency?.mean;
  if (typeof hz !== "number" || typeof latency !== "number") return null;
  return { hz, mean: latency * 1e3 };
}

function taskErrorMessage(t: { result?: unknown }): string | undefined {
  const r = t.result as { error?: { message?: string } } | undefined;
  return r?.error?.message;
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
  const oavOpts = { dialect: jsonSchemaDialect, formats: builtInFormats };
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
    const stats = taskStats(t);
    if (stats === null) {
      const why = taskErrorMessage(t) ?? "no result";
      console.log(`  ${t.name.padEnd(22)}  ERRORED (${why})`);
      continue;
    }
    console.log(
      `  ${t.name.padEnd(22)}  ${fmtHz(stats.hz).padStart(8)} ops/s   ${fmtUs(stats.mean).padStart(10)} / op`,
    );
    results.push({ schema: s.name, metric: "compile", lib, hz: stats.hz, mean: stats.mean });
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
    dialect: jsonSchemaDialect,
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
    const stats = taskStats(t);
    if (stats === null) {
      const why = taskErrorMessage(t) ?? "no result";
      console.log(`  ${t.name.padEnd(30)}  ERRORED (${why})`);
      continue;
    }
    console.log(
      `  ${t.name.padEnd(30)}  ${fmtHz(stats.hz).padStart(8)} ops/s   ${fmtUs(stats.mean).padStart(10)} / op`,
    );
    results.push({
      schema: s.name,
      metric: "validate",
      lib,
      hz: stats.hz,
      mean: stats.mean,
      variant: t.name,
    });
  }

  unregisterSchema(hjUri);
}

/**
 * Pull every request / response body schema out of an OpenAPI document,
 * deduplicating by object identity (which works because
 * @apidevtools/json-schema-ref-parser dereferences `$ref`s to shared
 * references, so schemas reused across operations appear as one).
 */
function extractBodySchemas(doc: unknown): unknown[] {
  const out = new Set<unknown>();
  const paths = (doc as Record<string, unknown>)?.paths as Record<string, unknown> | undefined;
  if (paths === undefined) return [];
  for (const pathItem of Object.values(paths)) {
    if (pathItem === null || typeof pathItem !== "object") continue;
    for (const method of ["get", "post", "put", "patch", "delete", "options", "head", "query"]) {
      const op = (pathItem as Record<string, unknown>)[method];
      if (op === null || typeof op !== "object") continue;
      const reqBody = (op as Record<string, unknown>).requestBody as
        | { content?: Record<string, { schema?: unknown }> }
        | undefined;
      for (const mt of Object.values(reqBody?.content ?? {})) {
        if (mt?.schema !== undefined && mt.schema !== null) out.add(mt.schema);
      }
      const responses = (op as Record<string, unknown>).responses as
        | Record<string, { content?: Record<string, { schema?: unknown }> }>
        | undefined;
      for (const resp of Object.values(responses ?? {})) {
        for (const mt of Object.values(resp?.content ?? {})) {
          if (mt?.schema !== undefined && mt.schema !== null) out.add(mt.schema);
        }
      }
    }
  }
  return [...out];
}

async function benchSpec(path: string): Promise<void> {
  // Use @apidevtools/json-schema-ref-parser to produce a fully
  // dereferenced document. That isolates compile-time comparisons
  // from any resolver differences between libraries and gives ajv /
  // hyperjump / oav an identical input.
  const doc = await $RefParser.dereference(path);
  const schemas = extractBodySchemas(doc);
  console.log(`\n=== Real-world spec: ${path} ===`);
  console.log(`${schemas.length} unique request/response body schemas.`);
  if (schemas.length === 0) return;

  // Per-schema compile timings with plain performance.now(). tinybench's
  // warmup + iteration machinery is overkill at ms scale and across
  // 100+ schemas it blows past anything resembling a reasonable run time.
  const ajvTimes: number[] = [];
  const hjTimes: number[] = [];
  const oavTimes: number[] = [];
  const ajvErrors: string[] = [];
  const hjErrors: string[] = [];
  const oavErrors: string[] = [];

  for (let i = 0; i < schemas.length; i += 1) {
    const schema = schemas[i];

    try {
      const t0 = performance.now();
      // `logger: false` suppresses "unknown format X" warnings that
      // would otherwise flood the output; the schemas use OAS-specific
      // formats (`duration`, `float`) that neither ajv nor
      // ajv-formats recognise by default.
      new Ajv({ allErrors: true, strict: false, logger: false }).compile(schema as never);
      ajvTimes.push(performance.now() - t0);
    } catch (err) {
      ajvErrors.push(err instanceof Error ? err.message : String(err));
    }

    const uri = `bench://spec-${i}`;
    // Spec-derived schemas don't declare `$schema`. Pin 2020-12
    // explicitly so hyperjump doesn't refuse on dialect detection.
    // OAS 3.0 keywords (`nullable`, etc.) will still trip it; those
    // show up as per-schema compile failures, which is accurate: the
    // benchmark is measuring what the library can actually do with
    // the input, not what it could do with a hand-crafted fixture.
    //
    // Hyperjump prints unknown-format warnings to stdout on register.
    // Swallow them so the bench output stays readable.
    const origLog = console.log;
    console.log = () => {};
    try {
      registerSchema(schema as never, uri, "https://json-schema.org/draft/2020-12/schema");
      const t0 = performance.now();
      await hjValidate(uri);
      hjTimes.push(performance.now() - t0);
    } catch (err) {
      hjErrors.push(err instanceof Error ? err.message : String(err));
    } finally {
      console.log = origLog;
      try {
        unregisterSchema(uri);
      } catch {
        // registry state may already be clean; ignore.
      }
    }

    try {
      const t0 = performance.now();
      compileSchema(schema as never, { dialect: jsonSchemaDialect, formats: builtInFormats });
      oavTimes.push(performance.now() - t0);
    } catch (err) {
      oavErrors.push(err instanceof Error ? err.message : String(err));
    }
  }

  const row = (label: string, times: number[], errors: string[]): void => {
    if (times.length === 0) {
      console.log(`  ${label.padEnd(10)}  all ${schemas.length} schemas failed to compile`);
      return;
    }
    const total = times.reduce((a, b) => a + b, 0);
    const max = Math.max(...times);
    const mean = total / times.length;
    const sorted = [...times].sort((a, b) => a - b);
    const p95 = sorted[Math.floor(sorted.length * 0.95)] ?? 0;
    const failed = errors.length;
    const failedTag = failed > 0 ? `  (${failed} failed)` : "";
    console.log(
      `  ${label.padEnd(10)}  total ${fmtUs(total * 1000).padStart(10)}   ` +
        `mean ${fmtUs(mean * 1000).padStart(10)}   ` +
        `p95 ${fmtUs(p95 * 1000).padStart(10)}   ` +
        `max ${fmtUs(max * 1000).padStart(10)}${failedTag}`,
    );
  };

  console.log("compile (per library, aggregated across every schema):");
  row("ajv", ajvTimes, ajvErrors);
  row("hyperjump", hjTimes, hjErrors);
  row("oav", oavTimes, oavErrors);

  for (const [lib, errs] of [
    ["ajv", ajvErrors] as const,
    ["hyperjump", hjErrors] as const,
    ["oav", oavErrors] as const,
  ]) {
    if (errs.length === 0) continue;
    console.log(`\n${lib} compile errors:`);
    const counts = new Map<string, number>();
    for (const e of errs) counts.set(e, (counts.get(e) ?? 0) + 1);
    for (const [msg, count] of [...counts].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
      console.log(`  ${count}×  ${msg.length > 120 ? msg.slice(0, 117) + "…" : msg}`);
    }
    if (counts.size > 5) console.log(`  … and ${counts.size - 5} other distinct error(s)`);
  }

  const pushSpec = (lib: "ajv" | "hyperjump" | "oav", times: number[]): void => {
    if (times.length === 0) return;
    const total = times.reduce((a, b) => a + b, 0);
    results.push({
      schema: path,
      metric: "compile",
      lib,
      hz: times.length / (total / 1000),
      mean: (total / times.length) * 1000,
    });
  };
  pushSpec("ajv", ajvTimes);
  pushSpec("hyperjump", hjTimes);
  pushSpec("oav", oavTimes);
}

if (specPath !== undefined) {
  await benchSpec(specPath);
} else {
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
}

import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const outPath = resolve(dirname(fileURLToPath(import.meta.url)), "results.json");
writeFileSync(outPath, JSON.stringify(results, null, 2));
console.log(`\nRaw numbers written to ${outPath}`);
