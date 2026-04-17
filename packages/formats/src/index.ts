export { validateDate, validateDateTime, validateDuration, validateTime } from "./date.js";
export { validateEmail, validateIdnEmail } from "./email.js";
export { validateHostname, validateIdnHostname } from "./hostname.js";
export { validateIpv4, validateIpv6 } from "./ip.js";
export { validateRegex, validateUuid } from "./misc.js";
export {
  validateIri,
  validateIriReference,
  validateJsonPointer,
  validateRelativeJsonPointer,
  validateUri,
  validateUriReference,
  validateUriTemplate,
} from "./uri.js";

import { validateDate, validateDateTime, validateDuration, validateTime } from "./date.js";
import { validateEmail, validateIdnEmail } from "./email.js";
import { validateHostname, validateIdnHostname } from "./hostname.js";
import { validateIpv4, validateIpv6 } from "./ip.js";
import { validateRegex, validateUuid } from "./misc.js";
import {
  validateIri,
  validateIriReference,
  validateJsonPointer,
  validateRelativeJsonPointer,
  validateUri,
  validateUriReference,
  validateUriTemplate,
} from "./uri.js";

/**
 * Every built-in format validator, keyed by its JSON Schema format name.
 * Hand to {@link @oav/schema!compileSchema#formats | compileSchema's formats
 * option} to get out-of-the-box format validation.
 *
 * @public
 *
 * @example
 * ```ts
 * compileSchema(mySchema, { dialect: jsonSchemaDialect, formats: builtInFormats });
 * ```
 */
export const builtInFormats: Record<string, (value: string) => boolean> = {
  "date-time": validateDateTime,
  date: validateDate,
  time: validateTime,
  duration: validateDuration,
  email: validateEmail,
  "idn-email": validateIdnEmail,
  hostname: validateHostname,
  "idn-hostname": validateIdnHostname,
  ipv4: validateIpv4,
  ipv6: validateIpv6,
  uri: validateUri,
  "uri-reference": validateUriReference,
  iri: validateIri,
  "iri-reference": validateIriReference,
  "uri-template": validateUriTemplate,
  "json-pointer": validateJsonPointer,
  "relative-json-pointer": validateRelativeJsonPointer,
  regex: validateRegex,
  uuid: validateUuid,
};
