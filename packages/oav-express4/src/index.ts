/**
 * The public `oav-express4` surface — three exports plus the type
 * shape every adapter in the family shares.
 *
 * - {@link validateRequests} — middleware factory; the 80% case.
 * - {@link httpRequestFromExpress} — standalone extractor; for
 *   callers composing their own middleware.
 * - {@link renderProblemDetails} — the default error renderer;
 *   reusable from any custom middleware.
 *
 * Naming and option shapes are deliberately consistent with the
 * future `oav-express5`, `oav-fastify`, and `oav-hono` adapters,
 * and pair with future `validateResponses` on this package.
 *
 * @packageDocumentation
 */

export { httpRequestFromExpress } from "./extract.js";
export { renderProblemDetails } from "./render.js";
export { validateRequests, type ValidateRequestsOptions } from "./middleware.js";
export type { ErrorHandler, ExpressContext } from "./types.js";
