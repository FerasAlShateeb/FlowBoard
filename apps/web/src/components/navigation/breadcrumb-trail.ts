import {
  findByPath,
  flattenNav,
  buildSections,
  scopeFromNavPath,
  type NavLabelKey,
  type NavSectionKey,
} from '@/components/navigation/nav.config';
import {
  metricTitleKey,
  type MetricTitleKey,
} from '@/components/admin/analytics/metric-catalog';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * The breadcrumb trail, derived from the nav model. Pure.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The topbar's start slot was empty before Round 2 — the comment in `Topbar.tsx`
 * said a breadcrumb "needs resolved names that only a later wave can supply",
 * and the later wave never came back for it. It matters most on exactly the
 * routes where the rest of the chrome was thinnest: an admin three levels into
 * `/admin/analytics/traffic` had no on-screen statement of where they were and
 * no ancestor to click.
 *
 * WHY THE TRAIL IS DATA, NOT JSX. A crumb is either a nav destination (whose
 * label is an i18n KEY the render site resolves with its own `t`) or a piece of
 * the URL that no catalog can name — an org's display name, a project key, a
 * task key. Modelling both as {@link Crumb} keeps this module i18next-free and
 * router-free, which is what lets every route family below be asserted in a
 * node test instead of through a render.
 */

/**
 * Every catalog key a crumb may carry.
 *
 * A superset of the nav model's own keys: the project-settings TABS
 * (`general`, `workflow`, `labels`) are real destinations with real catalog
 * entries, but they are not sidebar rows, so `NavLabelKey` does not — and
 * should not — name them. Spelling the union out here keeps `t(crumb.labelKey)`
 * compile-checked at the render site without widening the nav model.
 */
export type CrumbLabelKey =
  | NavLabelKey
  | NavSectionKey
  | 'common:nav.general'
  | 'common:nav.workflow'
  | 'common:nav.labels'
  | 'common:nav.task'
  /**
   * The analytics DRILL-DOWNS (W3.2). `/admin/analytics/:domain/:metric` is the
   * one route family whose leaf is named by a catalog OTHER than `common` —
   * twenty metrics, whose titles already exist as `analytics:metrics.*` because
   * the detail page's own `<h1>` renders them. Reusing those keys is what stops
   * a crumb and the heading directly under it from disagreeing, and it is why
   * this is a second namespace rather than twenty more `common:nav.*` rows.
   *
   * Note this widens the union to a COMPUTED member: `MetricTitleKey` is
   * derived from `locales/en/analytics.ts`, so a renamed metric title is a
   * compile error at the render site with nobody having to edit this list.
   */
  | MetricTitleKey;

/** A crumb whose words come from the catalog. */
export interface KeyCrumb {
  kind: 'key';
  labelKey: CrumbLabelKey;
  /** Route to link to, or null for a non-navigable crumb (headings, the last). */
  path: string | null;
}

/**
 * A crumb whose words come from the DATA — an org name, `FLOW`, `FLOW-142`.
 *
 * Deliberately not translated. There is no fixed set of these to put in a
 * catalog, and inventing Arabic for a project key would hide which project you
 * are looking at.
 */
export interface TextCrumb {
  kind: 'text';
  label: string;
  path: string | null;
}

export type Crumb = KeyCrumb | TextCrumb;

/** What the trail needs beyond the URL itself. */
export interface BreadcrumbInput {
  pathname: string;
  /**
   * The display name of the org in the path, when the org list has resolved.
   * Falls back to the slug — a trail that waits for a query is a trail that
   * flickers on every navigation.
   */
  orgName?: string | null;
}

/**
 * Prettifies a raw URL segment (`uno-no-mercy` → `Uno No Mercy`).
 *
 * The escape hatch for a sub-route the nav model does not name. Untranslated
 * for the same reason {@link TextCrumb} is: this is the URL made readable, and
 * an Arabic word invented for an English slug would say less, not more.
 */
