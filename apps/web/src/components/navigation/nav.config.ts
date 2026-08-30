import {
  Activity,
  Bell,
  Building2,
  CalendarDays,
  ChartColumn,
  ChartGantt,
  CircleUser,
  Gauge,
  Home,
  LayoutDashboard,
  ListOrdered,
  Palette,
  Scroll,
  Settings,
  ShieldCheck,
  SquareKanban,
  Table2,
  TrendingUp,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { orgPath, projectPath } from '@/hooks/useRouteScope';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * The navigation model, as data.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ONE MODEL, THREE SURFACES. The sidebar rows, the breadcrumb trail and the
 * command palette were three independent hand-written lists, and they drifted:
 * `/admin/telemetry/events` and `/admin/telemetry/requests` existed as routes
 * that nothing linked to, the breadcrumb slot was empty, and the palette gated
 * the admin rows on the ORG in the URL. Naming a destination once, here, is what
 * makes "is this page reachable" a property of a single module instead of a
 * property of whichever list somebody remembered to update.
 *
 * ═══ THE ADMIN TRAP THIS FILE EXISTS TO CLOSE ══════════════════════════════
 *
 * The old sidebar built its Workspace section from `useRouteScope().orgSlug`,
 * so `/admin/users` — which has no `/o/:orgSlug` in it — rendered a sidebar
 * with NO organization links at all. Combined with a brand mark that was not a
 * link and an org switcher that was a *disabled* button for single-org users, a
 * global admin who navigated into the console had no chrome route back out.
 *
 * The fix is {@link buildSections}'s org RESOLUTION LADDER: the org links are
 * built from `orgSlug ?? lastOrgSlug ?? defaultOrgSlug`, so they survive every
 * org-less route (`/admin/*`, `/me`, `/notifications`, `/theme`). When none of
 * the three resolves there is genuinely no org to link to — and the Workspace
 * section still leads with **Home**, which is the picker. The section is never
 * empty, on any route, for any user.
 *
 * ═══ WHY IT IS PURE ════════════════════════════════════════════════════════
 *
 * No hooks, no i18next, no router. `buildSections` takes the five facts that
 * decide what exists and returns rows; every consumer resolves the labels with
 * its own `t`. That is what lets the whole gate matrix — org / project / admin /
 * nowhere, times the three fallback rungs — be asserted in a node test instead
 * of sampled through a render.
 *
 * ═══ WHY THE LABELS ARE TYPED LITERALS, NOT STRINGS ════════════════════════
 *
 * GameDash's port of this module types its keys as a bare `(key: string) =>
 * string`, because its config is deliberately serializable. FlowBoard types
 * `t()` against the English catalog (`i18n/i18next.d.ts`), and
 * `components/palette/palette-items.ts` already spends a literal union to keep
 * that guarantee at the palette's call sites. Doing the same here means a
 * renamed catalog key is a COMPILE error in this file rather than a raw
 * `common:nav.adminOrgs` rendered in a sidebar. The icons are `LucideIcon`
 * values for the same reason the palette stores them that way: nothing here is
 * ever serialized, so an icon-key registry would buy an indirection and a
 * lookup failure mode for nothing.
 */

/** Every item label key the nav model can emit. Checked against the catalog. */
export type NavLabelKey =
  | 'common:nav.home'
  | 'common:nav.board'
  | 'common:nav.backlog'
  | 'common:nav.roadmap'
  | 'common:nav.table'
  | 'common:nav.calendar'
  | 'common:nav.dashboard'
  | 'common:nav.projectSettings'
  | 'common:nav.organization'
  | 'common:nav.teams'
  | 'common:nav.members'
  | 'common:nav.orgSettings'
  | 'common:nav.notifications'
  | 'common:nav.profile'
  | 'common:nav.theme'
  | 'common:nav.adminOverview'
  | 'common:nav.adminOrgs'
  | 'common:nav.adminProjects'
  | 'common:nav.adminUsers'
  | 'common:nav.adminSettings'
  | 'common:nav.analyticsEngagement'
  | 'common:nav.analyticsWork'
  | 'common:nav.analyticsTraffic'
  | 'common:nav.analyticsGrowth'
  | 'common:nav.adminTelemetry'
  | 'common:nav.adminTelemetryEvents'
  | 'common:nav.adminTelemetryRequests';

/** Every section heading key. */
export type NavSectionKey =
  | 'common:nav.projectSection'
  | 'common:nav.workspaceSection'
  | 'common:nav.adminSection'
  | 'common:nav.analyticsSection';

/** A `t` narrowed to the keys this module emits — see the file header. */
export type NavTranslate = (key: NavLabelKey | NavSectionKey) => string;

export interface NavItem {
  /** Unique across the whole model; also the React key and the palette value. */
  id: string;
  labelKey: NavLabelKey;
  icon: LucideIcon;
  /** Absolute in-app route. */
  path: string;
  /**
   * Exact match only, for a path that is a prefix of its own children — `/` and
   * `/o/:slug` and `/admin/telemetry` all have descendants that must not light
   * their parent row up.
   */
  end?: boolean;
  /** false hides the item from the command palette (default true). */
  inPalette?: boolean;
  /**
   * Extra needles that are NOT the label — URL segments, mostly. Latin and
   * untranslated on purpose: someone typing `backlog` in an Arabic session is
   * typing what they saw in the address bar.
   */
  keywords?: readonly string[];
}

export interface NavSection {
  id: string;
  labelKey: NavSectionKey;
  items: NavItem[];
}

/** An item plus the heading of the section it came from. */
export type FlatNavItem = NavItem & { sectionLabelKey: NavSectionKey };

/**
 * Everything {@link buildSections} needs to decide what exists.
 *
 * `effectiveAdmin`, not `isGlobalAdmin`: an admin who switched to "view as
 * member" must see the member's chrome. The distinction is
 * `useAuthStore.isEffectiveGlobalAdmin()` — see `stores/useAuthStore.ts`.
 */
export interface NavScope {
  /** From `/o/:orgSlug/…`, or null on an org-less route. */
  orgSlug: string | null;
  /** From `/o/:orgSlug/p/:projectKey/…`, or null outside a project. */
  projectKey: string | null;
  effectiveAdmin: boolean;
  /** `instance_settings.defaultOrgSlug` — the single-org install's org. */
  defaultOrgSlug: string | null;
  /** `fb-last-org-v1` — the org this device was last inside. */
  lastOrgSlug: string | null;
}

/**
 * The org the Workspace links should point at, or null when there is none.
 *
 * THE LADDER, and why each rung is where it is:
 *   1. **The URL** — if you are inside an org, that is the org, full stop.
 *   2. **The remembered org** — on `/admin/users` or `/me` there is no org in
 *      the URL, but this device was inside one a moment ago, and linking there
 *      is what turns "the sidebar lost my organization" back into navigation.
 *   3. **The instance default** — a single-org deployment has exactly one, and
 *      a fresh session on it has nothing remembered yet.
 */
export function resolveNavOrgSlug(scope: NavScope): string | null {
  return scope.orgSlug ?? scope.lastOrgSlug ?? scope.defaultOrgSlug;
}

/** The six project views plus settings, in the order the sidebar shows them. */
function projectSection(orgSlug: string, projectKey: string): NavSection {
  const at = (view: string) => projectPath(orgSlug, projectKey, view);
  return {
    id: 'project',
    labelKey: 'common:nav.projectSection',
    items: [
      {
        id: 'view-board',
        labelKey: 'common:nav.board',
        icon: SquareKanban,
        path: at('board'),
        keywords: ['board', projectKey],
      },
      {
        id: 'view-backlog',
        labelKey: 'common:nav.backlog',
        icon: ListOrdered,
        path: at('backlog'),
        keywords: ['backlog', projectKey],
      },
      {
        id: 'view-roadmap',
        labelKey: 'common:nav.roadmap',
        icon: ChartGantt,
        path: at('roadmap'),
        keywords: ['roadmap', projectKey],
      },
      {
        id: 'view-table',
        labelKey: 'common:nav.table',
        icon: Table2,
        path: at('table'),
        keywords: ['table', projectKey],
      },
      {
        id: 'view-calendar',
        labelKey: 'common:nav.calendar',
        icon: CalendarDays,
        path: at('calendar'),
        keywords: ['calendar', projectKey],
      },
      {
        id: 'view-dashboard',
        labelKey: 'common:nav.dashboard',
        icon: LayoutDashboard,
        path: at('dashboard'),
        keywords: ['dashboard', projectKey],
      },
      {
        id: 'project-settings',
        labelKey: 'common:nav.projectSettings',
        icon: Settings,
        path: at('settings'),
        keywords: ['settings', 'workflow', 'labels'],
      },
    ],
  };
}

/**
 * Workspace: the way home, the org pages, and the personal pages.
 *
 * IT LEADS WITH HOME, on every route, for every user. That single row is the
 * guaranteed escape hatch out of `/admin/*` — it needs no org, no membership
 * and no query to have resolved — and it doubles as the organization picker,
 * which is what `/` renders when no org resolves. (Emitting a second
 * "Organizations → /" row for that case, as the section's org group otherwise
 * would, is why this file does NOT: two adjacent rows pointing at the same
 * path read as a bug, not as a choice.)
 */
function workspaceSection(orgSlug: string | null): NavSection {
  const items: NavItem[] = [
    {
      id: 'home',
      labelKey: 'common:nav.home',
      icon: Home,
      path: '/',
      end: true,
      keywords: ['home', 'organizations', 'orgs'],
    },
  ];

  if (orgSlug !== null) {
    items.push(
      {
        id: 'org-home',
        labelKey: 'common:nav.organization',
        icon: Building2,
        path: orgPath(orgSlug),
        end: true,
        keywords: ['organization', 'projects', orgSlug],
      },
      {
        id: 'org-teams',
        labelKey: 'common:nav.teams',
        icon: Users,
        path: orgPath(orgSlug, 'teams'),
        keywords: ['teams'],
      },
      {
        id: 'org-members',
        labelKey: 'common:nav.members',
        icon: Users,
        path: orgPath(orgSlug, 'members'),
        keywords: ['members', 'people'],
      },
      {
        id: 'org-settings',
        labelKey: 'common:nav.orgSettings',
        icon: Settings,
        path: orgPath(orgSlug, 'settings'),
        keywords: ['settings'],
      },
    );
  }

  items.push(
    {
      id: 'notifications',
      labelKey: 'common:nav.notifications',
      icon: Bell,
      path: '/notifications',
      keywords: ['notifications', 'inbox'],
    },
    {
      id: 'profile',
      labelKey: 'common:nav.profile',
      icon: CircleUser,
      path: '/me',
      keywords: ['profile', 'account', 'me'],
    },
    {
      id: 'theme',
      labelKey: 'common:nav.theme',
      icon: Palette,
      path: '/theme',
      keywords: ['theme', 'appearance'],
    },
  );

  return { id: 'workspace', labelKey: 'common:nav.workspaceSection', items };
}

/**
 * Administration — the operator's verb set: "what can I do to this instance
 * right now". STATIC: every path here is org-less by design, which is exactly
 * why the old URL-derived sidebar could not render it alongside org links.
 */
const ADMIN_SECTION: NavSection = {
  id: 'admin',
  labelKey: 'common:nav.adminSection',
  items: [
    {
      id: 'admin-overview',
      labelKey: 'common:nav.adminOverview',
      icon: LayoutDashboard,
      path: '/admin/overview',
      keywords: ['admin', 'overview', 'instance'],
    },
    {
      id: 'admin-orgs',
      labelKey: 'common:nav.adminOrgs',
      icon: Building2,
      path: '/admin/orgs',
      keywords: ['admin', 'organizations', 'orgs'],
    },
    {
      id: 'admin-projects',
      labelKey: 'common:nav.adminProjects',
      icon: SquareKanban,
      path: '/admin/projects',
      keywords: ['admin', 'projects'],
    },
    {
      id: 'admin-users',
      labelKey: 'common:nav.adminUsers',
      icon: ShieldCheck,
      path: '/admin/users',
      keywords: ['admin', 'users', 'people'],
    },
    {
      id: 'admin-settings',
      labelKey: 'common:nav.adminSettings',
      icon: Settings,
      path: '/admin/settings',
      keywords: ['admin', 'settings', 'instance'],
    },
  ],
};

/**
 * Analytics gets its OWN heading rather than six more Administration rows.
 *
 * The two answer different questions: Administration is "what can I change",
 * Analytics is "how is the product doing" over history. An eleven-item admin
 * list stops being scannable, and a second heading costs nothing — both are
 * gated by the same `effectiveAdmin` flag.
 *
 * The three telemetry rows live here, not in Administration, and they are the
 * OTHER half of the orphan fix: `/admin/telemetry/events` and
 * `/admin/telemetry/requests` were routes with no link anywhere in the product.
 * (Round 2's W2.2 folds the requests page into the traffic drill-downs; the row
 * goes when the page does, and until then a reachable page beats a tidy list.)
 */
const ANALYTICS_SECTION: NavSection = {
  id: 'analytics',
  labelKey: 'common:nav.analyticsSection',
  items: [
    {
      id: 'analytics-engagement',
      labelKey: 'common:nav.analyticsEngagement',
      icon: TrendingUp,
      path: '/admin/analytics/engagement',
      keywords: ['analytics', 'engagement', 'dau', 'signups'],
    },
    {
      id: 'analytics-work',
      labelKey: 'common:nav.analyticsWork',
      icon: ChartColumn,
      path: '/admin/analytics/work',
      keywords: ['analytics', 'work', 'delivery', 'cycle time'],
    },
    {
      id: 'analytics-traffic',
      labelKey: 'common:nav.analyticsTraffic',
      icon: Gauge,
      path: '/admin/analytics/traffic',
      keywords: ['analytics', 'traffic', 'latency', 'errors'],
    },
    {
      id: 'analytics-growth',
      labelKey: 'common:nav.analyticsGrowth',
      icon: Building2,
      path: '/admin/analytics/growth',
      keywords: ['analytics', 'growth', 'invites', 'orgs'],
    },
    {
      id: 'admin-telemetry',
      labelKey: 'common:nav.adminTelemetry',
      icon: Activity,
      path: '/admin/telemetry',
      end: true,
      keywords: ['telemetry', 'ops', 'health'],
    },
    {
      id: 'admin-telemetry-events',
      labelKey: 'common:nav.adminTelemetryEvents',
      icon: Scroll,
      path: '/admin/telemetry/events',
      keywords: ['telemetry', 'events', 'feed'],
    },
    {
      id: 'admin-telemetry-requests',
      labelKey: 'common:nav.adminTelemetryRequests',
      icon: Gauge,
      path: '/admin/telemetry/requests',
      keywords: ['telemetry', 'requests', 'latency'],
    },
  ],
};

/**
 * The sections visible for one scope, in sidebar order.
 *
 * Project first because inside a project those seven rows are what someone is
 * reaching for; Workspace always; the two admin groups last, because they are
 * the least frequent destination for the account that can see them.
 */
export function buildSections(scope: NavScope): NavSection[] {
  const sections: NavSection[] = [];

  if (scope.orgSlug !== null && scope.projectKey !== null) {
    sections.push(projectSection(scope.orgSlug, scope.projectKey));
  }

  sections.push(workspaceSection(resolveNavOrgSlug(scope)));

  if (scope.effectiveAdmin) {
    sections.push(ADMIN_SECTION, ANALYTICS_SECTION);
  }

  return sections;
}

/**
 * Every section that exists for ANYBODY, for the path-shaped questions.
 *
 * `findByPath` has to name `/admin/analytics/traffic` even when it is asked by
 * a member's breadcrumb — the guard decides whether the page renders; naming a
 * URL is not an authorization decision, and a breadcrumb that reads
 * "Admin Analytics Traffic" beats one that reads "Admin Analytics Traffic"
 * prettified out of the raw segments.
 */
function allSections(scope: Pick<NavScope, 'orgSlug' | 'projectKey'>): NavSection[] {
  return buildSections({
    orgSlug: scope.orgSlug,
    projectKey: scope.projectKey,
    effectiveAdmin: true,
    defaultOrgSlug: null,
    lastOrgSlug: null,
  });
}

/** Flattens sections to their leaf items, each carrying its section heading. */
export function flattenNav(sections: readonly NavSection[]): FlatNavItem[] {
  return sections.flatMap((section) =>
    section.items.map((item) => ({ ...item, sectionLabelKey: section.labelKey })),
  );
}

/**
 * The nav item that OWNS a pathname, or undefined.
 *
 * Exact match only — the prefix walk is the breadcrumb builder's job, and
 * conflating them here would make `/o/acme/p/FLOW/board/t/FLOW-1` claim to BE
 * the board row, which is what an `aria-current="page"` must never say.
 */
export function findByPath(
  pathname: string,
  sections?: readonly NavSection[],
): FlatNavItem | undefined {
  const model = sections ?? allSections(scopeFromNavPath(pathname));
  return flattenNav(model).find((item) => item.path === pathname);
}

/**
 * The org / project a nav-model question is about, read straight off the path.
 *
 * `useRouteScope()` answers the same question with router context, which
 * `findByPath` may not have (the palette mounts above `RouterProvider`). This
 * is deliberately a plain string split rather than a `matchPath` import: the
 * two org-shaped patterns are `/o/:slug` and `/o/:slug/p/:key`, and a nav model
 * that needed the router to name a URL could not be unit-tested against one.
 */
export function scopeFromNavPath(pathname: string): {
  orgSlug: string | null;
  projectKey: string | null;
} {
  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] !== 'o' || segments[1] === undefined) return { orgSlug: null, projectKey: null };
  const orgSlug = segments[1];
  const projectKey = segments[2] === 'p' && segments[3] !== undefined ? segments[3] : null;
  return { orgSlug, projectKey };
}

