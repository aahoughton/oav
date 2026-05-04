/**
 * The public `oav-fastify` surface: three exports plus the type
 * shape every adapter in the family shares.
 *
 * - {@link validateRequests}: preValidation hook factory; the
 *   80% case.
 * - {@link httpRequestFromFastify}: standalone extractor; for
 *   callers composing their own hooks.
 * - {@link renderProblemDetails}: the default error renderer;
 *   reusable from any custom hook.
 *
 * Naming and option shapes are deliberately consistent with the
 * sibling `oav-express4` / `oav-express5` adapters.
 *
 * Fastify is async-native: the returned hook is `async`, and
 * thrown errors / rejected promises propagate to Fastify's error
 * handler without explicit try/catch.
 *
 * @packageDocumentation
 */

export { httpRequestFromFastify } from "./extract.js";
export { renderProblemDetails } from "./render.js";
export { validateRequests, type ValidateRequestsOptions } from "./middleware.js";
export type { ErrorHandler, FastifyContext } from "./types.js";

// Re-export the types that appear in our own option signatures. Strictly
// not duplication of oav-core's surface; these ARE the adapter's
// public contract, just borrowed for non-duplication reasons. Importing
// them from this package means consumers don't have to know which
// package owns them.
export type { HttpRequest, ValidationError } from "@oav/core";
export type { Validator } from "@oav/validator";
