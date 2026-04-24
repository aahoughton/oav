// Single source of truth for the vocabulary URIs used by the built-in
// keywords and dialects. Every keyword file's `vocabulary:` field and
// every `Vocabulary.uri` import from here; editing a URI in one place
// keeps everything in sync.

export const CORE_VOCAB = "https://json-schema.org/draft/2020-12/vocab/core";
export const CORE_VALIDATION_VOCAB = "https://json-schema.org/draft/2020-12/vocab/validation";
export const APPLICATOR_VOCAB = "https://json-schema.org/draft/2020-12/vocab/applicator";
export const UNEVALUATED_VOCAB = "https://json-schema.org/draft/2020-12/vocab/unevaluated";
export const FORMAT_VOCAB = "https://json-schema.org/draft/2020-12/vocab/format-annotation";
export const FORMAT_ASSERTION_VOCAB =
  "https://json-schema.org/draft/2020-12/vocab/format-assertion";
export const META_DATA_VOCAB = "https://json-schema.org/draft/2020-12/vocab/meta-data";
export const CONTENT_VOCAB = "https://json-schema.org/draft/2020-12/vocab/content";

// Not a JSON-Schema-spec URI; used only to group the OpenAPI 3.0 keyword set.
export const OAS30_VOCAB = "https://spec.openapis.org/oas/3.0/vocab/schema";

// Not a JSON-Schema-spec URI; groups OpenAPI 3.x annotation keywords
// (`example`, `xml`, `externalDocs`) shared across 3.0 / 3.1 / 3.2.
export const OPENAPI_META_DATA_VOCAB = "https://spec.openapis.org/oas/vocab/meta-data";
