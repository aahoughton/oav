import type { DocumentReader } from "./reader.js";
import { applyOverlays, type SpecOverlay } from "./overlay.js";
import { resolveSpec, type ResolvedSpec } from "./resolver.js";

/**
 * Options accepted by {@link loadSpec}.
 *
 * @public
 */
export interface LoadSpecOptions {
  /** Reader used to fetch documents by URI. */
  reader: DocumentReader;
  /** Entry URI. */
  entry: string;
  /** Base directory/URI for resolving relative refs. Defaults to the entry's directory. */
  baseUri?: string;
  /** Overlays to apply in order after resolution. */
  overlays?: SpecOverlay[];
}

/**
 * Load, resolve, and (optionally) overlay an OpenAPI spec in the one
 * step. Runs `resolveSpec` to inline external `$ref`s, then applies
 * each overlay in order to the resolved document.
 *
 * This is the recommended entrypoint for consumers; use
 * {@link resolveSpec} and {@link applyOverlays} directly only when you
 * need a custom composition.
 *
 * @example
 * ```ts
 * const reader = composeReaders([createFileReader()]);
 * const { document } = await loadSpec({ reader, entry: "openapi.yaml", overlays });
 * const validator = createValidator(document);
 * ```
 *
 * @public
 */
export async function loadSpec(options: LoadSpecOptions): Promise<ResolvedSpec> {
  const resolved = await resolveSpec({
    reader: options.reader,
    entry: options.entry,
    ...(options.baseUri !== undefined && { baseUri: options.baseUri }),
  });
  if (!options.overlays || options.overlays.length === 0) return resolved;
  return {
    document: applyOverlays(resolved.document, options.overlays),
    sources: resolved.sources,
  };
}
