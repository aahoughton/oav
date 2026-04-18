#!/usr/bin/env node
import { buildProgram } from "../packages/cli/src/cli.js";

const program = buildProgram();
try {
  await program.parseAsync(process.argv);
} catch (err) {
  process.stderr.write(`error: ${(err as Error).message}\n`);
  process.exit(3);
}
