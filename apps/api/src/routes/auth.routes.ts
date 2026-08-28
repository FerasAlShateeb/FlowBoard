/**
 * Authentication routes. Mount at `/api/auth`.
 *
 *   POST   /login                    public   rate-limited
 *   POST   /refresh                  public   rate-limited
 *   POST   /logout(?all=true)        authed
 *   GET    /me                       authed
 *   PATCH  /me                       authed
 *   POST   /change-password          authed   rate-limited
 *   GET    /invites/:token           public   rate-limited   (preview)
 *   POST   /invites/:token/accept    public*  rate-limited   (*Bearer for attach mode)
 *
 * Rate limiting is per-route rather than router-wide on purpose: `GET /me` is
 * polled by the web shell on every navigation and must not share a
 * brute-force budget with the login form.
 */
import { Router, type RequestHandler } from 'express';
import {
  changePasswordInputSchema,
  inviteTokenParamSchema,
  loginInputSchema,
  logoutQuerySchema,
  refreshInputSchema,
  updateMeInputSchema,
} from '@flowboard/shared';

import { isTest } from '../config/env';
import * as authController from '../controllers/auth.controller';
import { requireAuth } from '../middlewares/require-auth';
import { authRateLimit } from '../middlewares/rate-limit';
import { validate } from '../middlewares/validate';
import { asyncHandler } from '../utils/async-handler';
import { extractBearerToken, verifyAccessToken } from '../utils/jwt';
// A SUPERSET of the shared `acceptInviteInputSchema` — see its doc comment for
// the one field (`email` on an unlocked invite) the shared union cannot express.
import { acceptInviteBodySchema } from '../validation/auth.validation';

/**
 * `authRateLimit` is 10 requests per minute per IP — the brute-force ceiling.
 *
 * Under `NODE_ENV=test` every request comes from one loopback address, so a
 * suite of thirty auth cases would spend its last twenty asserting 429s. The
 * limiter is therefore bypassed in test and exercised nowhere else; the
 * limiter's own behaviour is `rate-limit.ts`'s to prove.
 */
const publicAuthLimit: RequestHandler = isTest
  ? (_req, _res, next) => {
      next();
    }
  : authRateLimit;

/**
 * Attach `req.user` IF the caller brought a Bearer token, without demanding one.
 *
 * `POST /invites/:token/accept` is genuinely dual-audience: an anonymous
 * visitor registering, and a signed-in user attaching an org. `requireAuth`
 * would lock out the first; ignoring the header would make the second
 * impossible. A malformed or expired token still fails loudly — silently
 * treating it as "anonymous" would turn an expired session into a surprise
 * second account.
 */
const optionalAuth: RequestHandler = (req, _res, next) => {
  const token = extractBearerToken(req.get('authorization'));
  if (token === null) {
    next();
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

export const authRouter: Router = Router();

// ── Credentials ─────────────────────────────────────────────────────────────
authRouter.post(
  '/login',
  publicAuthLimit,
  validate(loginInputSchema, 'body'),
  asyncHandler(authController.login),
);

authRouter.post(
  '/refresh',
  publicAuthLimit,
  validate(refreshInputSchema, 'body'),
  asyncHandler(authController.refresh),
);

authRouter.post(
  '/logout',
  requireAuth,
  validate(logoutQuerySchema, 'query'),
  asyncHandler(authController.logout),
);

authRouter.post(
  '/change-password',
  publicAuthLimit,
  requireAuth,
  validate(changePasswordInputSchema, 'body'),
  asyncHandler(authController.changePassword),
);

// ── Profile ─────────────────────────────────────────────────────────────────
authRouter.get('/me', requireAuth, asyncHandler(authController.getMe));

authRouter.patch(
  '/me',
  requireAuth,
  validate(updateMeInputSchema, 'body'),
  asyncHandler(authController.updateMe),
);

// ── Invite landing page (public) ────────────────────────────────────────────
authRouter.get(
  '/invites/:token',
  publicAuthLimit,
  validate(inviteTokenParamSchema, 'params'),
  asyncHandler(authController.previewInvite),
);

authRouter.post(
  '/invites/:token/accept',
  publicAuthLimit,
  optionalAuth,
  validate(inviteTokenParamSchema, 'params'),
  validate(acceptInviteBodySchema, 'body'),
  asyncHandler(authController.acceptInvite),
);
