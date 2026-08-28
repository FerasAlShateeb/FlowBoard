/**
 * `requireAuth` — the Bearer access-token gate, and `requireGlobalAdmin` which
 * stacks on top of it.
 *
 * These two are token-only: they prove *who* the caller is from a signature, at
 * zero database cost. The role guards that need real lookups
 * (`requireOrgRole`, `requireProjectRole` — global admin ⊃ org admin ⊃ project
 * role) belong to Wave 2, which owns the membership services.
 *
 * `tokenVersion` is carried on `req.user` but NOT re-checked here: doing so
 * would put a `SELECT` in front of every request to shorten a 15-minute window.
 * Wave 2's role guards re-read the user row anyway and check it there; the
 * socket handshake — where a connection outlives its request — checks it
 * eagerly (see `sockets/io.ts`).
 */
import type { Request, RequestHandler } from 'express';
import { ApiError } from '../utils/api-error';
import { extractBearerToken, verifyAccessToken } from '../utils/jwt';
import type { AuthenticatedUser } from '../types/auth';

/** A request that has passed `requireAuth`. */
export interface AuthedRequest extends Request {
  user: AuthenticatedUser;
}

/**
 * Narrow a request to one that carries an identity.
 *
 * Handlers behind `requireAuth` still see `req.user?: AuthenticatedUser`
 * (declaration merging cannot be conditional), so this is the one-line, cast-free
 * way to get the non-optional value.
 *
 * @throws {ApiError} 401 when called outside a guarded route — a wiring bug.
 */
export function requireUser(req: Request): AuthenticatedUser {
  if (!req.user) throw ApiError.unauthorized();
  return req.user;
}

/** Verify `Authorization: Bearer <access token>` and attach `req.user`. */
export const requireAuth: RequestHandler = (req, _res, next) => {
  const token = extractBearerToken(req.get('authorization'));
  if (token === null) {
    next(ApiError.unauthorized('Authentication required'));
    return;
  }
  try {
    const payload = verifyAccessToken(token);
    req.user = {
      id: payload.sub,
      isGlobalAdmin: payload.isGlobalAdmin,
      tokenVersion: payload.tokenVersion,
    };
    next();
  } catch (error) {
    next(error);
  }
};

/** Global-admin gate. Mount AFTER `requireAuth` — it reads `req.user`. */
export const requireGlobalAdmin: RequestHandler = (req, _res, next) => {
  if (!req.user) {
    next(ApiError.unauthorized('Authentication required'));
    return;
  }
  if (!req.user.isGlobalAdmin) {
    next(ApiError.forbidden('Global administrator access required'));
    return;
  }
  next();
};
