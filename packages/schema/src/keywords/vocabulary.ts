import { maxItemsKeyword, minItemsKeyword, uniqueItemsKeyword } from "./array-validation.js";
import {
  allOfKeyword,
  anyOfKeyword,
  dependentRequiredKeyword,
  dependentSchemasKeyword,
  ifThenElseKeyword,
  notKeyword,
  oneOfKeyword,
} from "./composition.js";
import { constKeyword, enumKeyword } from "./equality.js";
import { containsKeyword, itemsKeyword, prefixItemsKeyword } from "./items.js";
import {
  exclusiveMaximumKeyword,
  exclusiveMinimumKeyword,
  maximumKeyword,
  minimumKeyword,
  multipleOfKeyword,
} from "./number.js";
import {
  maxPropertiesKeyword,
  minPropertiesKeyword,
  requiredKeyword,
} from "./object-validation.js";
import {
  additionalPropertiesKeyword,
  patternPropertiesKeyword,
  propertiesKeyword,
  propertyNamesKeyword,
} from "./properties.js";
import {
  anchorKeyword,
  commentKeyword,
  defsKeyword,
  dynamicAnchorKeyword,
  dynamicRefKeyword,
  idKeyword,
  refKeyword,
  schemaDialectKeyword,
} from "./ref.js";
import {
  discriminatorKeyword,
  unevaluatedItemsKeyword,
  unevaluatedPropertiesKeyword,
} from "./unevaluated.js";
import {
  formatAssertionKeyword,
  formatKeyword,
  maxLengthKeyword,
  minLengthKeyword,
  patternKeyword,
} from "./string.js";
import { typeKeyword } from "./type.js";
import type { Vocabulary } from "./types.js";

/**
 * URI of the JSON Schema 2020-12 core vocabulary.
 *
 * @public
 */
export const CORE_VOCAB = "https://json-schema.org/draft/2020-12/vocab/core";

/**
 * URI of the core JSON Schema 2020-12 validation vocabulary.
 *
 * @public
 */
export const CORE_VALIDATION_VOCAB = "https://json-schema.org/draft/2020-12/vocab/validation";

/**
 * URI of the core JSON Schema 2020-12 applicator vocabulary.
 *
 * @public
 */
export const APPLICATOR_VOCAB = "https://json-schema.org/draft/2020-12/vocab/applicator";

/**
 * URI of the JSON Schema 2020-12 unevaluated vocabulary.
 *
 * @public
 */
export const UNEVALUATED_VOCAB = "https://json-schema.org/draft/2020-12/vocab/unevaluated";

/**
 * URI of the JSON Schema 2020-12 format-annotation vocabulary.
 *
 * @public
 */
export const FORMAT_VOCAB = "https://json-schema.org/draft/2020-12/vocab/format-annotation";

/**
 * URI of the JSON Schema 2020-12 format-assertion vocabulary. Opt-in:
 * when placed before {@link FORMAT_VOCAB} in the vocabularies list,
 * `format` becomes an assertion instead of an annotation.
 *
 * @public
 */
export const FORMAT_ASSERTION_VOCAB =
  "https://json-schema.org/draft/2020-12/vocab/format-assertion";

/**
 * The JSON Schema 2020-12 core vocabulary: `$ref`, `$dynamicRef`, `$id`,
 * `$defs`, anchors, etc. No runtime behavior except `$ref` / `$dynamicRef`.
 *
 * @public
 */
export const coreVocabulary: Vocabulary = {
  uri: CORE_VOCAB,
  keywords: [
    refKeyword,
    dynamicRefKeyword,
    anchorKeyword,
    dynamicAnchorKeyword,
    idKeyword,
    defsKeyword,
    schemaDialectKeyword,
    commentKeyword,
  ],
};

/**
 * The built-in validation vocabulary: `type`, `enum`, `const`, numeric
 * bounds, string bounds, array bounds, and `required`. Applicator keywords
 * live in a separate vocabulary.
 *
 * @public
 */
export const validationVocabulary: Vocabulary = {
  uri: CORE_VALIDATION_VOCAB,
  keywords: [
    typeKeyword,
    enumKeyword,
    constKeyword,
    multipleOfKeyword,
    maximumKeyword,
    exclusiveMaximumKeyword,
    minimumKeyword,
    exclusiveMinimumKeyword,
    maxLengthKeyword,
    minLengthKeyword,
    patternKeyword,
    maxItemsKeyword,
    minItemsKeyword,
    uniqueItemsKeyword,
    maxPropertiesKeyword,
    minPropertiesKeyword,
    requiredKeyword,
  ],
};

/**
 * The built-in applicator vocabulary: composition keywords that recurse into
 * subschemas.
 *
 * @public
 */
export const applicatorVocabulary: Vocabulary = {
  uri: APPLICATOR_VOCAB,
  keywords: [
    discriminatorKeyword,
    allOfKeyword,
    anyOfKeyword,
    oneOfKeyword,
    notKeyword,
    ifThenElseKeyword,
    dependentSchemasKeyword,
    dependentRequiredKeyword,
    prefixItemsKeyword,
    itemsKeyword,
    containsKeyword,
    propertiesKeyword,
    patternPropertiesKeyword,
    additionalPropertiesKeyword,
    propertyNamesKeyword,
  ],
};

/**
 * The built-in unevaluated vocabulary: `unevaluatedProperties` /
 * `unevaluatedItems`.
 *
 * @public
 */
export const unevaluatedVocabulary: Vocabulary = {
  uri: UNEVALUATED_VOCAB,
  keywords: [unevaluatedPropertiesKeyword, unevaluatedItemsKeyword],
};

/**
 * The built-in format-annotation vocabulary. Non-assertive per the spec
 * default — use {@link formatAssertionVocabulary} to make `format`
 * actually reject data.
 *
 * @public
 */
export const formatVocabulary: Vocabulary = {
  uri: FORMAT_VOCAB,
  keywords: [formatKeyword],
};

/**
 * Opt-in format-assertion vocabulary. Place BEFORE {@link formatVocabulary}
 * in the vocabularies list so its assertive `format` keyword wins keyword
 * dispatch.
 *
 * @public
 */
export const formatAssertionVocabulary: Vocabulary = {
  uri: FORMAT_ASSERTION_VOCAB,
  keywords: [formatAssertionKeyword],
};

/**
 * Convenience: the three default vocabularies (validation + applicator +
 * format-annotation) in the order the compiler expects.
 *
 * @public
 */
export const defaultVocabularies: Vocabulary[] = [
  coreVocabulary,
  validationVocabulary,
  applicatorVocabulary,
  unevaluatedVocabulary,
  formatVocabulary,
];
