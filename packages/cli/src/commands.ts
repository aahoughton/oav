import { readFile, writeFile } from "node:fs/promises";
import type { JsonValue, OpenAPIDocument, ValidationError } from "@oav/core";
import {
  composeReaders,
  createFileReader,
  resolveSpec,
  applyOverlays,
  type SpecOverlay,
} from "@oav/spec";
import { createValidator } from "@oav/validator";
import { parseHttpFile } from "./http-parser.js";
import { formatError, type OutputFormat } from "./format-output.js";

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

async function readAllStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

async function readInput(pathOrDash: string): Promise<string> {
  if (pathOrDash === "-") return readAllStdin();
  return readFile(pathOrDash, "utf8");
}

/**
 * Implement the `oav resolve <spec>` subcommand.
 *
 * @param args - Entry spec path + overlay files + base CLI options.
 * @returns The stitched document (as a CommandResult).
 *
 * @public
 */
export async function resolveCommand(args: {
  spec: string;
  overlays: string[];
  options: CommandOptions;
}): Promise<CommandResult> {
  const reader = composeReaders([createFileReader()]);
  const { document } = await resolveSpec({ reader, entry: args.spec });
  const overlayDocs = await Promise.all(
    args.overlays.map(async (path) => JSON.parse(await readFile(path, "utf8")) as SpecOverlay),
  );
  const finalDoc = overlayDocs.length === 0 ? document : applyOverlays(document, overlayDocs);
  const out = JSON.stringify(finalDoc, null, 2);
  if (args.options.output !== undefined) await writeFile(args.options.output, out + "\n");
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
export async function validateCommand(args: {
  spec: string;
  overlays: string[];
  mode: ValidateMode;
  options: CommandOptions;
}): Promise<CommandResult> {
  const reader = composeReaders([createFileReader()]);
  const { document } = await resolveSpec({ reader, entry: args.spec });
  const overlayDocs = await Promise.all(
    args.overlays.map(async (path) => JSON.parse(await readFile(path, "utf8")) as SpecOverlay),
  );
  const finalDoc: OpenAPIDocument =
    overlayDocs.length === 0 ? document : applyOverlays(document, overlayDocs);
  const validator = createValidator(finalDoc);

  let err: ValidationError | null;
  if (args.mode.kind === "request") {
    const raw = await readInput(args.mode.file);
    const req = parseHttpFile(raw);
    err = validator.validateRequest(req);
  } else if (args.mode.kind === "bodyForPath") {
    const rawBody = await readInput(args.mode.body);
    const body = tryJson(rawBody) as JsonValue | undefined;
    err = validator.validateRequest({
      method: args.mode.method,
      path: args.mode.path,
      contentType: "application/json",
      body,
    });
  } else if (args.mode.kind === "responseForPath") {
    const rawBody = await readInput(args.mode.body);
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
  if (args.options.output !== undefined) await writeFile(args.options.output, rendered + "\n");
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
