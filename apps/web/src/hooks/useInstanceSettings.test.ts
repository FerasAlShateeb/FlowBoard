import { QueryClient } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { qk } from '@/lib/query-keys';
import { useAuthStore } from '@/stores/useAuthStore';
import {
  DEFAULT_ORG_INVALID_CODE,
  DEFAULT_ORG_REQUIRED_CODE,
  instanceSettingsQueryOptions,
} from '@/hooks/useInstanceSettings';

/**
 * The instance singleton's data layer.
 *
 * The PATCH half is covered end-to-end by `AdminSettingsPage.test.tsx`, where
 * the 422 codes have a field to land on; this file covers the read and the two
 * facts that must not drift — the key prefix (one successful save has to
 * invalidate the SHELL's config as well) and the error codes the form branches
 * on.
 */

const SETTINGS = {
  orgMode: 'single',
  defaultOrgSlug: 'acme',
  defaultOrgId: '11111111-1111-4111-8111-111111111111',
  instanceName: 'Acme Board',
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

function client(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

beforeEach(() => {
  useAuthStore.setState({ accessToken: 'token', refreshToken: null, user: null });
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('instanceSettingsQueryOptions', () => {
  it('reads the admin row and parses it against the shared schema', async () => {
    fetchMock.mockResolvedValue(ok(SETTINGS));

    const settings = await client().fetchQuery(instanceSettingsQueryOptions());

    expect(settings).toEqual(SETTINGS);
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain('/admin/settings');
  });

  it('accepts multi mode with no default organization', async () => {
    // `defaultOrgSlug`/`defaultOrgId` are null in multi mode, and in single
    // mode only while a fresh install has no organization yet.
    fetchMock.mockResolvedValue(
      ok({ ...SETTINGS, orgMode: 'multi', defaultOrgId: null, defaultOrgSlug: null }),
    );

    const settings = await client().fetchQuery(instanceSettingsQueryOptions());

    expect(settings.orgMode).toBe('multi');
    expect(settings.defaultOrgId).toBeNull();
  });

  it('rejects an org mode the contract does not know', async () => {
    fetchMock.mockResolvedValue(ok({ ...SETTINGS, orgMode: 'hybrid' }));

    await expect(client().fetchQuery(instanceSettingsQueryOptions())).rejects.toThrow();
  });

  /**
   * The whole point of changing the mode is that the SHELL relays itself out —
   * the switcher disappears, the sidebar re-scopes, `/` short-circuits. That
   * only happens if `qk.instance.all()` reaches this key as a prefix.
   */
  it('keys beneath the prefix a successful save invalidates', () => {
    const key = instanceSettingsQueryOptions().queryKey;

    expect(key).toEqual(qk.instance.settings());
    expect(key.slice(0, qk.instance.all().length)).toEqual([...qk.instance.all()]);
  });
});

describe('the field-level failure codes', () => {
  /**
   * These two strings are wire surface: `services/instance-settings.service.ts`
   * answers them verbatim, and the settings form branches on them to decide
   * whether a failure belongs under the default-organization select or in a
   * toast. A rename on either side has to break something.
   */
  it('matches the codes the settings service answers', () => {
    expect(DEFAULT_ORG_REQUIRED_CODE).toBe('default_org_required');
    expect(DEFAULT_ORG_INVALID_CODE).toBe('default_org_invalid');
  });
});
