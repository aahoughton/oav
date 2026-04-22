// Re-export of `@aahoughton/oav-core/spec`. JSON-only readers; the
// batteries-included readers (`createYamlFileReader`,
// `createSmartHttpReader`, `parseYamlString`) live at the root of
// `@aahoughton/oav` — compose them ahead of the readers in this
// subpath when loading YAML specs or fetching over HTTP with
// Content-Type dispatch.
export * from "@oav/spec";
