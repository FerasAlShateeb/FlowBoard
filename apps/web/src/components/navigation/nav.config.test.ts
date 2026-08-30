import { describe, expect, it } from 'vitest';

import en from '@/locales/en';
import {
  buildSections,
  findByPath,
  flattenNav,
  isActiveNavPath,
  resolveNavOrgSlug,
  scopeFromNavPath,
  searchNav,
  type NavLabelKey,
  type NavScope,
  type NavSectionKey,
  type NavTranslate,
} from '@/components/navigation/nav.config';

/**
 * The navigation model.
 *
 * WHAT THIS SUITE IS ACTUALLY DEFENDING. The Round 2 audit found a global admin
 * could get stuck: on `/admin/*` the sidebar dropped every organization link,
 * because the sections were built from the org slug in the URL and that route
 * has none. The fix is a fallback ladder, and a ladder is exactly the kind of
 * thing that regresses silently — nothing crashes when a rung is dropped, the
 * links just quietly stop appearing on the routes nobody tests by hand. So the
 * matrix is asserted exhaustively: four contexts times three rungs.
 */

const BASE: NavScope = {
  orgSlug: null,
  projectKey: null,
  effectiveAdmin: false,
  defaultOrgSlug: null,
  lastOrgSlug: null,
};

const scope = (over: Partial<NavScope> = {}): NavScope => ({ ...BASE, ...over });

/** Every item id in the model, flattened. */
function ids(navScope: NavScope): string[] {
  return flattenNav(buildSections(navScope)).map((item) => item.id);
}

/** The path a named item points at, or undefined when the item is absent. */
function pathOf(navScope: NavScope, id: string): string | undefined {
  return flattenNav(buildSections(navScope)).find((item) => item.id === id)?.path;
}

function sectionIds(navScope: NavScope): string[] {
  return buildSections(navScope).map((section) => section.id);
}

// ───────────────────────────────────────────────────────────────────────────

describe('resolveNavOrgSlug — the fallback ladder', () => {
  it('prefers the org in the URL over everything else', () => {
    expect(
      resolveNavOrgSlug(scope({ orgSlug: 'url', lastOrgSlug: 'last', defaultOrgSlug: 'default' })),
    ).toBe('url');
  });

  it('falls back to the remembered org on an org-less route', () => {
    expect(resolveNavOrgSlug(scope({ lastOrgSlug: 'last', defaultOrgSlug: 'default' }))).toBe(
      'last',
    );
  });

  it('falls back to the instance default when nothing is remembered', () => {
    expect(resolveNavOrgSlug(scope({ defaultOrgSlug: 'default' }))).toBe('default');
  });

  it('answers null when no rung resolves', () => {
    expect(resolveNavOrgSlug(scope())).toBeNull();
  });
});

describe('buildSections — which sections exist', () => {
  it('always includes Workspace, in every context', () => {
    for (const navScope of [
      scope(),
      scope({ orgSlug: 'acme' }),
      scope({ orgSlug: 'acme', projectKey: 'FLOW' }),
      scope({ effectiveAdmin: true }),
    ]) {
      expect(sectionIds(navScope)).toContain('workspace');
    }
  });

  it('adds the Project section only inside a project, and puts it first', () => {
    expect(sectionIds(scope({ orgSlug: 'acme', projectKey: 'FLOW' }))[0]).toBe('project');
    expect(sectionIds(scope({ orgSlug: 'acme' }))).not.toContain('project');
    expect(sectionIds(scope())).not.toContain('project');
  });

  it('adds Administration and Analytics for an effective admin, and only then', () => {
    expect(sectionIds(scope({ effectiveAdmin: true }))).toEqual(
      expect.arrayContaining(['admin', 'analytics']),
    );
    expect(sectionIds(scope())).not.toContain('admin');
    expect(sectionIds(scope())).not.toContain('analytics');
  });

  it('gives every item a unique id and an absolute path', () => {
    const items = flattenNav(
      buildSections(scope({ orgSlug: 'acme', projectKey: 'FLOW', effectiveAdmin: true })),
    );
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length);
    for (const item of items) expect(item.path.startsWith('/')).toBe(true);
  });
});

