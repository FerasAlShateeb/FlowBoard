/**
 * Global-admin account controllers (`/api/admin/users`).
 *
 * The list handler is the only one that passes a `meta` block to `respond` —
 * pagination lives in the envelope, never in the payload, so `data` is always a
 * plain array a client can map over.
 */
import type { Request, Response } from 'express';
import type { ResetPasswordInput } from '@flowboard/shared';

import { requireUser } from '../middlewares/require-auth';
import { getParsed } from '../middlewares/validate';
import { respond, respondNoContent } from '../utils/respond';
import * as adminUsersService from '../services/admin-users.service';
import type {
  AdminUpdateUserInput,
  AdminUserListQuery,
  AdminUserParams,
  ProvisionUserInput,
} from '../validation/admin-users.validation';

/** `GET /api/admin/users?page&pageSize&q&isActive`. */
export async function listUsers(_req: Request, res: Response): Promise<void> {
  const query = getParsed<AdminUserListQuery>(res, 'query');
  const page = await adminUsersService.listUsers(query);
  respond(res, page.rows, page.meta);
}

/** `POST /api/admin/users` — provision an account (+ optional org memberships). */
export async function provisionUser(_req: Request, res: Response): Promise<void> {
  const input = getParsed<ProvisionUserInput>(res, 'body');
  respond(res, await adminUsersService.provisionUser(input), undefined, 201);
}

/** `PATCH /api/admin/users/:userId` — activate/deactivate, promote, force logout. */
export async function updateUser(req: Request, res: Response): Promise<void> {
  const actor = requireUser(req);
  const params = getParsed<AdminUserParams>(res, 'params');
  const input = getParsed<AdminUpdateUserInput>(res, 'body');
  respond(res, await adminUsersService.updateUser(actor.id, params.userId, input));
}

/**
 * `DELETE /api/admin/users/:userId` — anonymize and deactivate.
 *
 * Answers 200 with the scrubbed row and the membership count, not 204: the
 * confirmation dialog has to be able to say what access was actually revoked
 * ("removed from 3 organizations"), and the table patches the row in place
 * rather than dropping it — the account still exists, it just has no identity.
 */
export async function deleteUser(req: Request, res: Response): Promise<void> {
  const actor = requireUser(req);
  const params = getParsed<AdminUserParams>(res, 'params');
  respond(res, await adminUsersService.deleteUser(actor.id, params.userId));
}

/** `POST /api/admin/users/:userId/reset-password` — sets it and revokes every session. */
export async function resetPassword(_req: Request, res: Response): Promise<void> {
  const params = getParsed<AdminUserParams>(res, 'params');
  const input = getParsed<ResetPasswordInput>(res, 'body');
  await adminUsersService.resetPassword(params.userId, input);
  respondNoContent(res);
}
