import {
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryResult,
} from '@tanstack/react-query';
import {
  instanceSettingsSchema,
  type InstanceSettings,
  type UpdateInstanceSettingsInput,
} from '@flowboard/shared';

import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';

/**
 * `GET|PATCH /api/admin/settings` — the instance singleton, as the settings form
 * edits it.
 *
 * ═══ THE TWIN OF `useInstanceConfig`, AND WHY THEY ARE NOT ONE HOOK ═══════
 *
 * `useInstanceConfig()` is CHROME: every signed-in session reads it on boot to
 * decide whether the shell renders an org switcher at all, it degrades to a
 * constant on failure, and it returns a value rather than a query result
 * because none of its callers has anywhere to put a spinner. This hook is a
 * FORM's data source: it is global-admin only, it carries the raw
 * `defaultOrgId` a `<Select>` binds to plus the row's timestamps, and its
 * failure is a page-level error state the admin needs to see. Same prefix
 * (`qk.instance.*`) precisely so one successful PATCH invalidates both.
 *
 * ═══ WHY THE MUTATION HAS NO `onError` ════════════════════════════════════
 *
 * Two of its failures are FIELD errors, not page errors:
 *
 *   - **422 `default_org_required`** — single mode was requested without naming
 *     a default organization (and the deployment has more than one to choose
 *     from).
 *   - **422 `default_org_invalid`** — the organization named does not exist, or
 *     is archived.
 *
 * Both belong under the default-organization `<Select>`, where the admin can
 * fix them, not in a toast that vanishes while they are reading the form. So the
 * page owns the whole error path — see `AdminSettingsPage` — and a default
 * toast here would raise a second, less useful message for the same failure.
 *
 * ═══ THE INVALIDATION IS THE POINT OF THE FEATURE ═════════════════════════
 *
 * `qk.instance.all()` reaches BOTH `config()` and `settings()`, so flipping the
 * mode collapses (or restores) the shell live: the switcher disappears, the
 * sidebar re-scopes to the default org, `/` starts short-circuiting. Invalidating
 * only `settings()` would leave an admin looking at a saved form and an
 * unchanged application.
 */

const BASE = '/admin/settings';

/** `GET /admin/settings` — the whole singleton row. */
export function instanceSettingsQueryOptions() {
  return queryOptions({
    queryKey: qk.instance.settings(),
    queryFn: ({ signal }) => api.get(BASE, { schema: instanceSettingsSchema, signal }),
    // Short, not `Infinity` like the config twin: this one is READ ON THE PAGE
    // THAT EDITS IT, so a stale copy is a form that silently discards somebody
    // else's change.
    staleTime: 10_000,
  });
}

export function useInstanceSettings(): UseQueryResult<InstanceSettings> {
  return useQuery(instanceSettingsQueryOptions());
}

/** The two 422 codes the settings service answers, as field-level failures. */
export const DEFAULT_ORG_REQUIRED_CODE = 'default_org_required';
export const DEFAULT_ORG_INVALID_CODE = 'default_org_invalid';

/**
 * `PATCH /admin/settings` — every field optional, at least one required.
 *
 * See the header for why this deliberately ships without an error handler.
 */
export function useUpdateInstanceSettings() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateInstanceSettingsInput) =>
      api.patch<InstanceSettings>(BASE, input, { schema: instanceSettingsSchema }),
    onSuccess: (settings) => {
      // Written straight into the cache before the invalidation, so the form
      // re-baselines against what the server actually stored rather than
      // flickering through a pending state on its own save.
      queryClient.setQueryData(qk.instance.settings(), settings);
      void queryClient.invalidateQueries({ queryKey: qk.instance.all() });
    },
  });
}
