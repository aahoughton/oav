import { readFile, writeFile } from "node:fs/promises";
import {
  formatError,
  type JsonValue,
  type OutputFormat,
  type SchemaOrBoolean,
  type ValidationError,
} from "@oav/core";
import {
  composeReaders,
  createFileReader,
  createHttpReader,
  loadSpec,
  type DocumentReader,
  type SpecOverlay,
} from "@oav/spec";
import { createValidator } from "@oav/validator";
import { emitStandalone, type StandaloneDialect } from "./emit-standalone.js";
import { parseHttpFile } from "./http-parser.js";

/**
 * Input shared by all CLI commands.
 *
 * @public
 */
export interface CommandOptions {
  format: OutputFormat;
  depth?: number;
  output?: string;
  quiet: boolean;
}

/**
 * Output of a command invocation: just the exit code. Commands write
 * their primary output through {@link CommandIo.stdout} (or the file
 * sink when `--output` is set); errors go through
 * {@link CommandIo.stderr}. Nothing is returned for the CLI layer to
 * echo.
 *
 * @public
 */
export interface CommandResult {
  exitCode: number;
}

/**
 * I/O substrate the commands talk to. Defaults to the local
 * filesystem + stdin/stdout/stderr; tests can pass an in-memory
 * substitute that captures writes for assertion.
 *
 * @public
 */
