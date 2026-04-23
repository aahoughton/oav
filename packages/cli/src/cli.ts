import { Command } from "commander";
import { KNOWN_OUTPUT_FORMATS, isOutputFormat, type OutputFormat } from "@oav/core";
import {
  compileSchemaCommand,
  compileSpecCommand,
  defaultCommandIo,
  resolveCommand,
  validateCommand,
  type CommandIo,
  type ValidateMode,
} from "./commands.js";
import type { StandaloneDialect } from "./emit-standalone.js";

const STANDALONE_DIALECTS = ["2020-12", "openapi-3.1", "openapi-3.0"] as const;
function isStandaloneDialect(v: string): v is StandaloneDialect {
  return (STANDALONE_DIALECTS as readonly string[]).includes(v);
}

/**
 * Options accepted by {@link buildProgram}.
 *
 * @public
 */
export interface BuildProgramOptions {
  /**
   * I/O substrate. Defaults to the real filesystem + stdin +
   * process.stdout/stderr via {@link defaultCommandIo}. Tests can pass
   * an in-memory substitute that captures writes for assertion.
   */
  io?: CommandIo;
  /**
   * Exit handler. Defaults to `process.exit`. In-process tests should
   * pass a throwing implementation so the test harness observes the
   * exit code via the rejection and doesn't actually terminate.
   */
  exit?: (code: number) => void;
}

/**
 * Build the Commander program. Exported so tests can invoke the program
 * without spawning a child process; pass `{ io, exit }` to route all
 * side-effects through in-process collaborators. Commands write their
 * primary output through `io.stdout` (or the file sink when `-o` is
 * set) and their errors through `io.stderr` — this CLI layer only
 * handles argv-parsing usage errors + the final `exit` call.
 *
 * @public
 */
