/**
 * The public `oav-express5` surface: three exports plus the type
 * shape every adapter in the family shares.
 *
 * - {@link validateRequests}: middleware factory; the 80% case.
 * - {@link httpRequestFromExpress}: standalone extractor; for
 *   callers composing their own middleware.
 * - {@link renderProblemDetails}: the default error renderer;
 *   reusable from any custom middleware.
 *
 * Naming and option shapes are deliberately consistent with the
 * sibling `oav-express4` adapter and future `oav-fastify` /
 * `oav-hono` adapters, and pair with future `validateResponses`
 * on this package.
 *
 * Express 5 is promise-native: the returned middleware is `async`,
 * and thrown errors / rejected promises propagate to the host's
 * error middleware without explicit try/catch.
 *
 * @packageDocumentation
 */

export { httpRequestFromExpress } from "./extract.js";
export { renderProblemDetails } from "./render.js";
export { validateRequests, type ValidateRequestsOptions } from "./middleware.js";
export type { ErrorHandler, ExpressContext } from "./types.js";

// Re-export the types that appear in our own option signatures. Strictly
// not duplication of oav-core's surface; these ARE the adapter's
// public contract, just borrowed for non-duplication reasons. Importing
// them from this package means consumers don't have to know which
// package owns them.
export type { HttpRequest, ValidationError } from "@oav/core";
export type { Validator } from "@oav/validator";