export interface CommandIo {
  reader: DocumentReader;
  readText(pathOrDash: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
  stdout: (chunk: string) => void;
  stderr: (chunk: string) => void;
}

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

/**
 * The real-filesystem {@link CommandIo}, used when callers don't
 * supply one of their own.
 *
 * @public
 */
export function defaultCommandIo(): CommandIo {
  return {
    // File reader first so `./spec.json` resolves locally without a
    // stat against the HTTP reader (which would reject it via
    // canRead anyway, but clearer ordering). HTTP reader accepts
    // `http:` / `https:` URIs; the YAML-over-HTTP story rides on
    // top of this chain in `@aahoughton/oav`'s CLI wrapper, which
    // composes YAML readers in front of whatever we return here.
    reader: composeReaders([createFileReader(), createHttpReader()]),
    async readText(pathOrDash: string) {
      if (pathOrDash === "-") return readAllStdin();
      return readFile(pathOrDash, "utf8");
    },
    async writeText(path: string, content: string) {
      await writeFile(path, content);
    },
    stdout: (chunk) => void process.stdout.write(chunk),
    stderr: (chunk) => void process.stderr.write(chunk),
  };
}

/**
 * Pick the primary output sink for a command:
 * - `--output FILE` → write to file (unconditional; `--quiet` doesn't
 *   suppress a deliberate file write).
 * - else if `--quiet` → swallow.
 * - else → `io.stdout`.
 *
 * Commands write exactly once through this sink, so `-o` naturally
 * redirects the "would go to stdout" content to a file without
 * duplicating it.
 */
function primarySink(
  io: CommandIo,
  opts: { output?: string; quiet: boolean },
): (content: string) => Promise<void> | void {
  if (opts.output !== undefined) {
    const path = opts.output;
    return (content) => io.writeText(path, content);
  }
  if (opts.quiet) return () => {};
  return io.stdout;
}

/**
 * Implement the `oav resolve <spec>` subcommand.
 *
 * @param args - Entry spec path + overlay files + base CLI options.
 * @returns The stitched document (as a CommandResult).
 *
 * @public
 */
export async function resolveCommand(
  args: {
    spec: string;
    overlays: string[];
    options: CommandOptions;
  },
  io: CommandIo = defaultCommandIo(),
): Promise<CommandResult> {
  const overlayDocs = await Promise.all(
    args.overlays.map(async (path) => (await io.reader.read(path)) as SpecOverlay),
  );
  const { document } = await loadSpec({
    reader: io.reader,
    entry: args.spec,
    overlays: overlayDocs,
  });
  const out = JSON.stringify(document, null, 2);
  await primarySink(io, args.options)(out + "\n");
  return { exitCode: 0 };
}

/**
 * Implement the `oav validate <spec> ...` subcommand.
 *
 * @param args - Entry spec, overlays, and one of the mutually-exclusive
 *               validate-what inputs.
 * @returns A validation result with exit code 0 (valid) / 1 (invalid) / 3 (usage).
 *
 * @public
 */
export async function validateCommand(
  args: {
    spec: string;
    overlays: string[];
    mode: ValidateMode;
    options: CommandOptions;
  },
  io: CommandIo = defaultCommandIo(),
): Promise<CommandResult> {
  const overlayDocs = await Promise.all(
    args.overlays.map(async (path) => (await io.reader.read(path)) as SpecOverlay),
  );
  const { document } = await loadSpec({
    reader: io.reader,
    entry: args.spec,
    overlays: overlayDocs,
  });
  const validator = createValidator(document);

  let err: ValidationError | null;
  if (args.mode.kind === "request") {
    const raw = await io.readText(args.mode.file);
    const req = parseHttpFile(raw);
    err = validator.validateRequest(req);
  } else if (args.mode.kind === "bodyForPath") {
    const rawBody = await io.readText(args.mode.body);
    const body = tryJson(rawBody) as JsonValue | undefined;
    err = validator.validateRequest({
      method: args.mode.method,
      path: args.mode.path,
      contentType: "application/json",
      body,
    });
  } else if (args.mode.kind === "responseForPath") {
    const rawBody = await io.readText(args.mode.body);
    const body = tryJson(rawBody) as JsonValue | undefined;
    err = validator.validateResponse(
      { method: args.mode.method, path: args.mode.path },
      { status: args.mode.status, contentType: "application/json", body },
    );
  } else {
    io.stderr("validate: no action specified\n");
    return { exitCode: 3 };
  }

  // Silence on success — no bare-newline leak, matches Unix convention.
  if (err === null) return { exitCode: 0 };
  const rendered = formatError(err, args.options.format, args.options.depth);
  await primarySink(io, args.options)(rendered + "\n");
  return { exitCode: 1 };
}

function tryJson(raw: string): unknown {
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;
  try {
    return JSON.parse(trimmed);
  } catch {
    return raw;
  }
}

/**
 * Mode for the `validate` subcommand.
 *
 * @public
 */
export type ValidateMode =
  | { kind: "request"; file: string }
  | { kind: "bodyForPath"; method: string; path: string; body: string }
  | { kind: "responseForPath"; method: string; path: string; status: number; body: string };

/**
 * Implement the `oav compile <schema>` subcommand. Reads a JSON
 * Schema from disk (or stdin via `-`), emits an ES module whose
 * `validate(data)` mirrors `compileSchema(schema).validate(data)`.
 *
 * By default the emitted module imports runtime helpers from
 * `@aahoughton/oav/core`, `@aahoughton/oav/schema/internals`, and
 * `@aahoughton/oav/formats` — no `new Function()` at the consumer's
 * load time, suitable for edge runtimes that forbid it. Consumers
 * install `@aahoughton/oav` alongside the generated file.
 *
 * With `standalone: true` the emitted module is passed through
 * `esbuild` to inline every runtime helper, producing a bundle with
 * zero imports that runs without `@aahoughton/oav` installed at all
 * — the Lambda / edge / single-file bundling case. `esbuild` is an
 * optional peer dependency; a clear install hint is printed if it's
 * not present.
 *
 * @public
 */
export async function compileCommand(
  args: {
    schema: string;
    output?: string;
    dialect?: StandaloneDialect;
    standalone?: boolean;
    /**
     * Override the `@aahoughton/oav` prefix used in the emitted
     * module's imports. Tests pass `"@oav"` so the output resolves
     * against the in-workspace package aliases rather than the
     * published package name. Not exposed on the CLI.
     */
    importPrefix?: string;
    /**
     * Override esbuild's resolveDir for `--standalone`. Defaults to
     * `process.cwd()`, which is where a real consumer's installed
     * `@aahoughton/oav` sits. Tests point this at
     * `packages/oav/` where the workspace's `@oav/*` symlinks are
     * reachable. Not exposed on the CLI.
     */
    resolveDir?: string;
  },
  io: CommandIo = defaultCommandIo(),
): Promise<CommandResult> {
  const raw = await io.readText(args.schema);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    io.stderr(`compile: ${args.schema} is not valid JSON (${(err as Error).message})\n`);
    return { exitCode: 3 };
  }
  let source: string;
  try {
    source = emitStandalone(parsed as SchemaOrBoolean, {
      dialect: args.dialect ?? "2020-12",
      importPrefix: args.importPrefix,
    });
  } catch (err) {
    io.stderr(`compile: ${(err as Error).message}\n`);
    return { exitCode: 3 };
  }
  if (args.standalone === true) {
    try {
      source = await bundleStandalone(source, args.resolveDir ?? process.cwd());
    } catch (err) {
      io.stderr(`compile: ${(err as Error).message}\n`);
      return { exitCode: 3 };
    }
  }
  if (args.output !== undefined) {
    await io.writeText(args.output, source);
    return { exitCode: 0 };
  }
  io.stdout(source);
  return { exitCode: 0 };
}

/**
 * Bundle an emitted validator with esbuild so it has no external
 * imports. Lazy-imports esbuild so consumers who don't use
 * `--standalone` don't pay the dependency cost. Throws with an
 * install-hint message when esbuild isn't resolvable.
 */
async function bundleStandalone(source: string, resolveDir: string): Promise<string> {
  let esbuild: typeof import("esbuild");
  try {
    esbuild = await import("esbuild");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND") {
      throw new Error(
        "--standalone requires 'esbuild' as a peer dependency.\n" +
          "  Install it alongside @aahoughton/oav, e.g.:\n" +
          "    npm install esbuild\n" +
          "    pnpm add esbuild",
      );
    }
    throw err;
  }
  const result = await esbuild.build({
    stdin: { contents: source, resolveDir, loader: "js" },
    bundle: true,
    format: "esm",
    platform: "neutral",
    write: false,
    logLevel: "silent",
  });
  const out = result.outputFiles[0];
  if (out === undefined) throw new Error("esbuild produced no output");
  return out.text;
}
