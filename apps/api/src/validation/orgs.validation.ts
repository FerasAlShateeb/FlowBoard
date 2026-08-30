/**
 * Request validation for `/api/orgs`.
 *
 * The contracts themselves live in `@flowboard/shared` — this module re-exports
 * them so route files import validation from `src/validation/*` like every other
 * quartet, and adds the one thing a shared contract cannot express:
 *
 * **Route-parameter schemas.** `:orgId` reaches the role guard before any
 * controller runs, and the guard hands it straight to Postgres. Without a uuid
 * check in front, `GET /api/orgs/not-a-uuid` is a driver-level `22P02` (a 500),
 * not a validation failure — so every org route validates its params BEFORE
 * `requireOrgRole`.
 *
 * WP2.2's two "server-only body extensions" (`adminUserId` on create, the
 * `userId` XOR `email` widening on add-member) were promoted into the shared
 * contracts by WP2.5: both are things the web app sends, so both belong where
 * the web app can parse them.
 */
import { z } from 'zod';
import { uuid } from '@flowboard/shared';

export {
  addMemberInputSchema,
  createOrgInputSchema,
  orgDetailSchema,
  orgListQuerySchema,
  updateMemberInputSchema,
  updateOrgInputSchema,
  userListQuerySchema,
} from '@flowboard/shared';

export type {
  AddMemberInput,
  CreateOrgInput,
  OrgAdminRow,
  OrgDetail,
  OrgListQuery,
  UpdateMemberInput,
  UpdateOrgInput,
  UserListQuery,
} from '@flowboard/shared';

/** `/api/orgs/:orgId` and everything nested under it. */
export const orgParamsSchema = z.object({ orgId: uuid });
export type OrgParams = z.infer<typeof orgParamsSchema>;

/** `/api/orgs/:orgId/members/:userId`. */
export const orgMemberParamsSchema = z.object({ orgId: uuid, userId: uuid });
export type OrgMemberParams = z.infer<typeof orgMemberParamsSchema>;

// ── Legacy aliases ──────────────────────────────────────────────────────────
// WP2.2's names for the two bodies that are now plain shared contracts.
export {
  addMemberInputSchema as addOrgMemberBodySchema,
  createOrgInputSchema as createOrgBodySchema,
} from '@flowboard/shared';
export type {
  AddMemberInput as AddOrgMemberBody,
  CreateOrgInput as CreateOrgBody,
  UpdateMemberInput as UpdateOrgMemberBody,
  UpdateOrgInput as UpdateOrgBody,
  UserListQuery as OrgUserListQuery,
} from '@flowboard/shared';
