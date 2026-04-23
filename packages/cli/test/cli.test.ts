import { describe, expect, it } from "vitest";
import { buildProgram } from "../src/cli.js";
import { memoryIo, type MemoryIo } from "./fixtures.js";

/**
 * Argv-level coverage of the Commander program. Previously the CLI
 * could only be exercised end-to-end via `pnpm build` + `spawnSync`,
 * so argv wiring (deriveMode, --format validation, exit code 3 for
 * usage errors) had no in-process regression guard.
 */

interface Captured {
  stdout: string;
  stderr: string;
  exitCode: number | undefined;
}

async function runCli(argv: string[], mem: MemoryIo): Promise<Captured> {
  const out: Captured = { stdout: "", stderr: "", exitCode: undefined };
  class ExitTrap extends Error {
    constructor(public code: number) {
      super(`exit(${code})`);
    }
  }
  const program = buildProgram({
    io: mem.io,
    exit: (code) => {
      throw new ExitTrap(code);
    },
  });
  try {
    await program.parseAsync(argv, { from: "user" });
  } catch (err) {
    if (err instanceof ExitTrap) {
      out.exitCode = err.code;
    } else {
      throw err;
    }
  }
  out.stdout = mem.stdout.value;
  out.stderr = mem.stderr.value;
  return out;
}

const spec = {
  openapi: "3.1.0",
  info: { title: "x", version: "1" },
  paths: {
    "/pets": {
      post: {
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: {
                type: "object",
                required: ["name"],
                properties: { name: { type: "string" } },
              },
            },
          },
        },
        responses: { "201": { description: "ok" } },
      },
    },
  },
};

describe("buildProgram — argv-level", () => {
  it("resolve prints the stitched document and exits 0", async () => {
    const mem = memoryIo([["spec.json", spec]]);
    const out = await runCli(["resolve", "spec.json"], mem);
    expect(out.exitCode).toBe(0);
    const doc = JSON.parse(out.stdout);
    expect(doc.paths["/pets"]).toBeDefined();
  });

  it("resolve -o writes to the file and stays silent on stdout", async () => {
    const mem = memoryIo([["spec.json", spec]]);
    const out = await runCli(["resolve", "spec.json", "-o", "resolved.json"], mem);
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toBe("");
    expect(mem.writes).toHaveLength(1);
    expect(mem.writes[0]?.[0]).toBe("resolved.json");
    expect(mem.writes[0]?.[1]).toContain('"openapi"');
  });

  it("validate --path/--body happy path exits 0 and stays silent", async () => {
    const mem = memoryIo([["spec.json", spec]], [["body.json", JSON.stringify({ name: "Fido" })]]);
    const out = await runCli(
      ["validate", "spec.json", "--path", "POST /pets", "--body", "body.json"],
      mem,
    );
    expect(out.stderr, `stderr: ${out.stderr}`).toBe("");
    expect(out.stdout).toBe("");
    expect(out.exitCode).toBe(0);
  });

  it("validate --path/--body failure exits 1 and prints an error", async () => {
    const mem = memoryIo([["spec.json", spec]], [["body.json", JSON.stringify({})]]);
    const out = await runCli(
      ["validate", "spec.json", "--path", "POST /pets", "--body", "body.json"],
      mem,
    );
    expect(out.exitCode).toBe(1);
    expect(out.stdout).toContain("required");
  });

  it("validate without --request or --path is a usage error (exit 3)", async () => {
    const mem = memoryIo([["spec.json", spec]]);
    const out = await runCli(["validate", "spec.json"], mem);
    expect(out.exitCode).toBe(3);
    expect(out.stderr).toContain("provide either --request");
  });

  it("validate --response requires --status", async () => {
    const mem = memoryIo([["spec.json", spec]], [["body.json", "{}"]]);
    const out = await runCli(
      ["validate", "spec.json", "--path", "POST /pets", "--body", "body.json", "--response"],
      mem,
    );
    expect(out.exitCode).toBe(3);
    expect(out.stderr).toContain("--response requires --status");
  });

  it("validate --format rejects unknown formats with a usage error", async () => {
    const mem = memoryIo([["spec.json", spec]], [["body.json", "{}"]]);
    // Commander surfaces its own error for argument-validator throws; exit 3
    // is driven by our catch block.
    await expect(
      runCli(
        ["validate", "spec.json", "--path", "POST /pets", "--body", "body.json", "--format", "xml"],
        mem,
      ),
    ).rejects.toThrow(/unknown format: xml/);
  });

  it("compile-schema rejects an unknown --dialect with a usage error", async () => {
    const mem = memoryIo([], [["schema.json", "{}"]]);
    await expect(
      runCli(["compile-schema", "schema.json", "--dialect", "draft-07"], mem),
    ).rejects.toThrow(/unknown dialect: draft-07/);
  });
});

// The compile-schema command always bundles via esbuild. These tests
// invoke the command directly (not through runCli) so they can override
// the esbuild resolveDir to point at packages/oav/, which has the
// workspace-alias `@oav/*` symlinks. In production the consumer's cwd
// has `@aahoughton/oav` installed and the default resolveDir is
// correct.
describe("compile-schema output", () => {
  it("produces an import-free bundle that runs", async () => {
    const { compileSchemaCommand } = await import("../src/commands.js");
    const { resolve } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const schema = { type: "object", required: ["name"], properties: { name: { type: "string" } } };
    const mem = memoryIo([], [["schema.json", JSON.stringify(schema)]]);
    const resolveDir = resolve(fileURLToPath(new URL("../../oav", import.meta.url)));
    const res = await compileSchemaCommand(
      {
        schema: "schema.json",
        output: "v.mjs",
        dialect: "2020-12",
        importPrefix: "@oav",
        resolveDir,
      },
      mem.io,
    );
    if (res.exitCode !== 0) console.error("stderr:", mem.stderr.value);
    expect(res.exitCode).toBe(0);

    const bundled = mem.writes[0]?.[1] ?? "";
    expect(bundled).not.toMatch(/from\s+["']@aahoughton\/oav/);
    expect(bundled).not.toMatch(/from\s+["']@oav/);
    expect(bundled).toMatch(/\bvalidate\b/);

    const mod = (await import(
      `data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`
    )) as { validate: (d: unknown) => { valid: boolean } };
    expect(mod.validate({ name: "Fido" })).toEqual({ valid: true });
    expect(mod.validate({}).valid).toBe(false);
  });

  it("surfaces unknown-format errors on stderr with exit 3 (before bundle)", async () => {
    const { compileSchemaCommand } = await import("../src/commands.js");
    const schema = { type: "string", format: "phone-number" };
    const mem = memoryIo([], [["schema.json", JSON.stringify(schema)]]);
    const res = await compileSchemaCommand({ schema: "schema.json" }, mem.io);
    expect(res.exitCode).toBe(3);
    expect(mem.stderr.value).toContain("phone-number");
    expect(mem.stderr.value).toContain("built-in");
  });
});
