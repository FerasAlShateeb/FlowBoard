import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import { z } from 'zod';
import {
  userSchema,
  type AdminUpdateUserInput,
  type PaginationMeta,
  type ProvisionUserInput,
  type User,
} from '@flowboard/shared';

import { api } from '@/lib/api';
import { qk, type PageParams } from '@/lib/query-keys';
import { useApiErrorToast } from '@/i18n/errors';

/**
 * `/api/admin/users` — the global-admin user directory.
 *
 * ═══ FOUR ENDPOINTS, AND ONLY ONE OF THEM IS A LIST ═══════════════════════
 *
 * The API deliberately does NOT expose `/activate`, `/deactivate`,
 * `/promote` and `/force-logout` as separate routes: activating a user,
 * revoking their admin flag and killing their sessions are all edits to one
 * row, and they interact — deactivating someone must also revoke their tokens,
 * which is a single `token_version` bump the server has to do atomically. So
 * there is ONE `PATCH`, and the mutations here are thin named wrappers over it
 * ({@link useUpdateAdminUser}) rather than four hooks pointing at three routes
 * that do not exist.
 *
 * ═══ THE SELF-GUARDS ARE THE SERVER'S ═════════════════════════════════════
 *
 * Deactivating your own account or revoking your own global-admin flag are
 * 400s, enforced server-side — an admin who could lock themselves out of the
 * only surface that can let them back in has found a very expensive bug. The
 * page does not offer those actions, which is chrome, not enforcement: the
 * check that matters is the one that runs after the request leaves.
 *
 * ═══ WHY `queryOptions` IS EXPORTED ═══════════════════════════════════════
 *
 * Same convention as `useAdminTelemetry`: the unit under test is the options
 * factory, which a `QueryClient.fetchQuery` can drive with no DOM and no React,
 * so the key, the query string and the parse are all asserted without rendering
 * anything.
 */

const BASE = '/admin/users';

const userListSchema = z.array(userSchema);

/** The filters the directory offers. Both are optional and both are server-side. */
export interface AdminUserFilters {
  /** Substring match against name OR email, case-insensitive. */
  q?: string;
  /** `undefined` = both; `true`/`false` = only active / only deactivated. */
  isActive?: boolean;
}

/** One page of the directory: the rows, plus the envelope's pagination meta. */
export interface AdminUsersPage {
  rows: User[];
  meta: PaginationMeta | undefined;
}

/**
 * Filters as the key factory and the query string both want them.
 *
 * Empty strings are dropped rather than sent: `?q=` and no `q` are the same
 * request, and letting them differ would mint two cache entries for one result.
 */
function filterRecord(filters: AdminUserFilters): Record<string, string | boolean | undefined> {
  const q = filters.q?.trim();
  return {
    ...(q === undefined || q === '' ? {} : { q }),
    ...(filters.isActive === undefined ? {} : { isActive: filters.isActive }),
  };
}

/** `GET /admin/users?q&isActive&page&pageSize`, newest account first. */
export function adminUsersQueryOptions(filters: AdminUserFilters, page: PageParams) {
  const query = filterRecord(filters);

  return queryOptions({
    queryKey: qk.admin.users(query, page),
    queryFn: async ({ signal }): Promise<AdminUsersPage> => {
      const result = await api.paged(BASE, {
        schema: userListSchema,
        query: { ...query, page: page.page, pageSize: page.pageSize },
        signal,
      });
      return { rows: result.data, meta: result.meta };
    },
    // The directory is a table an admin scans and acts on; a few seconds of
    // cache keeps paging back and forth from re-requesting, and every mutation
    // below invalidates it outright anyway.
    staleTime: 10_000,
  });
}

export function useAdminUsers(
  filters: AdminUserFilters,
  page: PageParams,
): UseQueryResult<AdminUsersPage> {
  return useQuery(adminUsersQueryOptions(filters, page));
}

/**
 * Everything under `['admin', 'users']`.
 *
 * NOT `qk.admin.users()`: called with no arguments that factory produces
 * `['admin','users','','']`, which is a complete four-element key and therefore
 * NOT a prefix of `['admin','users','q=ada','page=1&size=25']`. Invalidating it
 * would silently match nothing — the most expensive kind of no-op, because
 * every test still passes.
 */
const USERS_PREFIX = ['admin', 'users'] as const;

/** `POST /admin/users` — provision an account. Answers the created user. */
export function useProvisionUser() {
  const queryClient = useQueryClient();
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: (input: ProvisionUserInput) => api.post<User>(BASE, input, { schema: userSchema }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: USERS_PREFIX });
    },
    onError,
  });
}

/**
 * `PATCH /admin/users/:userId` — the one write behind every row action.
 *
 * `input` is the raw partial the server takes, so a caller can combine edits
 * that belong together in one request: deactivating an account and forcing its
 * sessions out is `{ isActive: false }`, which already bumps `token_version`,
 * and the server collapses the two into a single bump rather than two.
 */
export function useUpdateAdminUser() {
  const queryClient = useQueryClient();
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: ({ userId, input }: { userId: string; input: AdminUpdateUserInput }) =>
      api.patch<User>(`${BASE}/${userId}`, input, { schema: userSchema }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: USERS_PREFIX });
    },
    onError,
  });
}

/**
 * `POST /admin/users/:userId/reset-password` — 204, no body.
 *
 * The new password is chosen by the ADMIN and travels one way. The server never
 * echoes it back, so the page has to keep the string it generated in component
 * state and show it once — there is no second chance to read it, which is
 * exactly why the dialog says so before it closes.
 *
 * Resetting always revokes every session, server-side. That is not configurable
 * and should not be: a password reset that leaves the old sessions alive has
 * not actually locked anybody out.
 */
export function useResetUserPassword() {
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: ({ userId, password }: { userId: string; password: string }) =>
      api.post<void>(`${BASE}/${userId}/reset-password`, { password }),
    onError,
  });
}

/**
 * A random password that satisfies the shared policy (8–128 chars) and can be
 * read aloud off a screen.
 *
 * GENERATED IN THE BROWSER because the API has no "generate one for me" mode —
 * `POST /admin/users` and the reset route both require the admin to supply the
 * string. `crypto.getRandomValues` rather than `Math.random`: this value is a
 * credential from the moment it exists, and a predictable one is worse than no
 * temporary password at all.
 *
 * The alphabet omits the characters that get mistyped when a password is read
 * off one screen and typed into another — `0/O`, `1/l/I` — because that is
 * exactly how this string is going to travel.
 */
const PASSWORD_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
export const TEMP_PASSWORD_LENGTH = 16;

export function generateTempPassword(length: number = TEMP_PASSWORD_LENGTH): string {
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);

  let out = '';
  for (const byte of bytes) out += PASSWORD_ALPHABET[byte % PASSWORD_ALPHABET.length];
  return out;
}