/**
 * True when a nav row is the active route: exact for `end`, prefix otherwise.
 *
 * The prefix form needs the trailing slash. Without it `/admin/telemetry` would
 * light up on `/admin/telemetry-something-else`, and `/o/acme` would light up
 * on `/o/acmecorp` — the two org slugs a real deployment is most likely to have.
 */
export function isActiveNavPath(item: Pick<NavItem, 'path' | 'end'>, pathname: string): boolean {
  if (item.end === true || item.path === '/') return pathname === item.path;
  return pathname === item.path || pathname.startsWith(`${item.path}/`);
}

/**
 * The nav rows matching a needle, best-effort ranked, for the command palette.
 *
 * MATCHING IS OVER THE TRANSLATED LABEL, never the key: an Arabic session types
 * Arabic and must find the board. Hence the explicit translator — this module
 * stays i18next-free and the caller, which already has a `t`, supplies the
 * words. Keywords are matched too, and are deliberately Latin (see
 * {@link NavItem.keywords}).
 */
export function searchNav(
  sections: readonly NavSection[],
  query: string,
  translate: NavTranslate,
  limit = 9,
): FlatNavItem[] {
  const needle = query.trim().toLowerCase();
  const all = flattenNav(sections).filter((item) => item.inPalette !== false);
  if (needle === '') return all.slice(0, limit);

  return all
    .filter(
      (item) =>
        translate(item.labelKey).toLowerCase().includes(needle) ||
        translate(item.sectionLabelKey).toLowerCase().includes(needle) ||
        (item.keywords ?? []).some((keyword) => keyword.toLowerCase().includes(needle)),
    )
    .slice(0, limit);
}
