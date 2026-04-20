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

/** @public */ export const titleKeyword = annotationKeyword("title");
/** @public */ export const descriptionKeyword = annotationKeyword("description");
/** @public */ export const defaultKeyword = annotationKeyword("default");
/** @public */ export const deprecatedKeyword = annotationKeyword("deprecated");
/** @public */ export const readOnlyKeyword = annotationKeyword("readOnly");
/** @public */ export const writeOnlyKeyword = annotationKeyword("writeOnly");
/** @public */ export const examplesKeyword = annotationKeyword("examples");

/**
 * OpenAPI-specific annotation: `example` (singular). Deprecated in
 * favour of `examples` per OpenAPI 3.1, still widely used in 3.0 specs.
 *
 * @public
 */
export const exampleKeyword = annotationKeyword("example");
