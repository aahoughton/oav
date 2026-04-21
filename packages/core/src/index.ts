export {
  BUILT_IN_ERROR_CODES,
  collectLeaves,
  createBranchError,
  createError,
  createLeafError,
  joinPath,
  walkErrors,
  type BuiltInErrorParams,
  type CreateErrorParams,
  type CustomErrorParams,
  type ErrorParams,
  type ErrorParamsFor,
  type PathSegment,
  type ValidationError,
} from "./errors.js";

export {
  countErrors,
  formatFlat,
  formatGithub,
  formatJson,
  formatText,
  type FormatOptions,
} from "./format.js";

export {
  formatError,
  isOutputFormat,
  KNOWN_OUTPUT_FORMATS,
  type ErrorRenderer,
  type OutputFormat,
} from "./format-output.js";

export {
  collectIssues,
  toProblemDetails,
  type ProblemDetails,
  type ProblemDetailsOptions,
  type ValidationIssue,
} from "./problem-details.js";

export { resolveJsonPointer } from "./json-pointer.js";

export { detectOpenAPIVersion, type OpenAPIVersion } from "./version.js";

export type {
  ComponentsObject,
  DiscriminatorObject,
  HeaderObject,
  HttpMethod,
  HttpRequest,
  HttpResponse,
  InfoObject,
  JsonValue,
  MediaTypeObject,
  OpenAPIDocument,
  OperationObject,
  ParameterLocation,
  ParameterObject,
  ParameterStyle,
  PathItem,
  ReferenceObject,
  RequestBodyObject,
  ResponseObject,
  SchemaObject,
  SchemaOrBoolean,
  ServerObject,
  TagObject,
} from "./types.js";
