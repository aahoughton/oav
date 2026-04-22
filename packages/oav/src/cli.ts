#!/usr/bin/env node
export {};

// `commander` is declared as an optional peer dependency so that
// consumers who only use the programmatic API don't pull it in. That
// means a user could install this package and run `oav` without
// commander present — which would otherwise surface as a cryptic
// ERR_MODULE_NOT_FOUND. Resolve it first and print a clear message;
// the rest of the CLI graph is loaded dynamically so its static
// `import "commander"` only runs after the check passes.
try {
  await import("commander");
} catch (err) {
  if ((err as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND") {
    process.stderr.write(
      "error: the oav CLI requires 'commander'.\n" +
        "  Install it alongside @aahoughton/oav, e.g.:\n" +
        "    npm install commander\n" +
        "    pnpm add commander\n",
    );
    process.exit(2);
  }
  throw err;
}

const { buildProgram, defaultCommandIo } = await import("@oav/cli");
const { composeReaders } = await import("@oav/spec");
const { createYamlFileReader, createYamlHttpReader } = await import("./yaml.js");

// Default I/O composes the YAML readers shipped with this package in
// front of the JSON-only readers baked into @oav/cli's defaultCommandIo,
// so `oav resolve spec.yaml` works out of the box.
const baseIo = defaultCommandIo();
const io = {
  ...baseIo,
  reader: composeReaders([createYamlFileReader(), createYamlHttpReader(), baseIo.reader]),
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