export function buildProgram(options: BuildProgramOptions = {}): Command {
  const io = options.io ?? defaultCommandIo();
  const exit = options.exit ?? ((code) => process.exit(code));

  const program = new Command();
  program.name("oav").description("OpenAPI 3.1 HTTP request/response validator").exitOverride();

  program
    .command("resolve <spec>")
    .description("Resolve a (possibly multi-file) OpenAPI document and print the stitched result.")
    .option("--overlay <file...>", "apply one or more overlays in order", collectOverlays, [])
    .option("-o, --output <file>", "write output to a file instead of stdout")
    .option("--quiet", "print nothing; exit code only", false)
    .action(async (spec: string, opts: { overlay: string[]; output?: string; quiet: boolean }) => {
      const res = await resolveCommand(
        {
          spec,
          overlays: opts.overlay ?? [],
          options: {
            format: "text",
            output: opts.output,
            quiet: opts.quiet,
          },
        },
        io,
      );
      exit(res.exitCode);
    });

  program
    .command("validate <spec>")
    .description("Validate a request/response/body against an OpenAPI document.")
    .option("--overlay <file...>", "apply one or more overlays in order", collectOverlays, [])
    .option("--request <file>", "path to a .http file (use '-' for stdin)")
    .option("--path <method-path>", 'e.g. "POST /pets"')
    .option("--body <file>", "body file (use '-' for stdin)")
    .option("--response", "validate a response instead of a request", false)
    .option("--status <code>", "response status code (required when --response)")
    .option(
      "--format <format>",
      KNOWN_OUTPUT_FORMATS.join(" | "),
      (value: string): OutputFormat => {
        if (!isOutputFormat(value)) throw new Error(`unknown format: ${value}`);
        return value;
      },
      "text" as OutputFormat,
    )
    .option("--depth <n>", "truncate error tree depth", (v: string) => Number.parseInt(v, 10))
    .option("-o, --output <file>", "write output to a file instead of stdout")
    .option("--quiet", "print nothing; exit code only", false)
    .action(async (spec: string, opts) => {
      // deriveMode is the only pre-validation step that throws (usage
      // errors). Keep the try narrow so it doesn't also catch the
      // exit() call's in-process throw (tests inject a throwing exit
      // to observe the code without terminating the process).
      let mode: ValidateMode;
      try {
        mode = deriveMode(opts);
      } catch (err) {
        io.stderr(`error: ${(err as Error).message}\n`);
        exit(3);
        return;
      }
      const res = await validateCommand(
        {
          spec,
          overlays: opts.overlay ?? [],
          mode,
          options: {
            format: opts.format as OutputFormat,
            depth: opts.depth,
            output: opts.output,
            quiet: opts.quiet,
          },
        },
        io,
      );
      exit(res.exitCode);
    });

  program
    .command("compile-schema <schema>")
    .description(
      "AOT-compile a JSON Schema to a standalone ES module (zero imports; requires 'esbuild' as a peer dep).",
    )
    .option(
      "--dialect <dialect>",
      STANDALONE_DIALECTS.join(" | "),
      (value: string): StandaloneDialect => {
        if (!isStandaloneDialect(value)) throw new Error(`unknown dialect: ${value}`);
        return value;
      },
      "2020-12" as StandaloneDialect,
    )
    .option("-o, --output <file>", "write output to a file instead of stdout")
    .action(async (schema: string, opts: { dialect: StandaloneDialect; output?: string }) => {
      const res = await compileSchemaCommand(
        {
          schema,
          output: opts.output,
          dialect: opts.dialect,
        },
        io,
      );
      exit(res.exitCode);
    });

  program
    .command("compile-spec <spec>")
    .description(
      "AOT-compile an OpenAPI document to a standalone HTTP validator module (zero imports; requires 'esbuild' as a peer dep).",
    )
    .option("--overlay <file...>", "apply one or more overlays in order", collectOverlays, [])
    .option(
      "--dialect <dialect>",
      STANDALONE_DIALECTS.join(" | "),
      (value: string): StandaloneDialect => {
        if (!isStandaloneDialect(value)) throw new Error(`unknown dialect: ${value}`);
        return value;
      },
    )
    .option("--requests-only", "skip response-validator emit (smaller output)", false)
    .option(
      "--only <method-path...>",
      'restrict emit to specified operations, e.g. --only "POST /pets" "GET /pets/{id}"',
      collectOnly,
      [],
    )
    .option("-o, --output <file>", "write output to a file instead of stdout")
    .action(
      async (
        spec: string,
        opts: {
          overlay: string[];
          dialect?: StandaloneDialect;
          requestsOnly?: boolean;
          only: Array<{ method: string; path: string }>;
          output?: string;
        },
      ) => {
        const res = await compileSpecCommand(
          {
            spec,
            overlays: opts.overlay ?? [],
            output: opts.output,
            dialect: opts.dialect,
            requestsOnly: opts.requestsOnly === true,
            only: opts.only,
          },
          io,
        );
        exit(res.exitCode);
      },
    );

  return program;
}

function collectOnly(
  value: string,
  previous: Array<{ method: string; path: string }>,
): Array<{ method: string; path: string }> {
  const parts = value.trim().split(/\s+/);
  if (parts.length !== 2 || parts[0] === "" || parts[1] === "") {
    throw new Error(`--only expects "METHOD PATH" (space-delimited), got ${JSON.stringify(value)}`);
  }
  return [...previous, { method: parts[0]!.toUpperCase(), path: parts[1]! }];
}

function collectOverlays(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function deriveMode(opts: {
  request?: string;
  path?: string;
  body?: string;
  response?: boolean;
  status?: string;
}): ValidateMode {
  if (opts.request !== undefined) {
    return { kind: "request", file: opts.request };
  }
  if (opts.path !== undefined && opts.body !== undefined) {
    const parts = opts.path.trim().split(/\s+/);
    const method = (parts[0] ?? "GET").toUpperCase();
    const path = parts[1] ?? "/";
    if (opts.response) {
      const status = opts.status !== undefined ? Number.parseInt(opts.status, 10) : Number.NaN;
      if (!Number.isFinite(status)) throw new Error("--response requires --status");
      return { kind: "responseForPath", method, path, status, body: opts.body };
    }
    return { kind: "bodyForPath", method, path, body: opts.body };
  }
  throw new Error(
    "validate: provide either --request <file> or --path <method-path> --body <file>",
  );
}
