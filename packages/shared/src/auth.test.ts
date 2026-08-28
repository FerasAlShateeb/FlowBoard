import { describe, expect, it } from 'vitest';
import {
  acceptInviteInputSchema,
  acceptInviteResponseSchema,
  accessTokenPayloadSchema,
  changePasswordInputSchema,
  invitePreviewSchema,
  loginInputSchema,
  loginResponseSchema,
  logoutQuerySchema,
  meResponseSchema,
  updateMeInputSchema,
} from './auth.schema';

const USER_ID = '11111111-1111-4111-8111-111111111111';

describe('loginInputSchema', () => {
  it('normalizes the email and accepts any non-empty password', () => {
    const parsed = loginInputSchema.parse({ email: '  Ada@Flowboard.DEV ', password: 'short' });

    expect(parsed.email).toBe('ada@flowboard.dev');
  });

  it('rejects a malformed email and an empty password', () => {
    expect(loginInputSchema.safeParse({ email: 'ada', password: 'x' }).success).toBe(false);
    expect(loginInputSchema.safeParse({ email: 'ada@flowboard.dev', password: '' }).success).toBe(
      false,
    );
  });
});

describe('loginResponseSchema', () => {
  const user = {
    id: USER_ID,
    email: 'ada@flowboard.dev',
    name: 'Ada Lovelace',
    avatarUrl: null,
    isGlobalAdmin: true,
    locale: 'en',
    isActive: true,
    createdAt: '2026-01-01T00:00:00Z',
  };

  it('parses a token pair alongside the account', () => {
    const parsed = loginResponseSchema.parse({
      user,
      accessToken: 'header.payload.signature',
      refreshToken: 'header.payload.signature',
    });

    expect(parsed.user.locale).toBe('en');
  });

  it('rejects a response missing the refresh token', () => {
    expect(loginResponseSchema.safeParse({ user, accessToken: 'a' }).success).toBe(false);
  });

  it('rejects a locale the app does not ship', () => {
    expect(
      loginResponseSchema.safeParse({
        user: { ...user, locale: 'fr' },
        accessToken: 'a',
        refreshToken: 'b',
      }).success,
    ).toBe(false);
  });
});

describe('accessTokenPayloadSchema', () => {
  const payload = { sub: USER_ID, tokenVersion: 3, isGlobalAdmin: false, type: 'access' };

  it('parses an access token payload', () => {
    expect(accessTokenPayloadSchema.parse(payload)).toEqual(payload);
  });

  it('parses a refresh token payload — same shape, different discriminant', () => {
    const parsed = accessTokenPayloadSchema.parse({ ...payload, type: 'refresh' });

    expect(parsed.type).toBe('refresh');
  });

  it('keeps the iat/exp jsonwebtoken stamps when present', () => {
    const parsed = accessTokenPayloadSchema.parse({ ...payload, iat: 1770000000, exp: 1770003600 });

    expect(parsed.exp).toBe(1770003600);
  });

  it('rejects a payload with no token type — a token that is neither is not usable', () => {
    const { type: _type, ...withoutType } = payload;

    expect(accessTokenPayloadSchema.safeParse(withoutType).success).toBe(false);
  });

  it('rejects a non-uuid subject and a negative token version', () => {
    expect(accessTokenPayloadSchema.safeParse({ ...payload, sub: 'ada' }).success).toBe(false);
    expect(accessTokenPayloadSchema.safeParse({ ...payload, tokenVersion: -1 }).success).toBe(
      false,
    );
  });

  it('rejects an invented token type', () => {
    expect(accessTokenPayloadSchema.safeParse({ ...payload, type: 'api-key' }).success).toBe(false);
  });
});

describe('acceptInviteInputSchema', () => {
  it('accepts the anonymous register branch', () => {
    const parsed = acceptInviteInputSchema.parse({
      mode: 'register',
      name: 'Ada Lovelace',
      password: 'correct horse battery',
    });

    expect(parsed.mode).toBe('register');
    if (parsed.mode !== 'register') throw new Error('expected the register branch');
    expect(parsed.name).toBe('Ada Lovelace');
  });

  it('accepts the signed-in attach branch with no body fields', () => {
    expect(acceptInviteInputSchema.parse({ mode: 'attach' }).mode).toBe('attach');
  });

  it('rejects a register branch with a weak password', () => {
    expect(
      acceptInviteInputSchema.safeParse({ mode: 'register', name: 'Ada', password: 'short' })
        .success,
    ).toBe(false);
  });

  it('rejects a body with no mode at all', () => {
    expect(acceptInviteInputSchema.safeParse({ name: 'Ada', password: 'longenough' }).success).toBe(
      false,
    );
  });

  /**
   * The register branch DOES carry an optional `email`, and only for an
   * UNLOCKED invite (`invites.email IS NULL`), which otherwise has no address
   * to create the account with. The safety property is not "the field cannot be
   * sent" — it is that the SERVER ignores it whenever the invite carries its own
   * lock, and refuses a value that disagrees with one. That rule needs the
   * invite row, so it is asserted in the API's invite suite, not here.
   */
  it('accepts an optional email on the register branch, for unlocked links', () => {
    const parsed = acceptInviteInputSchema.parse({
      mode: 'register',
      name: 'Ada',
      password: 'longenough',
      email: 'Ada@Example.com',
    });

    expect(parsed).toMatchObject({ mode: 'register', email: 'ada@example.com' });
  });

  it('leaves the register branch valid with no email at all', () => {
    const parsed = acceptInviteInputSchema.parse({
      mode: 'register',
      name: 'Ada',
      password: 'longenough',
    });

    expect(parsed).not.toHaveProperty('email');
  });
});

