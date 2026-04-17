export {
  collectLeaves,
  createBranchError,
  createError,
  createLeafError,
  joinPath,
  walkErrors,
  type BuiltInErrorParams,
  type CreateErrorParams,
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
  collectIssues,
  toProblemDetails,
  type ProblemDetails,
  type ProblemDetailsOptions,
  type ValidationIssue,
} from "./problem-details.js";

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
