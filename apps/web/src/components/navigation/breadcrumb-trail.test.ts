import { describe, expect, it } from 'vitest';

import { buildCrumbs, prettifySegment, type Crumb } from '@/components/navigation/breadcrumb-trail';

/**
 * The breadcrumb trail, per route family.
 *
 * The trail is the topbar's only statement of WHERE the reader is, and it is
 * derived from a URL — so its failure mode is not a crash, it is a trail that
 * quietly says the wrong thing on the routes nobody clicks through by hand.
 * Hence a table per family, and an assertion on the two invariants that must
 * hold for every one of them: the first crumb is Home, and the last crumb is
 * not a link.
 */

/** Reads a crumb as `label|path`, so a table row is one readable string. */
function shape(crumbs: readonly Crumb[]): string[] {
  return crumbs.map((crumb) => {
    const label = crumb.kind === 'key' ? crumb.labelKey : crumb.label;
    return `${label}|${crumb.path ?? '—'}`;
  });
}

const EVERY_PATH = [
  '/',
  '/notifications',
  '/me',
  '/theme',
  '/admin/users',
  '/admin/analytics/traffic',
  '/admin/analytics/traffic/latency',
  '/admin/analytics/engagement/dau',
  '/admin/analytics/traffic/nonsense',
  '/admin/telemetry/events',
  '/o/acme',
  '/o/acme/teams',
  '/o/acme/p/FLOW/board',
  '/o/acme/p/FLOW/settings/labels',
  '/o/acme/p/FLOW/board/t/FLOW-142',
  '/something/nobody/modelled',
];

describe('buildCrumbs — the two invariants', () => {
  it.each(EVERY_PATH)('%s starts at Home and ends somewhere unclickable', (pathname) => {
    const crumbs = buildCrumbs({ pathname });
    expect(crumbs.length).toBeGreaterThan(0);

    const first = crumbs[0];
    expect(first?.kind === 'key' ? first.labelKey : null).toBe('common:nav.home');
    // The last crumb IS the page — `aria-current="page"`, and never a link.
    expect(crumbs.at(-1)?.path).toBeNull();
  });

  it('collapses `/` to a single, unlinked Home crumb', () => {
    expect(shape(buildCrumbs({ pathname: '/' }))).toEqual(['common:nav.home|—']);
  });
});

describe('buildCrumbs — nav routes', () => {
  it('reads an exact nav match as Home › section › item', () => {
    expect(shape(buildCrumbs({ pathname: '/admin/users' }))).toEqual([
      'common:nav.home|/',
      // The section heading is real ancestry but not a place, so it has no path.
      'common:nav.adminSection|—',
      'common:nav.adminUsers|—',
    ]);
  });

  it('names an analytics domain rather than prettifying its URL', () => {
    expect(shape(buildCrumbs({ pathname: '/admin/analytics/traffic' }))).toEqual([
      'common:nav.home|/',
      'common:nav.analyticsSection|—',
      'common:nav.analyticsTraffic|—',
    ]);
  });

  /**
   * The defect W3.1 handed to W3.2: this leaf used to be `prettifySegment`'s
   * "Latency" — and, on the engagement dashboard, "Dau". Neither is a word in
   * Arabic, and neither could ever become one, because a prettified URL segment
   * has no key to translate.
   */
  it('names an analytics metric from the catalog, not from its URL segment', () => {
    expect(shape(buildCrumbs({ pathname: '/admin/analytics/traffic/latency' }))).toEqual([
      'common:nav.home|/',
      'common:nav.analyticsSection|—',
      // The ancestor IS clickable: it is the page this drill-down came from.
      'common:nav.analyticsTraffic|/admin/analytics/traffic',
      'analytics:metrics.traffic.latency.title|—',
    ]);
  });

  it('names the hyphenated metric ids too, which prettify worst of all', () => {
    expect(shape(buildCrumbs({ pathname: '/admin/analytics/engagement/dau' })).at(-1)).toBe(
      'analytics:metrics.engagement.dau.title|—',
    );
    expect(shape(buildCrumbs({ pathname: '/admin/analytics/work/cycle-time' })).at(-1)).toBe(
      'analytics:metrics.work.cycle-time.title|—',
    );
    expect(
      shape(buildCrumbs({ pathname: '/admin/analytics/traffic/top-endpoints' })).at(-1),
    ).toBe('analytics:metrics.traffic.top-endpoints.title|—');
  });

  /**
   * A hand-typed URL must not put a raw i18n key in the topbar. `null` from the
   * catalog lookup drops the whole family back to the generic walk, which still
   * produces a usable trail — one crumb short of a lie.
   */
  it('falls back to prettifying when the metric is not one the console defines', () => {
    expect(shape(buildCrumbs({ pathname: '/admin/analytics/traffic/nonsense' }))).toEqual([
      'common:nav.home|/',
      'common:nav.analyticsSection|—',
      'common:nav.analyticsTraffic|/admin/analytics/traffic',
      'Nonsense|—',
    ]);
  });

  /**
   * `Object.prototype` members are URL segments anybody can type.
   *
   * This caught a live bug beyond the metric lookup: `segmentCrumb`'s plain
   * index into `SEGMENT_LABEL_KEYS` resolved the inherited `toString`, so the
   * trail emitted a FUNCTION as a label key and the topbar rendered
   * `function toString() { [native code] }`. Both lookups use `Object.hasOwn`
   * now, and both paths are asserted here.
   */
  it('is not fooled by an inherited Object property in any segment', () => {
    expect(shape(buildCrumbs({ pathname: '/admin/analytics/traffic/toString' })).at(-1)).toBe(
      'ToString|—',
    );
    expect(shape(buildCrumbs({ pathname: '/o/acme/p/FLOW/settings/constructor' })).at(-1)).toBe(
      'Constructor|—',
    );
  });

  /** Five segments is not a drill-down; the generic walk owns it. */
  it('leaves a deeper URL under a drill-down to the generic walk', () => {
    expect(shape(buildCrumbs({ pathname: '/admin/analytics/traffic/latency/extra' }))).toEqual([
      'common:nav.home|/',
      'common:nav.analyticsSection|—',
      'common:nav.analyticsTraffic|/admin/analytics/traffic',
      'Latency|/admin/analytics/traffic/latency',
      'Extra|—',
    ]);
  });

  it('names a personal page from the Workspace section', () => {
    expect(shape(buildCrumbs({ pathname: '/notifications' }))).toEqual([
      'common:nav.home|/',
      'common:nav.workspaceSection|—',
      'common:nav.notifications|—',
    ]);
  });
});

