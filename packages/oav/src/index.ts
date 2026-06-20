/**
 * `oav`: batteries-included distribution. Re-exports the
 * full surface of `oav-core` and adds YAML readers plus a
 * YAML-defaulting `loadSpecSync`, so loading a hand-authored
 * `.yaml` spec works out of the box. (Async `loadSpec` stays in
 * `oav/spec`; compose it with the exported YAML readers for the
 * same.) Also ships the `oav` CLI binary.
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
export {
  createSmartHttpReader,
  createYamlFileReader,
  loadSpecSync,
  parseYamlString,
} from "./yaml.js";