describe('buildSections — the admin trap', () => {
  /** The shape of `/admin/users`: no org, no project, admin. */
  const onAdmin = (over: Partial<NavScope> = {}) => scope({ effectiveAdmin: true, ...over });

  it('offers a Home row on every route, for every user — the guaranteed way out', () => {
    for (const navScope of [
      scope(),
      onAdmin(),
      scope({ orgSlug: 'acme', projectKey: 'FLOW' }),
      scope({ orgSlug: 'acme' }),
    ]) {
      expect(ids(navScope)).toContain('home');
      expect(pathOf(navScope, 'home')).toBe('/');
    }
  });

  it('keeps the org links on an org-LESS route, via the remembered org', () => {
    const navScope = onAdmin({ lastOrgSlug: 'acme' });
    expect(ids(navScope)).toEqual(
      expect.arrayContaining(['org-home', 'org-teams', 'org-members', 'org-settings']),
    );
    expect(pathOf(navScope, 'org-home')).toBe('/o/acme');
    expect(pathOf(navScope, 'org-settings')).toBe('/o/acme/settings');
  });

  it('keeps them via the instance default when nothing is remembered', () => {
    expect(pathOf(onAdmin({ defaultOrgSlug: 'globex' }), 'org-teams')).toBe('/o/globex/teams');
  });

  it('emits NO org rows when no rung resolves — Home is the escape route there', () => {
    const navScope = onAdmin();
    expect(ids(navScope).some((id) => id.startsWith('org-'))).toBe(false);
    // The section is still non-empty, and it still contains a route to `/`.
    const workspace = buildSections(navScope).find((section) => section.id === 'workspace');
    expect(workspace?.items.some((item) => item.path === '/')).toBe(true);
  });

  it('links the five instance-admin pages', () => {
    const paths = flattenNav(buildSections(onAdmin()))
      .filter((item) => item.id.startsWith('admin-') && !item.id.includes('telemetry'))
      .map((item) => item.path);
    expect(paths).toEqual([
      '/admin/overview',
      '/admin/orgs',
      '/admin/projects',
      '/admin/users',
      '/admin/settings',
    ]);
  });

  /**
   * The other confirmed orphan: both telemetry sub-pages were routes nothing
   * linked to. A route with no inbound link is a page that exists only for
   * whoever remembers to type it.
   */
  it('links both previously orphaned telemetry pages', () => {
    expect(pathOf(onAdmin(), 'admin-telemetry-events')).toBe('/admin/telemetry/events');
    expect(pathOf(onAdmin(), 'admin-telemetry-requests')).toBe('/admin/telemetry/requests');
  });

  it('links all four analytics domains', () => {
    for (const domain of ['engagement', 'work', 'traffic', 'growth']) {
      expect(pathOf(onAdmin(), `analytics-${domain}`)).toBe(`/admin/analytics/${domain}`);
    }
  });
});

describe('buildSections — project rows', () => {
  const inProject = scope({ orgSlug: 'acme', projectKey: 'FLOW' });

  it('builds every view path from the org and project in the URL', () => {
    const project = buildSections(inProject)[0];
    expect(project?.items.map((item) => item.path)).toEqual([
      '/o/acme/p/FLOW/board',
      '/o/acme/p/FLOW/backlog',
      '/o/acme/p/FLOW/roadmap',
      '/o/acme/p/FLOW/table',
      '/o/acme/p/FLOW/calendar',
      '/o/acme/p/FLOW/dashboard',
      '/o/acme/p/FLOW/settings',
    ]);
  });

  it('needs BOTH halves of the scope — a project key with no org is not a project', () => {
    expect(sectionIds(scope({ projectKey: 'FLOW' }))).not.toContain('project');
  });
});

describe('scopeFromNavPath', () => {
  it.each([
    ['/', null, null],
    ['/notifications', null, null],
    ['/admin/users', null, null],
    ['/o/acme', 'acme', null],
    ['/o/acme/members', 'acme', null],
    ['/o/acme/p/FLOW/board', 'acme', 'FLOW'],
    ['/o/acme/p/FLOW/board/t/FLOW-142', 'acme', 'FLOW'],
    ['/o/acme/p/FLOW/settings/labels', 'acme', 'FLOW'],
  ])('reads %s as org=%s project=%s', (pathname, orgSlug, projectKey) => {
    expect(scopeFromNavPath(pathname)).toEqual({ orgSlug, projectKey });
  });
});

