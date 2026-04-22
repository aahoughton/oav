import { describe, expect, it } from "vitest";
import { buildProgram } from "../src/cli.js";
import type { CommandIo } from "../src/commands.js";
import { memoryIo } from "./fixtures.js";

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

async function runCli(argv: string[], io: CommandIo): Promise<Captured> {
  const out: Captured = { stdout: "", stderr: "", exitCode: undefined };
  class ExitTrap extends Error {
    constructor(public code: number) {
      super(`exit(${code})`);
    }
  }
  const program = buildProgram({
    io,
    stdout: (c) => {
      out.stdout += c;
    },
    stderr: (c) => {
      out.stderr += c;
    },
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
    const { io } = memoryIo([["spec.json", spec]]);
    const out = await runCli(["resolve", "spec.json"], io);
    expect(out.exitCode).toBe(0);
    const doc = JSON.parse(out.stdout);
    expect(doc.paths["/pets"]).toBeDefined();
  });

  it("validate --path/--body happy path exits 0", async () => {
    const { io } = memoryIo(
      [["spec.json", spec]],
      [["body.json", JSON.stringify({ name: "Fido" })]],
    );
    const out = await runCli(
      ["validate", "spec.json", "--path", "POST /pets", "--body", "body.json"],
      io,
    );
    expect(out.stderr, `stderr: ${out.stderr}`).toBe("");
    expect(out.exitCode).toBe(0);
  });

  it("validate --path/--body failure exits 1 and prints an error", async () => {
    const { io } = memoryIo([["spec.json", spec]], [["body.json", JSON.stringify({})]]);
    const out = await runCli(
      ["validate", "spec.json", "--path", "POST /pets", "--body", "body.json"],
      io,
    );
    expect(out.exitCode).toBe(1);
    expect(out.stdout).toContain("required");
  });

  it("validate without --request or --path is a usage error (exit 3)", async () => {
    const { io } = memoryIo([["spec.json", spec]]);
    const out = await runCli(["validate", "spec.json"], io);
    expect(out.exitCode).toBe(3);
    expect(out.stderr).toContain("provide either --request");
  });

  it("validate --response requires --status", async () => {
    const { io } = memoryIo([["spec.json", spec]], [["body.json", "{}"]]);
    const out = await runCli(
      ["validate", "spec.json", "--path", "POST /pets", "--body", "body.json", "--response"],
      io,
    );
    expect(out.exitCode).toBe(3);
    expect(out.stderr).toContain("--response requires --status");
  });

  it("validate --format rejects unknown formats with a usage error", async () => {
    const { io } = memoryIo([["spec.json", spec]], [["body.json", "{}"]]);
    // Commander surfaces its own error for argument-validator throws; exit 3
    // is driven by our catch block.
    await expect(
      runCli(
        ["validate", "spec.json", "--path", "POST /pets", "--body", "body.json", "--format", "xml"],
        io,
      ),
    ).rejects.toThrow(/unknown format: xml/);
  });

  it("compile emits an ESM module for a JSON Schema to stdout", async () => {
    const schema = { type: "object", required: ["name"], properties: { name: { type: "string" } } };
    const { io } = memoryIo([], [["schema.json", JSON.stringify(schema)]]);
    const out = await runCli(["compile", "schema.json"], io);
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain("export { validate };");
    expect(out.stdout).toContain("import { builtInFormats");
  });

  it("compile -o writes the module to the given path", async () => {
    const schema = { type: "integer" };
    const { io, writes } = memoryIo([], [["schema.json", JSON.stringify(schema)]]);
    const out = await runCli(["compile", "schema.json", "-o", "v.mjs"], io);
    expect(out.exitCode).toBe(0);
    expect(writes).toHaveLength(1);
    expect(writes[0]?.[0]).toBe("v.mjs");
    expect(writes[0]?.[1]).toContain("export { validate };");
  });

  it("compile rejects an unknown --dialect with a usage error", async () => {
    const { io } = memoryIo([], [["schema.json", "{}"]]);
    await expect(runCli(["compile", "schema.json", "--dialect", "draft-07"], io)).rejects.toThrow(
      /unknown dialect: draft-07/,
    );
  });

  it("compile surfaces unknown-format errors on stderr with exit 3", async () => {
    const schema = { type: "string", format: "phone-number" };
    const { io } = memoryIo([], [["schema.json", JSON.stringify(schema)]]);
    const out = await runCli(["compile", "schema.json"], io);
    expect(out.exitCode).toBe(3);
    expect(out.stderr).toContain("phone-number");
    expect(out.stderr).toContain("built-in");
  });
});