describe('invitePreviewSchema', () => {
  const preview = {
    orgName: 'Acme',
    orgRole: 'member',
    projectName: null,
    projectRole: null,
    invitedByName: 'Ada',
    email: null,
    expiresAt: '2026-03-01T00:00:00Z',
    requiresAccount: true,
    status: 'pending',
  };

  it('parses an open invite preview', () => {
    expect(invitePreviewSchema.parse(preview).requiresAccount).toBe(true);
  });

  it('carries no ids that an anonymous caller could address rows with', () => {
    const parsed = invitePreviewSchema.parse({ ...preview, orgId: 'leak', projectId: 'leak' });

    expect(parsed).not.toHaveProperty('orgId');
    expect(parsed).not.toHaveProperty('projectId');
  });

  it('rejects an unknown org role', () => {
    expect(invitePreviewSchema.safeParse({ ...preview, orgRole: 'owner' }).success).toBe(false);
  });

  it('carries the lifecycle status, so the page never re-derives it from a clock', () => {
    expect(invitePreviewSchema.parse({ ...preview, status: 'accepted' }).status).toBe('accepted');
    expect(invitePreviewSchema.parse({ ...preview, status: 'expired' }).status).toBe('expired');
    expect(invitePreviewSchema.safeParse({ ...preview, status: 'revoked' }).success).toBe(false);
    expect(invitePreviewSchema.safeParse({ ...preview, status: undefined }).success).toBe(false);
  });
});

describe('acceptInviteResponseSchema', () => {
  const session = {
    user: {
      id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      email: 'ada@example.com',
      name: 'Ada',
      avatarUrl: null,
      isGlobalAdmin: false,
      locale: 'en',
      isActive: true,
      createdAt: '2026-01-01T00:00:00Z',
    },
    accessToken: 'access',
    refreshToken: 'refresh',
    orgId: '3f2504e0-4f89-41d3-9a0c-0305e82c3302',
    projectId: null,
  };

  it('is one shape for BOTH modes — a session plus where to navigate', () => {
    expect(acceptInviteResponseSchema.parse(session).orgId).toBe(session.orgId);
  });

  it('carries the direct project grant when the invite had one', () => {
    const withProject = { ...session, projectId: '3f2504e0-4f89-41d3-9a0c-0305e82c3303' };
    expect(acceptInviteResponseSchema.parse(withProject).projectId).toBe(withProject.projectId);
  });

  it('refuses a response with no token pair — attach gets fresh claims too', () => {
    const { accessToken: _dropped, ...withoutTokens } = session;
    expect(acceptInviteResponseSchema.safeParse(withoutTokens).success).toBe(false);
  });
});

describe('meResponseSchema', () => {
  const me = {
    user: {
      id: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      email: 'ada@example.com',
      name: 'Ada',
      avatarUrl: null,
      isGlobalAdmin: true,
      locale: 'en',
      isActive: true,
      createdAt: '2026-01-01T00:00:00Z',
    },
    memberships: [
      {
        orgId: '3f2504e0-4f89-41d3-9a0c-0305e82c3302',
        orgSlug: 'acme',
        orgName: 'Acme',
        role: 'admin',
        joinedAt: '2026-01-02T00:00:00Z',
      },
    ],
    isGlobalAdmin: true,
  };

  it('parses the session the web shell boots from', () => {
    const parsed = meResponseSchema.parse(me);
    expect(parsed.memberships[0]?.orgSlug).toBe('acme');
    expect(parsed.isGlobalAdmin).toBe(true);
  });

  it('accepts an account that belongs to no organization yet', () => {
    expect(meResponseSchema.parse({ ...me, memberships: [] }).memberships).toEqual([]);
  });

  it('rejects a bare user — the org switcher would render empty', () => {
    expect(meResponseSchema.safeParse(me.user).success).toBe(false);
  });
});

describe('self-service profile inputs', () => {
  it('requires at least one field on updateMe', () => {
    expect(updateMeInputSchema.parse({ locale: 'ar' })).toEqual({ locale: 'ar' });
    expect(updateMeInputSchema.safeParse({}).success).toBe(false);
  });

  it('enforces the strength policy only on the NEW password', () => {
    expect(
      changePasswordInputSchema.safeParse({ currentPassword: 'old', newPassword: 'longenough' })
        .success,
    ).toBe(true);
    expect(
      changePasswordInputSchema.safeParse({ currentPassword: 'old', newPassword: 'short' }).success,
    ).toBe(false);
  });
});

describe('logoutQuerySchema', () => {
  /**
   * `?all` is the real revocation switch — it bumps `token_version` and kills
   * every device — so every spelling a browser or a fetch can produce has to
   * mean the same thing, INCLUDING the bare flag with no value.
   */
  it.each([
    ['?all', ''],
    ['?all=true', 'true'],
    ['?all=1', '1'],
    ['a JSON body true', true],
  ])('reads %s as revoke-everything', (_label, raw) => {
    expect(logoutQuerySchema.parse({ all: raw }).all).toBe(true);
  });

  it.each([
    ['?all=false', 'false'],
    ['?all=0', '0'],
    ['a JSON body false', false],
  ])('reads %s as this-device-only', (_label, raw) => {
    expect(logoutQuerySchema.parse({ all: raw }).all).toBe(false);
  });

  it('leaves an absent flag undefined rather than defaulting it', () => {
    expect(logoutQuerySchema.parse({}).all).toBeUndefined();
  });

  it('rejects a spelling that is neither, instead of guessing', () => {
    // Guessing here would either revoke every device on a typo, or fail to
    // revoke them when the user asked — both are bad in opposite directions.
    expect(logoutQuerySchema.safeParse({ all: 'yes' }).success).toBe(false);
  });
});
