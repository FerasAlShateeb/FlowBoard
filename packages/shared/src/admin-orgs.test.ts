// The instance-administration additions to the orgs and admin-users contracts
// (Round 2, W1.0): the `GET /orgs` facets, the archived-org row the restore
// flow acts on, the memberships column the user directory could not previously
// fill, and the anonymize-delete response.
//
// Kept out of `contracts.test.ts` so W1.1 and W2.1 can extend the families they
// own without three packages editing one breadth file.
import { describe, expect, it } from 'vitest';

import {
  adminUserMembershipSchema,
  adminUserRowSchema,
  deleteUserResponseSchema,
  provisionUserInputSchema,
} from './admin.schema';
import { orgAdminRowSchema, orgListQuerySchema, orgListScopeSchema } from './orgs.schema';

const USER_ID = '77777777-7777-4777-8777-777777777777';
const ORG_ID = '88888888-8888-4888-8888-888888888888';
const NOW = '2026-02-01T10:00:00Z';

const USER = {
  id: USER_ID,
  email: 'ada@flowboard.dev',
  name: 'Ada Lovelace',
  avatarUrl: null,
  isGlobalAdmin: false,
  locale: 'en',
  isActive: true,
  createdAt: NOW,
};

describe('org list query', () => {
  it('accepts an empty query — every facet is optional', () => {
    expect(orgListQuerySchema.parse({})).toEqual({});
  });

  it('coerces the archived toggle from its query-string spellings', () => {
    expect(orgListQuerySchema.parse({ includeDeleted: 'true' }).includeDeleted).toBe(true);
    expect(orgListQuerySchema.parse({ includeDeleted: '0' }).includeDeleted).toBe(false);
  });

  it('narrows to the caller own memberships for view-as-member', () => {
    expect(orgListQuerySchema.parse({ scope: 'member' }).scope).toBe('member');
    expect(orgListScopeSchema.options).toEqual(['member']);
  });

  it('rejects a scope nobody implements, rather than ignoring it', () => {
    expect(orgListQuerySchema.safeParse({ scope: 'admin' }).success).toBe(false);
  });
});

describe('admin org row', () => {
  const row = {
    id: ORG_ID,
    name: 'Acme',
    slug: 'acme',
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
    memberCount: 4,
    projectCount: 2,
  };

  it('parses a live org and an archived one', () => {
    expect(orgAdminRowSchema.parse(row).deletedAt).toBeNull();
    expect(orgAdminRowSchema.parse({ ...row, deletedAt: NOW }).deletedAt).toBe(NOW);
  });

  it('carries NO caller role — a global admin administers orgs they are not in', () => {
    expect(orgAdminRowSchema.parse({ ...row, role: 'admin' })).not.toHaveProperty('role');
  });

  it('rejects a row with no archived stamp — restore would have nothing to read', () => {
    const { deletedAt: _deletedAt, ...withoutFlag } = row;

    expect(orgAdminRowSchema.safeParse(withoutFlag).success).toBe(false);
  });
});

describe('admin user row', () => {
  const membership = { orgId: ORG_ID, orgName: 'Acme', orgSlug: 'acme', role: 'member' };

  it('carries denormalized org names and slugs, not bare ids', () => {
    expect(adminUserMembershipSchema.parse(membership)).toEqual(membership);
  });

  it('parses a directory row with memberships, and with none at all', () => {
    expect(adminUserRowSchema.parse({ ...USER, memberships: [membership] }).memberships).toEqual([
      membership,
    ]);
    expect(adminUserRowSchema.parse({ ...USER, memberships: [] }).memberships).toEqual([]);
  });

  it('rejects a row whose memberships were simply omitted', () => {
    expect(adminUserRowSchema.safeParse(USER).success).toBe(false);
  });

  it('still accepts org grants at provisioning time', () => {
    expect(
      provisionUserInputSchema.parse({
        email: 'grace@flowboard.dev',
        name: 'Grace',
        password: 'longenough',
        orgMemberships: [{ orgId: ORG_ID, role: 'admin' }],
      }).orgMemberships,
    ).toEqual([{ orgId: ORG_ID, role: 'admin' }]);
  });
});

describe('delete user response', () => {
  it('returns the SCRUBBED row plus the access it revoked', () => {
    const parsed = deleteUserResponseSchema.parse({
      user: {
        ...USER,
        name: 'Deleted user',
        email: `deleted+${USER_ID}@flowboard.invalid`,
        avatarUrl: null,
        isActive: false,
      },
      membershipsRemoved: 3,
    });

    expect(parsed.user.isActive).toBe(false);
    expect(parsed.membershipsRemoved).toBe(3);
  });

  it('rejects a response that forgot to say what was revoked', () => {
    expect(deleteUserResponseSchema.safeParse({ user: USER }).success).toBe(false);
  });
});
