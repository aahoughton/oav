// Re-export of `@aahoughton/oav-core/schema`. Build-time alias in
// `tsup.config.ts` rewrites `@oav/schema` → `@aahoughton/oav-core/schema`
// and marks it external so the emitted bundle imports at load time
// rather than bundling the schema compiler.
export * from "@oav/schema";