describe('isActiveNavPath', () => {
  it('matches a parent for its own sub-routes', () => {
    expect(isActiveNavPath({ path: '/admin/analytics' }, '/admin/analytics/traffic')).toBe(true);
  });

  it('requires the separator, so `/o/acme` never lights up on `/o/acmecorp`', () => {
    expect(isActiveNavPath({ path: '/o/acme' }, '/o/acmecorp')).toBe(false);
  });

  it('honours `end`, so a parent with children stays exact', () => {
    expect(
      isActiveNavPath({ path: '/admin/telemetry', end: true }, '/admin/telemetry/events'),
    ).toBe(false);
    expect(isActiveNavPath({ path: '/admin/telemetry', end: true }, '/admin/telemetry')).toBe(true);
  });

  it('treats `/` as exact whatever the flag says — otherwise it matches everything', () => {
    expect(isActiveNavPath({ path: '/' }, '/notifications')).toBe(false);
    expect(isActiveNavPath({ path: '/' }, '/')).toBe(true);
  });
});

describe('findByPath', () => {
  it('names an admin route with no org in it', () => {
    expect(findByPath('/admin/analytics/traffic')?.labelKey).toBe('common:nav.analyticsTraffic');
  });

  it('names a project view, deriving the model from the path itself', () => {
    expect(findByPath('/o/acme/p/FLOW/backlog')?.labelKey).toBe('common:nav.backlog');
  });

  it('is EXACT — a task deep link is not the board row', () => {
    expect(findByPath('/o/acme/p/FLOW/board/t/FLOW-1')).toBeUndefined();
  });

  it('carries the section heading along with the item', () => {
    expect(findByPath('/admin/users')?.sectionLabelKey).toBe('common:nav.adminSection');
  });
});

describe('searchNav', () => {
  const dictionary: Record<string, string> = {
    'common:nav.board': 'Board',
    'common:nav.adminUsers': 'Users',
    'common:nav.adminSection': 'Administration',
    'common:nav.analyticsTraffic': 'Traffic',
  };
  const translate: NavTranslate = (key) => dictionary[key] ?? key;
  const sections = buildSections(
    scope({ orgSlug: 'acme', projectKey: 'FLOW', effectiveAdmin: true }),
  );

  it('matches the TRANSLATED label, never the key', () => {
    const hits = searchNav(sections, 'Board', translate).map((item) => item.id);
    expect(hits).toContain('view-board');
  });

  it('matches the section heading too — "administration" finds the admin rows', () => {
    const hits = searchNav(sections, 'administration', translate).map((item) => item.id);
    expect(hits).toContain('admin-users');
  });

  it('matches the Latin URL keywords, so `backlog` works in an Arabic session', () => {
    const arabic: NavTranslate = (key) =>
      key === 'common:nav.backlog' ? 'قائمة الأعمال' : (dictionary[key] ?? key);
    const hits = searchNav(sections, 'backlog', arabic).map((item) => item.id);
    expect(hits).toContain('view-backlog');
  });

  it('caps the result list', () => {
    expect(searchNav(sections, '', translate, 3)).toHaveLength(3);
  });

  it('returns nothing when nothing matches', () => {
    expect(searchNav(sections, 'zzzzz', translate)).toEqual([]);
  });
});

/**
 * The keys are not strings, they are a contract with the catalog.
 *
 * TypeScript already narrows `NavLabelKey` to catalog paths, but nothing checks
 * that the paths RESOLVE — a key can be a valid literal and still name a
 * catalog entry somebody deleted. This walks the English catalog for every key
 * the model can emit, which is the assertion that would have caught a raw
 * `common:nav.adminOrgs` rendering in the sidebar.
 */
describe('every key the model emits exists in the English catalog', () => {
  function resolve(key: string): unknown {
    const [namespace, path] = key.split(':');
    if (namespace === undefined || path === undefined) return undefined;
    let node: unknown = (en as Record<string, unknown>)[namespace];
    for (const segment of path.split('.')) {
      if (node === null || typeof node !== 'object') return undefined;
      node = (node as Record<string, unknown>)[segment];
    }
    return node;
  }

  const sections = buildSections(
    scope({ orgSlug: 'acme', projectKey: 'FLOW', effectiveAdmin: true }),
  );
  const keys: (NavLabelKey | NavSectionKey)[] = [
    ...sections.map((section) => section.labelKey),
    ...flattenNav(sections).map((item) => item.labelKey),
  ];

  it.each([...new Set(keys)])('%s resolves', (key) => {
    expect(typeof resolve(key)).toBe('string');
  });
});
