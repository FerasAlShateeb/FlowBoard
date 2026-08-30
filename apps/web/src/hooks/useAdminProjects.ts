import { queryOptions, useQuery, type UseQueryResult } from '@tanstack/react-query';
import { z } from 'zod';
import {
  adminProjectRowSchema,
  adminProjectSortFields,
  type AdminProjectRow,
  type PaginationMeta,
} from '@flowboard/shared';

import { api } from '@/lib/api';
import { qk, type PageParams } from '@/lib/query-keys';

/**
 * `/admin/projects` — every project in the deployment, whoever owns it.
 *
 * ═══ WHY IT IS NOT `useProjects` ══════════════════════════════════════════
 *
 * `useProjects(orgId)` reads `/orgs/:orgId/projects`, which is membership-scoped
 * surface: the guard chain resolves the org, then the caller's role in it, and
 * 403s a project they are not in. This endpoint asks the opposite question and
 * carries a different row — the org's name and slug, the lead, the member and
 * task counts, the last activity instant — because the console's whole job is
 * comparing projects ACROSS organizations.
 *
 * ═══ SORT IS A WIRE STRING, VALIDATED ON BOTH ENDS ════════════════════════
 *
 * The API takes `?sort=field:asc|desc` over a closed field list
 * (`adminProjectSortFields`), so this module rebuilds that string from the
 * grid's `{sort, order}` pair and DROPS a field the contract does not know
 * rather than letting it reach a 422. The whitelist is imported from
 * `@flowboard/shared`, so adding a sortable column server-side is the only edit
 * needed to make it reachable from here.
 *
 * `sort` rides in {@link PageParams} rather than in the filter object, matching
 * the key factory's own note: re-sorting changes the contents of page 2 as
 * decisively as paging does, so the two must not share a cache entry.
 */

const projectListSchema = z.array(adminProjectRowSchema);

/** The sortable columns, as the shared contract declares them. */
export type AdminProjectSortField = (typeof adminProjectSortFields)[number];

/** True for a field this endpoint will actually sort by. */
export function isAdminProjectSortField(value: string): value is AdminProjectSortField {
  return (adminProjectSortFields as readonly string[]).includes(value);
}

/**
 * `field:asc|desc`, or `undefined` for "let the server order it".
 *
 * An unknown field is dropped rather than passed through: the parameter is
 * whitelisted server-side, so sending one would 422 the whole page for what is
 * usually a hand-edited URL.
 */
export function adminProjectSortParam(
  sort: string | undefined,
  order: 'asc' | 'desc' | undefined,
): string | undefined {
  if (sort === undefined || sort === '' || !isAdminProjectSortField(sort)) return undefined;
  return `${sort}:${order ?? 'asc'}`;
}

/** The filters the console offers. All three are answered server-side. */
export interface AdminProjectFilters {
  /** Matches the project NAME or its KEY — an admin types either. */
  q?: string;
  /** Narrow to one organization. */
  orgId?: string;
  /** Widen to archived projects AND the projects of archived organizations. */
  includeArchived?: boolean;
}

/** One page of the console: the rows, plus the envelope's pagination meta. */
export interface AdminProjectsPage {
  rows: AdminProjectRow[];
  meta: PaginationMeta | undefined;
}

/** Empty values are dropped, so a cleared filter and an absent one share a key. */
function filterRecord(filters: AdminProjectFilters): Record<string, string | boolean | undefined> {
  const q = filters.q?.trim();
  const orgId = filters.orgId?.trim();
  return {
    ...(q === undefined || q === '' ? {} : { q }),
    ...(orgId === undefined || orgId === '' ? {} : { orgId }),
    ...(filters.includeArchived === true ? { includeArchived: true } : {}),
  };
}

/** `GET /admin/projects?q&orgId&includeArchived&page&pageSize&sort`. */
export function adminProjectsQueryOptions(filters: AdminProjectFilters, page: PageParams) {
  const query = filterRecord(filters);

  return queryOptions({
    queryKey: qk.adminProjects.list(query, page),
    queryFn: async ({ signal }): Promise<AdminProjectsPage> => {
      const result = await api.paged('/admin/projects', {
        schema: projectListSchema,
        query: {
          ...query,
          page: page.page,
          pageSize: page.pageSize,
          // `''` is dropped by `toQuery`, so an unsorted grid sends no `sort`.
          sort: page.sort,
        },
        signal,
      });
      return { rows: result.data, meta: result.meta };
    },
    staleTime: 10_000,
  });
}

export function useAdminProjects(
  filters: AdminProjectFilters,
  page: PageParams,
): UseQueryResult<AdminProjectsPage> {
  return useQuery(adminProjectsQueryOptions(filters, page));
}
