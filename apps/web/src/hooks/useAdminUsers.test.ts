import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/stores/useAuthStore';
import { adminUsersQueryOptions, generateTempPassword } from '@/hooks/useAdminUsers';

/**
 * The admin user directory's data layer.
 *
 * Same shape as `useAdminTelemetry.test.ts`, and for the same reasons: `fetch`
 * is mocked rather than `api.get`, so the envelope unwrap, the `meta`
 * extraction and the shared-schema parse all stay real and only the network is
 * fake — and the OPTIONS FACTORY is the unit, because `useAdminUsers` is
 * `useQuery(factory(...))` and nothing else, so driving the factory through a
 * real `QueryClient` covers the key, the URL and the parse with no DOM.
 */

/**
 * A LIST ROW, not a bare account: `GET /admin/users` answers
 * `adminUserRowSchema`, which is `userSchema` plus the denormalized
 * `memberships[]` the directory's organizations column renders. A fixture
 * without it is a fixture the boundary parse rejects — which is the point.
 */
const USER = {
  id: '44444444-4444-4444-8444-444444444444',
  email: 'ada@flowboard.dev',
  name: 'Ada Lovelace',
  avatarUrl: null,
  isGlobalAdmin: true,
  locale: 'en',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
  memberships: [
    {
      orgId: '11111111-1111-4111-8111-111111111111',
      orgName: 'Acme',
      orgSlug: 'acme',
      role: 'admin',
    },
  ],
};

const META = { page: 1, pageSize: 25, total: 1, totalPages: 1 };

let fetchMock: ReturnType<typeof vi.fn>;

function ok(data: unknown, meta?: unknown): Response {
  return new Response(JSON.stringify({ success: true, data, meta }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

/** Retries off, so a rejected parse fails the test immediately. */
function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function calledUrl(): string {
  return String(fetchMock.mock.calls[0]?.[0]);
}

beforeEach(() => {
  useAuthStore.setState({ accessToken: 'token', refreshToken: null, user: null });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('adminUsersQueryOptions', () => {
  it('parses the rows and keeps pagination in the ENVELOPE', async () => {
    fetchMock.mockResolvedValue(ok([USER], META));

    const page = await client().fetchQuery(adminUsersQueryOptions({}, { page: 1, pageSize: 25 }));

    expect(page.rows).toEqual([USER]);
    expect(page.meta).toEqual(META);
  });

  it('rejects a row the shared schema does not recognise', async () => {
    // `isActive` is required by `userSchema`; a server that stopped sending it
    // must fail here rather than render a table of half-defined toggles.
    fetchMock.mockResolvedValue(ok([{ ...USER, isActive: undefined }], META));

    await expect(
      client().fetchQuery(adminUsersQueryOptions({}, { page: 1, pageSize: 25 })),
    ).rejects.toThrow();
  });

  /**
   * The memberships column reads `row.memberships`, and zod objects STRIP
   * unknown keys — so parsing with the narrower `userSchema` would silently
   * hand the table an undefined field rather than failing. This asserts the
   * wider schema is the one in force.
   */
  it('keeps the memberships the admin row carries', async () => {
    fetchMock.mockResolvedValue(ok([USER], META));

    const page = await client().fetchQuery(adminUsersQueryOptions({}, { page: 1, pageSize: 25 }));

    expect(page.rows[0]?.memberships).toEqual([
      {
        orgId: '11111111-1111-4111-8111-111111111111',
        orgName: 'Acme',
        orgSlug: 'acme',
        role: 'admin',
      },
    ]);
  });

  it('rejects a membership row missing its denormalized org name', async () => {
    fetchMock.mockResolvedValue(
      ok([{ ...USER, memberships: [{ orgId: USER.id, orgSlug: 'acme', role: 'admin' }] }], META),
    );

    await expect(
      client().fetchQuery(adminUsersQueryOptions({}, { page: 1, pageSize: 25 })),
    ).rejects.toThrow();
  });

  it('sends the search term and the pagination', async () => {
    fetchMock.mockResolvedValue(ok([USER], META));

    await client().fetchQuery(adminUsersQueryOptions({ q: 'ada' }, { page: 2, pageSize: 50 }));

    const url = calledUrl();
    expect(url).toContain('/admin/users');
    expect(url).toContain('q=ada');
    expect(url).toContain('page=2');
    expect(url).toContain('pageSize=50');
  });

  it('sends `isActive` only when the status filter is set', async () => {
    fetchMock.mockResolvedValue(ok([USER], META));
    await client().fetchQuery(adminUsersQueryOptions({}, { page: 1, pageSize: 25 }));
    expect(calledUrl()).not.toContain('isActive');

    fetchMock.mockClear();
    fetchMock.mockResolvedValue(ok([USER], META));
    await client().fetchQuery(
      adminUsersQueryOptions({ isActive: false }, { page: 1, pageSize: 25 }),
    );
    expect(calledUrl()).toContain('isActive=false');
  });

  /**
   * `?q=` and no `q` are the same request. Letting them differ would mint two
   * cache entries for one result — and would make "clear the box" a refetch.
   */
  it('drops a blank or whitespace-only search rather than sending it', async () => {
    fetchMock.mockResolvedValue(ok([USER], META));

    await client().fetchQuery(adminUsersQueryOptions({ q: '   ' }, { page: 1, pageSize: 25 }));

    expect(calledUrl()).not.toContain('q=');
    expect(adminUsersQueryOptions({ q: '   ' }, { page: 1, pageSize: 25 }).queryKey).toEqual(
      adminUsersQueryOptions({}, { page: 1, pageSize: 25 }).queryKey,
    );
  });

  it('keys separately per filter set and per page', () => {
    const base = adminUsersQueryOptions({}, { page: 1, pageSize: 25 }).queryKey;

    expect(base).not.toEqual(adminUsersQueryOptions({}, { page: 2, pageSize: 25 }).queryKey);
    expect(base).not.toEqual(
      adminUsersQueryOptions({ q: 'ada' }, { page: 1, pageSize: 25 }).queryKey,
    );
    expect(base).not.toEqual(
      adminUsersQueryOptions({ isActive: true }, { page: 1, pageSize: 25 }).queryKey,
    );
  });

  /**
   * Every mutation invalidates `['admin','users']`, so the list keys MUST sit
   * beneath it. `qk.admin.users()` with no arguments does not — it is a
   * complete four-element key — which is exactly the trap the hook's own
   * comment records.
   */
  it('keys beneath the prefix the mutations invalidate', () => {
    const key = adminUsersQueryOptions({ q: 'ada' }, { page: 1, pageSize: 25 }).queryKey;

    expect(key.slice(0, 2)).toEqual(['admin', 'users']);
  });
});

describe('generateTempPassword', () => {
  it('satisfies the shared password policy (8–128 characters)', () => {
    const password = generateTempPassword();

    expect(password.length).toBeGreaterThanOrEqual(8);
    expect(password.length).toBeLessThanOrEqual(128);
  });

  /**
   * The string is read off one screen and typed into another, so the alphabet
   * omits the glyph pairs that get confused doing exactly that.
   */
  it('avoids the characters that get mistyped when read aloud', () => {
    const sample = Array.from({ length: 50 }, () => generateTempPassword()).join('');

    expect(sample).not.toMatch(/[0O1lI]/u);
  });

  it('does not repeat itself', () => {
    const seen = new Set(Array.from({ length: 100 }, () => generateTempPassword()));

    expect(seen.size).toBe(100);
  });
});
