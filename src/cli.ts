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

const { buildProgram } = await import("../packages/cli/src/cli.js");
const program = buildProgram();
try {
  await program.parseAsync(process.argv);
} catch (err) {
  process.stderr.write(`error: ${(err as Error).message}\n`);
  process.exit(3);
}
