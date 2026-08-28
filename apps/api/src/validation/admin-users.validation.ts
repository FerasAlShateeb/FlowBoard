/**
 * Global-admin user administration shapes (`/api/admin/users`).
 *
 * All of these now live in `@flowboard/shared`'s `admin.schema.ts` — the admin
 * users page parses the same list query and posts the same provisioning body,
 * so a server-only definition would have been half a contract. This module
 * re-exports them plus the one genuinely server-side thing: the route params.
 */
import { z } from 'zod';
import { uuid } from '@flowboard/shared';

export {
  adminUpdateUserInputSchema,
  adminUserListQuerySchema,
  provisionMembershipSchema,
  provisionUserInputSchema,
  resetPasswordInputSchema,
} from '@flowboard/shared';

export type {
  AdminUpdateUserInput,
  AdminUserListQuery,
  ProvisionMembership,
  ProvisionUserInput,
  ResetPasswordInput,
} from '@flowboard/shared';

/** `/api/admin/users/:userId` and `/api/admin/users/:userId/reset-password`. */
export const adminUserParamsSchema = z.object({
  userId: uuid,
});
export type AdminUserParams = z.infer<typeof adminUserParamsSchema>;