describe('buildCrumbs — org routes', () => {
  it('reads Home › org › page, with the org linking to its own home', () => {
    expect(shape(buildCrumbs({ pathname: '/o/acme/teams', orgName: 'Acme Corp' }))).toEqual([
      'common:nav.home|/',
      'Acme Corp|/o/acme',
      'common:nav.teams|—',
    ]);
  });

  it('falls back to the slug before the org list has resolved', () => {
    expect(shape(buildCrumbs({ pathname: '/o/acme/teams' }))[1]).toBe('acme|/o/acme');
  });

  it('ends at the org itself on the org home', () => {
    expect(shape(buildCrumbs({ pathname: '/o/acme', orgName: 'Acme Corp' }))).toEqual([
      'common:nav.home|/',
      'Acme Corp|—',
    ]);
  });

  /**
   * `/o/acme/teams` is ALSO an exact nav row (Workspace › Teams). The org
   * branch has to win: a section heading is not the page's ancestor, the
   * organization is.
   */
  it('beats the exact nav match, because the org is the true ancestor', () => {
    const crumbs = buildCrumbs({ pathname: '/o/acme/teams' });
    expect(shape(crumbs)).not.toContain('common:nav.workspaceSection|—');
  });
});

describe('buildCrumbs — project routes', () => {
  it('reads Home › org › KEY › view', () => {
    expect(shape(buildCrumbs({ pathname: '/o/acme/p/FLOW/board', orgName: 'Acme' }))).toEqual([
      'common:nav.home|/',
      'Acme|/o/acme',
      // The project KEY, not its name: the key is what the URL, the task ids
      // and every conversation about the project already use.
      'FLOW|/o/acme/p/FLOW/board',
      'common:nav.board|—',
    ]);
  });

  it('names the project-settings tabs from the catalog', () => {
    expect(shape(buildCrumbs({ pathname: '/o/acme/p/FLOW/settings/labels' }))).toEqual([
      'common:nav.home|/',
      'acme|/o/acme',
      'FLOW|/o/acme/p/FLOW/board',
      'common:nav.projectSettings|/o/acme/p/FLOW/settings',
      'common:nav.labels|—',
    ]);
  });

  it('collapses `/t/:taskKey` into ONE crumb carrying the key', () => {
    const crumbs = shape(buildCrumbs({ pathname: '/o/acme/p/FLOW/board/t/FLOW-142' }));
    expect(crumbs).toEqual([
      'common:nav.home|/',
      'acme|/o/acme',
      'FLOW|/o/acme/p/FLOW/board',
      'common:nav.board|/o/acme/p/FLOW/board',
      'FLOW-142|—',
    ]);
    // "T" is not a place and never appears.
    expect(crumbs.some((crumb) => crumb.startsWith('T|'))).toBe(false);
  });
});

describe('buildCrumbs — unmodelled URLs', () => {
  it('prettifies the segments rather than giving up on the trail', () => {
    expect(shape(buildCrumbs({ pathname: '/something/nobody/modelled' }))).toEqual([
      'common:nav.home|/',
      'Something|/something',
      'Nobody|/something/nobody',
      'Modelled|—',
    ]);
  });
});

describe('prettifySegment', () => {
  it.each([
    ['events', 'Events'],
    ['top-endpoints', 'Top Endpoints'],
    ['a', 'A'],
    ['', ''],
  ])('%s → %s', (input, expected) => {
    expect(prettifySegment(input)).toBe(expected);
  });
});
