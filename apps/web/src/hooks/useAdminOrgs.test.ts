import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/stores/useAuthStore';
import { adminOrgsQueryOptions } from '@/hooks/useAdminOrgs';

/**
 * The organizations console's data layer.
 *
 * Same shape as `useAdminUsers.test.ts`: `fetch` is mocked rather than
 * `api.get`, so the envelope unwrap and the SHARED-SCHEMA PARSE both stay real
 * and only the network is fake — and the OPTIONS FACTORY is the unit, because
 * the hook is `useQuery(factory(...))` and nothing else.
 *
 * The interesting behaviour here is the WIDENING: `GET /orgs` answers two
 * different row shapes depending on `includeDeleted`, and the table can only
 * render one. Every test below is ultimately about that switch.
 */

const LIVE_ROW = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Acme',
  slug: 'acme',
  role: 'admin',
  memberCount: 4,
  projectCount: 2,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-02T00:00:00.000Z',
};

const ADMIN_ROW = {
  id: '22222222-2222-4222-8222-222222222222',
  name: 'Globex',
  slug: 'globex',
  memberCount: 1,
  projectCount: 0,
  deletedAt: '2026-02-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-02-01T00:00:00.000Z',
};

let fetchMock: ReturnType<typeof vi.fn>;

function ok(data: unknown): Response {
  return new Response(JSON.stringify({ success: true, data }), {
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

describe('adminOrgsQueryOptions', () => {
  it('widens a live row to the admin shape, with `deletedAt: null`', async () => {
    fetchMock.mockResolvedValue(ok([LIVE_ROW]));

    const rows = await client().fetchQuery(adminOrgsQueryOptions({}));

    // Not a guess: without the flag the endpoint only ever returns live rows.
    expect(rows).toEqual([
      {
        id: LIVE_ROW.id,
        name: 'Acme',
        slug: 'acme',
        memberCount: 4,
        projectCount: 2,
        createdAt: LIVE_ROW.createdAt,
        updatedAt: LIVE_ROW.updatedAt,
        deletedAt: null,
      },
    ]);
    // `role` has no honest value on an admin row and is dropped.
    expect(rows[0]).not.toHaveProperty('role');
  });

  it('parses the ADMIN row shape verbatim when archived rows are asked for', async () => {
    fetchMock.mockResolvedValue(ok([ADMIN_ROW]));

    const rows = await client().fetchQuery(adminOrgsQueryOptions({ includeDeleted: true }));

    expect(rows[0]?.deletedAt).toBe('2026-02-01T00:00:00.000Z');
  });

  it('sends `includeDeleted` only when the toggle is on', async () => {
    fetchMock.mockResolvedValue(ok([LIVE_ROW]));
    await client().fetchQuery(adminOrgsQueryOptions({ includeDeleted: false }));
    expect(calledUrl()).not.toContain('includeDeleted');

    fetchMock.mockClear();
    fetchMock.mockResolvedValue(ok([ADMIN_ROW]));
    await client().fetchQuery(adminOrgsQueryOptions({ includeDeleted: true }));
    expect(calledUrl()).toContain('includeDeleted=true');
  });

  it('sends the search term, and drops a blank one', async () => {
    fetchMock.mockResolvedValue(ok([LIVE_ROW]));
    await client().fetchQuery(adminOrgsQueryOptions({ q: 'acme' }));
    expect(calledUrl()).toContain('q=acme');

    fetchMock.mockClear();
    fetchMock.mockResolvedValue(ok([LIVE_ROW]));
    await client().fetchQuery(adminOrgsQueryOptions({ q: '   ' }));
    expect(calledUrl()).not.toContain('q=');
  });

  /**
   * A live list and an archived-inclusive list are DIFFERENT ANSWERS to
   * different questions. Sharing a cache entry would make the "Show archived"
   * toggle render the previous answer until a refetch landed.
   */
  it('keys separately per filter set, and beneath the admin-orgs prefix', () => {
    const base = adminOrgsQueryOptions({}).queryKey;

    expect(base.slice(0, 2)).toEqual(['admin', 'orgs']);
    expect(base).not.toEqual(adminOrgsQueryOptions({ includeDeleted: true }).queryKey);
    expect(base).not.toEqual(adminOrgsQueryOptions({ q: 'acme' }).queryKey);
    // A cleared search and no search are one query.
    expect(adminOrgsQueryOptions({ q: '' }).queryKey).toEqual(base);
  });

  it('rejects a row the shared schema does not recognise', async () => {
    // `memberCount` is required by `orgWithRoleSchema`; a server that stopped
    // sending it must fail at the boundary rather than render `NaN` counts.
    fetchMock.mockResolvedValue(ok([{ ...LIVE_ROW, memberCount: undefined }]));

    await expect(client().fetchQuery(adminOrgsQueryOptions({}))).rejects.toThrow();
  });

  it('rejects an archived-list payload that omits `deletedAt`', async () => {
    // The whole reason the admin shape exists: a row that cannot say whether it
    // is archived leaves Restore with nothing to act on.
    const { deletedAt: _deletedAt, ...withoutDeletedAt } = ADMIN_ROW;
    fetchMock.mockResolvedValue(ok([withoutDeletedAt]));

    await expect(
      client().fetchQuery(adminOrgsQueryOptions({ includeDeleted: true })),
    ).rejects.toThrow();
  });
});
