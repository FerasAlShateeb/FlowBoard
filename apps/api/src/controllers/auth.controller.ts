/**
 * Auth controllers — envelope shaping only.
 *
 * Each one reads its zod-parsed request part with `getParsed`, calls exactly one
 * service function, and hands the result to `respond`. No database access, no
 * branching on business state: if a handler here grows an `if`, the rule it is
 * expressing belongs in `auth.service.ts` where a unit test can reach it.
 */
import type { Request, Response } from 'express';
import type {
  ChangePasswordInput,
  InviteTokenParam,
  LoginInput,
  LogoutQuery,
  RefreshInput,
  UpdateMeInput,
} from '@flowboard/shared';

import { getParsed } from '../middlewares/validate';
import { requireUser } from '../middlewares/require-auth';
import { respond } from '../utils/respond';
import * as authService from '../services/auth.service';
import * as invitesService from '../services/invites.service';
import type { AcceptInviteBody } from '../validation/auth.validation';

/** `POST /api/auth/login`. */
export async function login(_req: Request, res: Response): Promise<void> {
  const input = getParsed<LoginInput>(res, 'body');
  respond(res, await authService.login(input));
}

/** `POST /api/auth/refresh` — rotates BOTH tokens. */
export async function refresh(_req: Request, res: Response): Promise<void> {
  const input = getParsed<RefreshInput>(res, 'body');
  respond(res, await authService.refresh(input));
}

/** `POST /api/auth/logout?all=true`. */
export async function logout(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const query = getParsed<LogoutQuery>(res, 'query');
  respond(res, await authService.logout(user, query.all === true));
}

/** `GET /api/auth/me` — account + org memberships + admin flag. */
export async function getMe(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  respond(res, await authService.getMe(user));
}

/** `PATCH /api/auth/me`. */
export async function updateMe(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const input = getParsed<UpdateMeInput>(res, 'body');
  respond(res, await authService.updateMe(user, input));
}

/** `POST /api/auth/change-password` — returns a fresh pair; other devices are revoked. */
export async function changePassword(req: Request, res: Response): Promise<void> {
  const user = requireUser(req);
  const input = getParsed<ChangePasswordInput>(res, 'body');
  respond(res, await authService.changePassword(user, input));
}

/** `GET /api/auth/invites/:token` — public landing-page preview. */
export async function previewInvite(_req: Request, res: Response): Promise<void> {
  const params = getParsed<InviteTokenParam>(res, 'params');
  respond(res, await invitesService.previewInvite(params.token));
}

/**
 * `POST /api/auth/invites/:token/accept` — public.
 *
 * `req.user` is present only when the caller arrived with a Bearer token (the
 * route's `optionalAuth` step); `mode: 'attach'` needs it, `mode: 'register'`
 * must not have it. The service owns that rule — this only passes the identity
 * through.
 */
export async function acceptInvite(req: Request, res: Response): Promise<void> {
  const params = getParsed<InviteTokenParam>(res, 'params');
  const body = getParsed<AcceptInviteBody>(res, 'body');
  respond(
    res,
    await invitesService.acceptInvite(params.token, body, req.user ?? null),
    undefined,
    201,
  );
}
