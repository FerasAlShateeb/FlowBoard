/**
 * Reads the `X-Socket-Id` header into `res.locals.socketId`.
 *
 * This is the client half of echo suppression: the web app sends the id of its
 * live Socket.IO connection on every mutating request, services copy it onto
 * the domain event they publish, and the realtime layer emits
 * `io.to(room).except(originSocketId)`. The tab that made the change already
 * has the result (optimistic update + HTTP response); a broadcast echo would be
 * a third, later write that can undo a subsequent local edit.
 *
 * The header is untrusted input, so it is length-checked before it can end up
 * in a room name — anything unusable becomes `null`, never an exception.
 */
import type { RequestHandler, Response } from 'express';

/** Socket.IO ids are 20 chars; 64 leaves room without allowing a payload. */
const MAX_SOCKET_ID_LENGTH = 64;

export const socketIdMiddleware: RequestHandler = (req, res, next) => {
  const header = req.get('x-socket-id');
  res.locals.socketId =
    typeof header === 'string' && header.length > 0 && header.length <= MAX_SOCKET_ID_LENGTH
      ? header
      : null;
  next();
};

/**
 * The originating socket id, or `null`.
 *
 * Use this rather than reading `res.locals.socketId` directly: it returns the
 * right answer in a test app that never mounted the middleware.
 */
export function getSocketId(res: Response): string | null {
  return res.locals.socketId ?? null;
}
