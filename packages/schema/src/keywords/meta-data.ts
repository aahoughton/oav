/**
 * The JSON Schema 2020-12 Meta-Data vocabulary. These keywords are
 * annotation-only — they carry human- or tool-facing metadata and emit
 * no runtime validation code. Registering them as first-class keyword
 * definitions (rather than tolerating them as unknown keys) gives the
 * compiler a single source of truth for the set, which the subschema
 * inliner and any future introspection consult via the shared
 * `annotation: true` flag.
 */

import { META_DATA_VOCAB } from "./vocabulary-uris.js";
import type { KeywordDefinition } from "./types.js";

function annotationKeyword(name: string): KeywordDefinition {
  return {
    keyword: name,
    vocabulary: META_DATA_VOCAB,
    annotation: true,
    compile(): void {
      // intentionally empty — pure annotation
    },
  };
}

/**
 * `title` — a short human-readable label for the schema. Annotation-
 * only; emits no validation code. Bundled into
 * {@link metaDataVocabulary} and reachable alongside it from
 * `@aahoughton/oav/schema`.
 *
 * @public
 */
export const titleKeyword = annotationKeyword("title");

/**
 * `description` — a longer human-readable explanation of the schema.
 * Annotation-only; emits no validation code. Pair with
 * {@link titleKeyword} for tooling that displays a label plus details.
 *
 * @public
 */
export const descriptionKeyword = annotationKeyword("description");

/**
 * `default` — a suggested default value for the schema. Preserved as
 * metadata only; oav never injects defaults into request bodies or
 * response bodies (see the `useDefaults` discussion in
 * [`COMPARISON.md`](../../../COMPARISON.md) if you need that behaviour).
 *
 * @public
 */
export const defaultKeyword = annotationKeyword("default");

/**
 * `deprecated` — marks a schema (most often a single property) as
 * deprecated. Annotation-only: deprecated values are not rejected at
 * runtime. Tooling and generated clients use it to surface warnings.
 *
 * @public
 */
export const deprecatedKeyword = annotationKeyword("deprecated");

/**
 * `readOnly` — flags a property the client MUST NOT send on request
 * bodies. Annotation-only inside the schema compiler; the validator's
 * request-side body transform consults it and rewrites such properties
 * to `false` on request-direction schemas. Companion to
 * {@link writeOnlyKeyword}.
 *
 * @public
 */
export const readOnlyKeyword = annotationKeyword("readOnly");

/**
 * `writeOnly` — flags a property the server MUST NOT send on response
 * bodies. Annotation-only inside the schema compiler; the validator's
 * response-side body transform consults it and rewrites such properties
 * to `false` on response-direction schemas. Companion to
 * {@link readOnlyKeyword}.
 *
 * @public
 */
export const writeOnlyKeyword = annotationKeyword("writeOnly");

/**
 * `examples` — an array of example values the schema author supplies
 * for documentation and tooling. Annotation-only; emits no validation
 * code. Supersedes OpenAPI 3.0's singular {@link exampleKeyword}.
 *
 * @public
 */
export const examplesKeyword = annotationKeyword("examples");

/**
 * OpenAPI-specific annotation: `example` (singular). Deprecated in
 * favour of `examples` per OpenAPI 3.1, still widely used in 3.0 specs.
 *
 * @public
 */
export const exampleKeyword = annotationKeyword("example");
