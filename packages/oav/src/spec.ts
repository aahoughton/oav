// Re-export of `@aahoughton/oav-core/spec`. JSON-only readers; the
// YAML readers (`createYamlFileReader`, `createYamlHttpReader`,
// `parseYamlString`) live at the root of `@aahoughton/oav` — compose
// them ahead of the readers in this subpath when loading YAML specs.
export * from "@oav/spec";
