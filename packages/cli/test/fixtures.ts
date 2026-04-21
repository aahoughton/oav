import { createMemoryReader, type DocumentReader } from "@oav/spec";
import type { CommandIo } from "../src/commands.js";

/**
 * Shared helpers for the CLI test suite. The two callers
 * (`cli.test.ts` argv coverage, `commands.test.ts` in-process coverage)
 * both need a `CommandIo` wired to in-memory documents, text files, and
 * a write sink — factored out here so the helpers can't drift.
 */

export interface MemoryIo {
  io: CommandIo;
  writes: Array<[string, string]>;
  textMap: Map<string, string>;
}

export function memoryIo(
  entries: Array<[string, unknown]>,
  textFiles: Array<[string, string]> = [],
): MemoryIo {
  const reader: DocumentReader = createMemoryReader(new Map(entries));
  const textMap = new Map(textFiles);
  const writes: Array<[string, string]> = [];
  return {
    io: {
      reader,
      async readText(path: string) {
        const hit = textMap.get(path);
        if (hit === undefined) throw new Error(`missing text file: ${path}`);
        return hit;
      },
      async writeText(path: string, content: string) {
        writes.push([path, content]);
      },
    },
    writes,
    textMap,
  };
}
