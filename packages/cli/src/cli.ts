import { Command } from "commander";
import { resolveCommand, validateCommand, type ValidateMode } from "./commands.js";
import type { OutputFormat } from "./format-output.js";

/**
 * Build the Commander program. Exported so tests can invoke the program
 * without spawning a child process.
 *
 * @public
 */
export function buildProgram(): Command {
  const program = new Command();
  program.name("oav").description("OpenAPI 3.1 HTTP request/response validator").exitOverride();

  program
    .command("resolve <spec>")
    .description("Resolve a (possibly multi-file) OpenAPI document and print the stitched result.")
    .option("--overlay <file...>", "apply one or more overlays in order", collectOverlays, [])
    .option("-o, --output <file>", "write output to a file instead of stdout")
    .option("--quiet", "print nothing; exit code only", false)
    .action(async (spec: string, opts: { overlay: string[]; output?: string; quiet: boolean }) => {
      const res = await resolveCommand({
        spec,
        overlays: opts.overlay ?? [],
        options: {
          format: "text",
          output: opts.output,
          quiet: opts.quiet,
        },
      });
      if (res.output !== undefined && !opts.quiet) process.stdout.write(res.output + "\n");
      process.exit(res.exitCode);
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
      "text | json | flat | github",
      (value: string): OutputFormat => {
        if (value !== "text" && value !== "json" && value !== "flat" && value !== "github") {
          throw new Error(`unknown format: ${value}`);
        }
        return value;
      },
      "text" as OutputFormat,
    )
    .option("--depth <n>", "truncate error tree depth", (v: string) => Number.parseInt(v, 10))
    .option("-o, --output <file>", "write output to a file instead of stdout")
    .option("--quiet", "print nothing; exit code only", false)
    .action(async (spec: string, opts) => {
      try {
        const mode = deriveMode(opts);
        const res = await validateCommand({
          spec,
          overlays: opts.overlay ?? [],
          mode,
          options: {
            format: opts.format as OutputFormat,
            depth: opts.depth,
            output: opts.output,
            quiet: opts.quiet,
          },
        });
        if (res.output !== undefined && !opts.quiet && res.output !== "") {
          process.stdout.write(res.output + "\n");
        }
        process.exit(res.exitCode);
      } catch (err) {
        process.stderr.write(`error: ${(err as Error).message}\n`);
        process.exit(3);
      }
    });

  return program;
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
