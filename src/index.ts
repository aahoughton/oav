/**
 * Default entry for the `oav` package. Exposes the HTTP validator plus
 * the bits of `@oav/core` most callers reach for (error-tree formatters
 * and the shared OpenAPI / HTTP types).
 *
 * For the lower-level pieces (schema compiler, spec loader, format
 * validators), import from the per-subsystem entrypoints:
 *   - `oav/schema`
 *   - `oav/spec`
 *   - `oav/formats`
 *   - `oav/core`
 */

export * from "../packages/validator/src/index.js";

export {
  collectLeaves,
  countErrors,
  createBranchError,
  createError,
  createLeafError,
  detectOpenAPIVersion,
  formatFlat,
  formatGithub,
  formatJson,
  formatText,
  joinPath,
  walkErrors,
  type CreateErrorParams,
  type FormatOptions,
  type OpenAPIVersion,
  type PathSegment,
  type ValidationError,
  type VersionSupport,
} from "../packages/core/src/index.js";

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
} from "../packages/core/src/index.js";
