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
 * Output of a command invocation: the exit code + optional rendered text.
 *
 * @public
 */
export interface CommandResult {
  exitCode: number;
  output?: string;
}

/**
 * I/O substrate the commands talk to. Defaults to the local
 * filesystem + stdin; tests can pass an in-memory substitute.
 *
 * @public
 */
export interface CommandIo {
  reader: DocumentReader;
  readText(pathOrDash: string): Promise<string>;
  writeText(path: string, content: string): Promise<void>;
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
    reader: composeReaders([createFileReader()]),
    async readText(pathOrDash: string) {
      if (pathOrDash === "-") return readAllStdin();
      return readFile(pathOrDash, "utf8");
    },
    async writeText(path: string, content: string) {
      await writeFile(path, content);
    },
  };
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
  if (args.options.output !== undefined) await io.writeText(args.options.output, out + "\n");
  return { exitCode: 0, output: args.options.quiet ? undefined : out };
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
    return { exitCode: 3, output: "validate: no action specified" };
  }

  if (err === null) return { exitCode: 0, output: args.options.quiet ? undefined : "" };
  const rendered = formatError(err, args.options.format, args.options.depth);
  if (args.options.output !== undefined) await io.writeText(args.options.output, rendered + "\n");
  return { exitCode: 1, output: args.options.quiet ? undefined : rendered };
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
 * The emitted module imports the runtime helpers from
 * `@aahoughton/oav/core`, `@aahoughton/oav/schema/internals`, and
 * `@aahoughton/oav/formats` — no `new Function()` at the consumer's
 * load time, suitable for edge runtimes that forbid it.
 *
 * @public
 */
export async function compileCommand(
  args: {
    schema: string;
    output?: string;
    dialect?: StandaloneDialect;
  },
  io: CommandIo = defaultCommandIo(),
): Promise<CommandResult> {
  const raw = await io.readText(args.schema);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      exitCode: 3,
      output: `compile: ${args.schema} is not valid JSON (${(err as Error).message})`,
    };
  }
  let source: string;
  try {
    source = emitStandalone(parsed as SchemaOrBoolean, { dialect: args.dialect ?? "2020-12" });
  } catch (err) {
    return { exitCode: 3, output: `compile: ${(err as Error).message}` };
  }
  if (args.output !== undefined) {
    await io.writeText(args.output, source);
    return { exitCode: 0 };
  }
  return { exitCode: 0, output: source };
}
