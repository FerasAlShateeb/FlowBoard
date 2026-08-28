/**
 * Adapt an async handler into a standard Express `RequestHandler`.
 *
 * Express 5 *does* forward a rejected promise to `next()` on its own, so this
 * is not strictly required — but it keeps the handler's declared return type
 * honest (`Promise<void>` instead of `void | Promise<void>`) and makes the
 * "this route awaits something" fact visible in the route table.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';

type AsyncRequestHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

export function asyncHandler(handler: AsyncRequestHandler): RequestHandler {
  return (req, res, next) => {
    handler(req, res, next).catch(next);
  };
}
