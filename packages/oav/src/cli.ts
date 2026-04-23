#!/usr/bin/env node
export {};

// `commander` and `esbuild` are declared as optional peer dependencies
// so programmatic-API consumers don't pull them in. Running `oav`
// without either would otherwise surface as a cryptic
// ERR_MODULE_NOT_FOUND. Resolve them up front and print a clear
// message; the rest of the CLI graph loads dynamically so its static
// `import` only runs after the check passes.
//
// `esbuild` is only touched by `compile-schema` / `compile-spec`, but
// checking it up front keeps the error surface consistent — a user
// who wants the CLI at all gets one install hint, not two different
// failure modes depending on which subcommand they pick.
for (const { name, purpose } of [
  { name: "commander", purpose: "argv parsing" },
  { name: "esbuild", purpose: "AOT compile-schema / compile-spec bundling" },
] as const) {
  try {
    await import(name);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND") {
      process.stderr.write(
        `error: the oav CLI requires '${name}' (${purpose}).\n` +
          "  Install it alongside @aahoughton/oav, e.g.:\n" +
          `    npm install ${name}\n` +
          `    pnpm add ${name}\n`,
      );
      process.exit(2);
    }
    throw err;
  }
}

const { buildProgram, defaultCommandIo } = await import("@oav/cli");
const { composeReaders } = await import("@oav/spec");
const { createSmartHttpReader, createYamlFileReader } = await import("./yaml.js");

// Default I/O composes the readers shipped with this package in
// front of the JSON-only readers baked into @oav/cli's defaultCommandIo,
// so `oav resolve spec.yaml` and `oav resolve https://host/openapi`
// work out of the box. createSmartHttpReader handles both JSON and
// YAML over HTTP by inspecting Content-Type — it replaces the core
// createHttpReader in the chain for any http(s) URI.
const baseIo = defaultCommandIo();
const io = {
  ...baseIo,
  reader: composeReaders([createYamlFileReader(), createSmartHttpReader(), baseIo.reader]),
};
const program = buildProgram({ io });
try {
  await program.parseAsync(process.argv);
} catch (err) {
  // `buildProgram` wires `exitOverride()` so Commander throws rather
  // than calling `process.exit` directly. That includes "success"
  // exits like `--help` / `--version` (exitCode 0) and argv parse
  // errors (non-zero). Honor the attached exitCode when present
  // rather than surfacing these as exit 3.
  const e = err as { code?: string; exitCode?: number; message?: string };
  if (
    typeof e.exitCode === "number" &&
    typeof e.code === "string" &&
    e.code.startsWith("commander.")
  ) {
    process.exit(e.exitCode);
  }
  process.stderr.write(`error: ${(err as Error).message}\n`);
  process.exit(3);
}
