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
import { formatKeyword, maxLengthKeyword, minLengthKeyword, patternKeyword } from "./string.js";
import { typeKeyword } from "./type.js";
import type { Vocabulary } from "./types.js";

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
 * URI of the JSON Schema 2020-12 format-annotation vocabulary.
 *
 * @public
 */
export const FORMAT_VOCAB = "https://json-schema.org/draft/2020-12/vocab/format-annotation";

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
 * The built-in format-annotation vocabulary (assertive mode).
 *
 * @public
 */
export const formatVocabulary: Vocabulary = {
  uri: FORMAT_VOCAB,
  keywords: [formatKeyword],
};

/**
 * Convenience: the three default vocabularies (validation + applicator +
 * format-annotation) in the order the compiler expects.
 *
 * @public
 */
export const defaultVocabularies: Vocabulary[] = [
  validationVocabulary,
  applicatorVocabulary,
  formatVocabulary,
];
