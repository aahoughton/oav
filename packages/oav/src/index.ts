/**
 * `oav` — batteries-included distribution. Re-exports the
 * full surface of `oav-core` and adds YAML readers so
 * `loadSpec` works against hand-authored `.yaml` specs out of the
 * box. Also ships the `oav` CLI binary.
 *
 * Consumers who want the zero-runtime-dep version (edge runtimes,
 * JSON-only workloads, minimal bundles) install `oav-core`
 * directly; the surface is the same minus the YAML readers and the
 * CLI.
 *
 * @packageDocumentation
 */

export * from "@oav/validator";
export * from "@oav/core";
export { createSmartHttpReader, createYamlFileReader, parseYamlString } from "./yaml.js";