export function prettifySegment(segment: string): string {
  return segment
    .split('-')
    .map((part) => (part === '' ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ');
}

/**
 * Trailing segments the catalog DOES name — the project-settings tabs.
 *
 * A closed map rather than a `` `common:nav.${segment}` `` template, so a
 * renamed key is a compile error here rather than a raw key rendered in a
 * topbar. Anything absent falls through to {@link prettifySegment}.
 */
const SEGMENT_LABEL_KEYS: Readonly<Record<string, CrumbLabelKey>> = {
  general: 'common:nav.general',
  workflow: 'common:nav.workflow',
  members: 'common:nav.members',
  labels: 'common:nav.labels',
};

/**
 * A crumb for one trailing segment: catalog key if we have one, else the URL.
 *
 * `Object.hasOwn` and not a plain index (W3.2). A URL segment is a string
 * anybody can type, and `SEGMENT_LABEL_KEYS['toString']` resolves the INHERITED
 * `Object.prototype.toString` — a function, which passes the `!== undefined`
 * guard and was then handed to `t()` as a label key. `/o/acme/p/FLOW/toString`
 * rendered `function toString() { [native code] }` in the topbar. The same
 * reasoning, and the same fix, as `metric-registry.lookupMetric`.
 */
function segmentCrumb(segment: string, path: string): Crumb {
  if (Object.hasOwn(SEGMENT_LABEL_KEYS, segment)) {
    const labelKey = SEGMENT_LABEL_KEYS[segment];
    if (labelKey !== undefined) return { kind: 'key', labelKey, path };
  }
  return { kind: 'text', label: prettifySegment(segment), path };
}

/**
 * A crumb for a path the nav model may already name.
 *
 * The model is asked FIRST — `/o/acme/teams` and `/o/acme/p/FLOW/board` are
 * both nav rows, and a crumb reading "Teams" from the catalog is a crumb that
 * translates, where the prettified URL segment forever is not. Only a path the
 * model has never heard of falls through to {@link segmentCrumb}.
 */
function navCrumb(segment: string, path: string): Crumb {
  const item = findByPath(path);
  if (item !== undefined) return { kind: 'key', labelKey: item.labelKey, path };
  return segmentCrumb(segment, path);
}

/** The last crumb is where you ARE — it links nowhere. */
function sealTrail(crumbs: Crumb[]): Crumb[] {
  const last = crumbs.at(-1);
  if (last === undefined) return crumbs;
  return [...crumbs.slice(0, -1), { ...last, path: null }];
}

const HOME: KeyCrumb = { kind: 'key', labelKey: 'common:nav.home', path: '/' };

/**
 * The trail for an analytics drill-down, or `null` if this is not one.
 *
 * `[Home, Analytics, {Domain}, {Metric}]` — four crumbs for a four-segment URL.
 * The DOMAIN crumb comes from the nav model exactly as it does on the dashboard
 * itself (`common:nav.analyticsTraffic`), so the drill-down and the page it
 * drilled from are named by one string; the METRIC crumb comes from the
 * analytics catalog, which is where the detail page's own `<h1>` already gets
 * it. Neither is a prettified URL segment, which is the whole point: the
 * generic tail-walk below rendered "Dau" here — in every language, including
 * the one that has no letter D.
 *
 * Returns `null` — never a partial trail — for anything that only LOOKS like a
 * drill-down: an unknown metric, a fifth segment, a domain the sidebar does not
 * carry. The generic path then handles it and the reader still gets a trail.
 */
function analyticsDrillDown(pathname: string, segments: readonly string[]): Crumb[] | null {
  if (segments.length !== 4) return null;
  if (segments[0] !== 'admin' || segments[1] !== 'analytics') return null;

  const labelKey = metricTitleKey(segments[2], segments[3]);
  if (labelKey === null) return null;

  const domainPath = pathname.slice(0, pathname.lastIndexOf('/'));
  const domain = findByPath(domainPath);
  if (domain === undefined) return null;

  return [
    HOME,
    { kind: 'key', labelKey: domain.sectionLabelKey, path: null },
    // Clickable: it is the dashboard this drill-down came from, and the tile
    // that opened it is on that page.
    { kind: 'key', labelKey: domain.labelKey, path: domainPath },
    { kind: 'key', labelKey, path: null },
  ];
}

/**
 * The trail for a pathname.
 *
 * FIVE ROUTE FAMILIES, in the order they are tried — the order matters, because
 * an org route ALSO has an exact nav match and the two answers differ:
 *
 *  1. **`/`** — one crumb. You are home; there is nothing above it.
 *  2. **Project routes** — `[Home, {org}, FLOW, {view}]`. The project KEY is
 *     the crumb, not the project's name: the key is what the tasks, the URL and
 *     every conversation about the project use, and it is the short one.
 *  3. **Org routes** — `[Home, {org}, {page}]`. The org's own crumb links to its
 *     home, which is the ancestor an org page actually has. Note this is
 *     REACHED FIRST, ahead of the exact match below: `/o/acme/teams` is a nav
 *     row (Workspace › Teams), but "Home › Acme › Teams" is the true ancestry
 *     and a section heading is not a place you can go.
 *  4. **Analytics drill-downs** — `/admin/analytics/:domain/:metric`, whose
 *     leaf is named by the analytics catalog rather than by the URL. Tried
 *     BEFORE the generic nav walk, which would otherwise reach it and prettify
 *     the metric id. See {@link analyticsDrillDown}.
 *  5. **Everything else** — the nav model answers it: an exact match yields
 *     `[Home, {section}, {item}]`, and a deeper URL under a known item yields
 *     that item plus its prettified tail.
 */
export function buildCrumbs(input: BreadcrumbInput): Crumb[] {
  const { pathname } = input;

  if (pathname === '/') return [{ kind: 'key', labelKey: 'common:nav.home', path: null }];

  const scope = scopeFromNavPath(pathname);
  const segments = pathname.split('/').filter(Boolean);

  if (scope.orgSlug !== null) {
    const orgHome = `/o/${scope.orgSlug}`;
    const crumbs: Crumb[] = [
      HOME,
      { kind: 'text', label: input.orgName ?? scope.orgSlug, path: orgHome },
    ];

    if (scope.projectKey !== null) {
      // `…/board` is the project's front door — the same destination the
      // palette's task rows use, and the only project route that needs no
      // further choice from the reader.
      const projectHome = `/o/${scope.orgSlug}/p/${scope.projectKey}/board`;
      crumbs.push({ kind: 'text', label: scope.projectKey, path: projectHome });

      // Everything after `/o/:slug/p/:key`.
      let walked = `/o/${scope.orgSlug}/p/${scope.projectKey}`;
      const tail = segments.slice(4);
      for (let index = 0; index < tail.length; index += 1) {
        const segment = tail[index];
        if (segment === undefined) continue;
        // `/t/:taskKey` collapses to ONE crumb carrying the key — "T › FLOW-142"
        // is two crumbs for one thing, and `T` names nothing.
        if (segment === 't' && tail[index + 1] !== undefined) {
          const taskKey = tail[index + 1] ?? '';
          walked = `${walked}/t/${taskKey}`;
          crumbs.push({ kind: 'text', label: taskKey, path: walked });
          index += 1;
          continue;
        }
        walked = `${walked}/${segment}`;
        crumbs.push(navCrumb(segment, walked));
      }

      return sealTrail(crumbs);
    }

    let walked = orgHome;
    for (const segment of segments.slice(2)) {
      walked = `${walked}/${segment}`;
      crumbs.push(navCrumb(segment, walked));
    }
    return sealTrail(crumbs);
  }

  const drillDown = analyticsDrillDown(pathname, segments);
  if (drillDown !== null) return drillDown;

  const exact = findByPath(pathname);
  if (exact !== undefined) {
    return sealTrail([
      HOME,
      { kind: 'key', labelKey: exact.sectionLabelKey, path: null },
      { kind: 'key', labelKey: exact.labelKey, path: exact.path },
    ]);
  }

  // The DEEPEST nav item whose path is a prefix of this one — `/admin/telemetry`
  // for `/admin/telemetry/events` had that page not been a row of its own, and
  // `/admin/analytics/traffic` for a drill-down under it.
  const prefix = flattenNav(
    buildSections({
      orgSlug: null,
      projectKey: null,
      effectiveAdmin: true,
      defaultOrgSlug: null,
      lastOrgSlug: null,
    }),
  )
    .filter((item) => item.path !== '/' && pathname.startsWith(`${item.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];

  if (prefix === undefined) {
    // An unmodelled top-level URL (a 404, or a route a later wave adds without
    // a nav row). The URL itself, made readable, beats a bare "Home".
    const crumbs: Crumb[] = [HOME];
    let walked = '';
    for (const segment of segments) {
      walked = `${walked}/${segment}`;
      crumbs.push(segmentCrumb(segment, walked));
    }
    return sealTrail(crumbs);
  }

  const crumbs: Crumb[] = [
    HOME,
    { kind: 'key', labelKey: prefix.sectionLabelKey, path: null },
    { kind: 'key', labelKey: prefix.labelKey, path: prefix.path },
  ];
  let walked = prefix.path;
  for (const segment of pathname.slice(prefix.path.length).split('/').filter(Boolean)) {
    walked = `${walked}/${segment}`;
    crumbs.push(segmentCrumb(segment, walked));
  }
  return sealTrail(crumbs);
}
