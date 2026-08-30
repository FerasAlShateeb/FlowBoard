import { useQuery } from '@tanstack/react-query';
import { instanceConfigSchema, type InstanceConfig } from '@flowboard/shared';

import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { useAuthStore } from '@/stores/useAuthStore';

/**
 * `GET /api/instance/config` — how this deployment presents itself.
 *
 * Three facts, and every one of them changes what the SHELL looks like before
 * any page has rendered: whether this is a multi-org platform or a single-org
 * install (`orgMode`), which org that install is (`defaultOrgSlug`), and what
 * to call the instance. FlowBoard is open-sourced and the overwhelmingly common
 * self-hosted shape is one company / one organization, where the org switcher
 * and the `/` picker are noise — so the collapse is a runtime setting an admin
 * flips, not a build flag. See `packages/shared/src/instance.schema.ts` for why
 * it is a DB singleton rather than an env var.
 *
 * ═══ IT RETURNS A VALUE, NEVER A QUERY RESULT ══════════════════════════════
 *
 * Every caller is chrome: the sidebar's org fallback, the switcher's
 * visibility, `resolveHomeTarget`. None of them has anywhere sensible to put a
 * spinner — a topbar that waits for a config request is a topbar that flashes
 * empty on every cold boot — and none of them has anything useful to do with an
 * error. So the hook degrades to {@link FALLBACK_INSTANCE_CONFIG} and the shell
 * renders the multi-org shape, which is the one that is never WRONG: it shows
 * the switcher and the picker, so nothing becomes unreachable. A single-org
 * install whose config request failed looks slightly busier for a moment; a
 * multi-org install that guessed "single" would hide every org but one.
 *
 * That degradation is also what lets this ship in the same wave as the endpoint
 * it calls: W1.1 fills in the route this package's sibling W1.0 stubbed at 501,
 * and until it lands every call falls through to the constant.
 */

/** The shape the shell assumes when the instance has not answered. */
export const FALLBACK_INSTANCE_CONFIG: InstanceConfig = {
  orgMode: 'multi',
  defaultOrgSlug: null,
  instanceName: 'FlowBoard',
};

/**
 * The instance config, always resolved.
 *
 * `staleTime: Infinity` is not laziness: this row changes about once per
 * deployment, and it is read by three components that render on every single
 * route. `gcTime` matches, so a navigation that unmounts the last reader does
 * not throw the answer away and re-ask on the next one. An admin who flips the
 * mode invalidates `qk.instance.all()` from the settings page (W2.1).
 *
 * `retry: false` because the two failure modes are "not implemented yet" (the
 * 501 stub) and "signed out" — neither improves on a second attempt, and three
 * retries per boot is three requests spent on a value we already have a
 * fallback for.
 */
export function useInstanceConfig(): InstanceConfig {
  // The TOKEN, not `/auth/me`: the endpoint requires a session, and firing it
  // from the login screen would be a guaranteed 401 on every boot.
  const signedIn = useAuthStore((state) => state.accessToken !== null);

  const { data } = useQuery({
    queryKey: qk.instance.config(),
    queryFn: ({ signal }) => api.get('/instance/config', { schema: instanceConfigSchema, signal }),
    enabled: signedIn,
    staleTime: Infinity,
    gcTime: Infinity,
    retry: false,
  });

  return data ?? FALLBACK_INSTANCE_CONFIG;
}

/** True when this deployment is a single-organization install. */
export function useIsSingleOrgMode(): boolean {
  return useInstanceConfig().orgMode === 'single';
}
