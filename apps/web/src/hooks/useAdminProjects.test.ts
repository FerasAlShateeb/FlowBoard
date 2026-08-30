import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useAuthStore } from '@/stores/useAuthStore';
import {
  adminProjectSortParam,
  adminProjectsQueryOptions,
  isAdminProjectSortField,
} from '@/hooks/useAdminProjects';

/**
 * The cross-organization projects console.
 *
 * Two units, both worth their own cases: the OPTIONS FACTORY (key, query
 * string, shared-schema parse) and the SORT CODEC, which is the only place a
 * hand-edited URL can reach a whitelisted server parameter.
 */

const ROW = {
  projectId: '66666666-6666-4666-8666-666666666666',
  key: 'FLOW',
  name: 'FlowBoard Web',
  orgId: '11111111-1111-4111-8111-111111111111',
  orgName: 'Acme',
  orgSlug: 'acme',
  leadName: 'Ada Lovelace',
  memberCount: 5,
  taskCount: 90,
  openTaskCount: 34,
  lastActivityAt: '2026-08-01T00:00:00.000Z',
  deletedAt: null,
};

const META = { page: 1, pageSize: 20, total: 1, totalPages: 1 };

let fetchMock: ReturnType<typeof vi.fn>;

function ok(data: unknown, meta?: unknown): Response {
  return new Response(JSON.stringify({ success: true, data, meta }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

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

describe('adminProjectsQueryOptions', () => {
  it('parses the rows and keeps pagination in the ENVELOPE', async () => {
    fetchMock.mockResolvedValue(ok([ROW], META));

    const page = await client().fetchQuery(
      adminProjectsQueryOptions({}, { page: 1, pageSize: 20 }),
    );

    expect(page.rows).toEqual([ROW]);
    expect(page.meta).toEqual(META);
  });

  it('rejects a row the shared schema does not recognise', async () => {
    // `openTaskCount` is required: a table that rendered `undefined / 90` would
    // be reporting a backlog nobody can act on.
    fetchMock.mockResolvedValue(ok([{ ...ROW, openTaskCount: undefined }], META));

    await expect(
      client().fetchQuery(adminProjectsQueryOptions({}, { page: 1, pageSize: 20 })),
    ).rejects.toThrow();
  });

  it('accepts the nullable columns a brand-new project has', async () => {
    // A project with no lead and no activity is a real, common row; nullable is
    // the honest mapping, and NULLS LAST is why the sort exists.
    fetchMock.mockResolvedValue(ok([{ ...ROW, leadName: null, lastActivityAt: null }], META));

    const page = await client().fetchQuery(
      adminProjectsQueryOptions({}, { page: 1, pageSize: 20 }),
    );

    expect(page.rows[0]?.leadName).toBeNull();
    expect(page.rows[0]?.lastActivityAt).toBeNull();
  });

  it('sends every filter, the pagination and the sort', async () => {
    fetchMock.mockResolvedValue(ok([ROW], META));

    await client().fetchQuery(
      adminProjectsQueryOptions(
        { q: 'flow', orgId: ROW.orgId, includeArchived: true },
        { page: 2, pageSize: 50, sort: 'taskCount:desc' },
      ),
    );

    const url = calledUrl();
    expect(url).toContain('/admin/projects');
    expect(url).toContain('q=flow');
    expect(url).toContain(`orgId=${ROW.orgId}`);
    expect(url).toContain('includeArchived=true');
    expect(url).toContain('page=2');
    expect(url).toContain('pageSize=50');
    expect(url).toContain('sort=taskCount%3Adesc');
  });

  it('drops empty filters rather than sending them', async () => {
    fetchMock.mockResolvedValue(ok([ROW], META));

    await client().fetchQuery(
      adminProjectsQueryOptions(
        { q: '   ', orgId: '', includeArchived: false },
        { page: 1, pageSize: 20 },
      ),
    );

    const url = calledUrl();
    expect(url).not.toContain('q=');
    expect(url).not.toContain('orgId=');
    expect(url).not.toContain('includeArchived');
  });

  it('keys separately per filter set, per page AND per sort', () => {
    const base = adminProjectsQueryOptions({}, { page: 1, pageSize: 20 }).queryKey;

    expect(base.slice(0, 2)).toEqual(['admin', 'projects']);
    expect(base).not.toEqual(adminProjectsQueryOptions({}, { page: 2, pageSize: 20 }).queryKey);
    expect(base).not.toEqual(
      adminProjectsQueryOptions({ q: 'flow' }, { page: 1, pageSize: 20 }).queryKey,
    );
    // Re-sorting changes the CONTENTS of page 1, so it cannot share an entry.
    expect(base).not.toEqual(
      adminProjectsQueryOptions({}, { page: 1, pageSize: 20, sort: 'name:asc' }).queryKey,
    );
  });
});

describe('the sort codec', () => {
  it('accepts exactly the fields the shared contract whitelists', () => {
    expect(isAdminProjectSortField('name')).toBe(true);
    expect(isAdminProjectSortField('org')).toBe(true);
    expect(isAdminProjectSortField('taskCount')).toBe(true);
    expect(isAdminProjectSortField('lastActivityAt')).toBe(true);
    expect(isAdminProjectSortField('orgId')).toBe(false);
    expect(isAdminProjectSortField('')).toBe(false);
  });

  it('builds `field:direction`, defaulting the direction to ascending', () => {
    expect(adminProjectSortParam('name', 'desc')).toBe('name:desc');
    expect(adminProjectSortParam('name', undefined)).toBe('name:asc');
  });

  /**
   * The parameter is whitelisted SERVER-side, so passing an unknown field
   * through would 422 the whole page — usually for a URL somebody hand-edited.
   * Dropping it falls back to the server's own ordering, which is what an
   * absent `?sort` already means.
   */
  it('drops an unsorted or unknown field instead of 422-ing the page', () => {
    expect(adminProjectSortParam(undefined, 'asc')).toBeUndefined();
    expect(adminProjectSortParam('', 'asc')).toBeUndefined();
    expect(adminProjectSortParam('nonsense', 'asc')).toBeUndefined();
  });
});
