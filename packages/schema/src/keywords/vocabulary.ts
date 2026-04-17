import { maxItemsKeyword, minItemsKeyword, uniqueItemsKeyword } from "./array-validation.js";
import { constKeyword, enumKeyword } from "./equality.js";
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
 * The built-in format-annotation vocabulary (assertive mode).
 *
 * @public
 */
export const formatVocabulary: Vocabulary = {
  uri: FORMAT_VOCAB,
  keywords: [formatKeyword],
};
