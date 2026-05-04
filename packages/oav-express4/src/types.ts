import type { NextFunction, Request, Response } from "express";
import type { ValidationError } from "@oav/core";

/**
 * The trio every Express 4 middleware receives. Passed to user-supplied
 * `onError` callbacks so they can render their own response, call
 * `next(err)`, or whatever the host app's error contract requires.
 *
 * Identical in shape to what an inline middleware would close over;
 * the type is exported only so users can annotate their callbacks.
 *
 * @public
 */
export interface ExpressContext {
  req: Request;
  res: Response;
  next: NextFunction;
}

/**
 * Signature shared by `onError` on every adapter in the family
 * (`oav-express4`, `oav-express5`, `oav-fastify`). The `Ctx`
 * parameter is the only thing that varies; same name and shape
 * everywhere.
 *
 * Returning a Promise is supported on every adapter. `oav-express4`
 * awaits the return so async work (logging to a remote service,
 * loading per-tenant rendering config, etc.) can complete before the
 * middleware exits. Sync handlers pay no measurable overhead.
 *
 * @public
 */
export type ErrorHandler<Ctx> = (err: ValidationError, ctx: Ctx) => void | Promise<void>;
