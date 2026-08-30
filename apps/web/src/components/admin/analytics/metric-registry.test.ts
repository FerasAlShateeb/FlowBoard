import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { analyticsDomainSchema, type AnalyticsDomain } from '@flowboard/shared';

import en from '@/locales/en';
import ar from '@/locales/ar';
import { useAuthStore } from '@/stores/useAuthStore';
import { metricTitleKey } from '@/components/admin/analytics/metric-catalog';
import {
  __clearMetricDomainCache,
  compareRows,
  detailPath,
  DOMAIN_ERROR_KEYS,
  DOMAIN_LABEL_KEYS,
  DOMAIN_PATHS,
  fromSeries,
  INTERVAL_LABEL_KEYS,
  LATENCY_LADDER,
  lookupMetric,
  METRIC_PAGE_SIZE,
  METRIC_REGISTRY,
  optionsOf,
  resolveFacetOptions,
  sortRows,
  STATUS_CLASSES,
  type MetricColumn,
  type MetricDefinition,
  type MetricRow,
  type MetricTranslate,
} from '@/components/admin/analytics/metric-registry';

/**
 * The registry's contract, asserted without rendering anything.
 *
 * ═══ WHY AN EXHAUSTIVENESS TEST EXISTS AT ALL ════════════════════════════
 *
 * `AnalyticsKey` already makes a key that is not in the ENGLISH catalog a
 * compile error, which is most of the guarantee. It cannot make an untranslated
 * key an error, because Arabic is never typed against (English owns the shape —
 * see `i18n/i18next.d.ts`), and it cannot notice a metric that exists in the
 * registry with no `metrics.<domain>.<metric>` entry behind it. Both of those
 * are exactly how a console ships a card whose header reads
 * `analytics:metrics.work.cycle-time.title` to an Arabic-speaking admin.
 *
 * So this walks the WHOLE registry and resolves every key it stores against
 * BOTH catalogs, and does the same for the four key maps beside it. A metric
 * added without copy fails here, in both languages, before anyone renders it.
 */

/** The same flattening `i18n/locales.test.ts` uses, one key at a time. */
function read(catalog: Record<string, unknown>, key: string): unknown {
  const [namespace, path] = key.split(':');
  if (namespace === undefined || path === undefined) return undefined;
  return path
    .split('.')
    .reduce<unknown>(
      (value, segment) =>
        value === null || typeof value !== 'object'
          ? undefined
          : (value as Record<string, unknown>)[segment],
      catalog[namespace],
    );
}

const CATALOGS = {
  en: en as unknown as Record<string, unknown>,
  ar: ar as unknown as Record<string, unknown>,
} as const;

/** A translator that RESOLVES rather than echoes, so a miss is visible. */
const translate = (catalog: Record<string, unknown>): MetricTranslate => {
  return (key) => {
    const value = read(catalog, key);
    return typeof value === 'string' ? value : `MISSING:${key}`;
  };
};

const DOMAINS = analyticsDomainSchema.options;

/** Every `[domain, metric, definition]` triple in the registry. */
function entries(): [AnalyticsDomain, string, MetricDefinition][] {
  const out: [AnalyticsDomain, string, MetricDefinition][] = [];
  for (const domain of DOMAINS) {
    const metrics = METRIC_REGISTRY[domain] as unknown as Record<string, MetricDefinition>;
    for (const [metric, definition] of Object.entries(metrics)) {
      out.push([domain, metric, definition]);
    }
  }
  return out;
}

/** Every i18n key one definition stores, flattened. */
function keysOf(definition: MetricDefinition): string[] {
  const keys: string[] = [definition.titleKey];
  if (definition.subtitleKey !== undefined) keys.push(definition.subtitleKey);
  if (definition.series) keys.push(definition.series.labelKey);
  for (const column of definition.columns) keys.push(column.headerKey);
  for (const filter of definition.filters ?? []) {
    keys.push(filter.labelKey);
    // Derived option lists (the org facet) carry runtime names, not keys.
    if (typeof filter.options !== 'function') {
      for (const option of filter.options) {
        if (option.labelKey !== undefined) keys.push(option.labelKey);
      }
    }
  }
  return keys;
}

const ALL = entries();

// ═══════════════════════════════════════════════════════════════════════════
// 1. Shape
// ═══════════════════════════════════════════════════════════════════════════

describe('METRIC_REGISTRY — shape', () => {
  it('covers the four drillable domains, and only those', () => {
    expect(Object.keys(METRIC_REGISTRY).sort()).toEqual([...DOMAINS].sort());
  });

  it('declares the twenty metrics the plan names', () => {
    expect(Object.keys(METRIC_REGISTRY.engagement)).toEqual([
      'dau',
      'signups',
      'stickiness',
      'activity-by-hour',
      'events-by-type',
    ]);
    expect(Object.keys(METRIC_REGISTRY.work)).toEqual([
      'tasks-created',
      'tasks-completed',
      'cycle-time',
      'points-completed',
      'by-project',
    ]);
    expect(Object.keys(METRIC_REGISTRY.traffic)).toEqual([
      'requests',
      'errors',
      'error-rate',
      'latency',
      'top-endpoints',
      'status-breakdown',
    ]);
    expect(Object.keys(METRIC_REGISTRY.growth)).toEqual([
      'orgs-created',
      'invites-sent',
      'invites-accepted',
      'by-org',
    ]);
    expect(ALL).toHaveLength(20);
  });

  it('gives every metric at least one column and a back link to its own domain', () => {
    for (const [domain, metric, definition] of ALL) {
      expect([metric, definition.columns.length > 0]).toEqual([metric, true]);
      // The back link is the dashboard, never another metric's detail page.
      expect([metric, definition.backTo]).toEqual([metric, DOMAIN_PATHS[domain]]);
    }
  });

  it('keeps every column key unique inside one metric', () => {
    // Duplicated ids would collide in `DataTable`'s column model and in the
    // CSV's header row, where the second silently overwrites the first.
    for (const [, metric, definition] of ALL) {
      const ids = definition.columns.map((column) => column.key);
      expect([metric, ids.length]).toEqual([metric, new Set(ids).size]);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. i18n exhaustiveness — BOTH catalogs
// ═══════════════════════════════════════════════════════════════════════════

describe.each(['en', 'ar'] as const)('METRIC_REGISTRY — resolves in `%s`', (language) => {
  const catalog = CATALOGS[language];

  it('resolves every title and subtitle', () => {
    const missing = ALL.filter(
      ([, , definition]) =>
        typeof read(catalog, definition.titleKey) !== 'string' ||
        (definition.subtitleKey !== undefined &&
          typeof read(catalog, definition.subtitleKey) !== 'string'),
    ).map(([domain, metric]) => `${domain}/${metric}`);

    expect(missing).toEqual([]);
  });

  it('resolves every column header, series name and facet label', () => {
    const missing: string[] = [];
    for (const [domain, metric, definition] of ALL) {
      for (const key of keysOf(definition)) {
        if (typeof read(catalog, key) !== 'string') missing.push(`${domain}/${metric}: ${key}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('resolves the four key maps beside the registry', () => {
    const keys = [
      ...Object.values(DOMAIN_LABEL_KEYS),
      ...Object.values(DOMAIN_ERROR_KEYS),
      ...Object.values(INTERVAL_LABEL_KEYS),
    ];
    const missing = keys.filter((key) => typeof read(catalog, key) !== 'string');
    expect(missing).toEqual([]);
  });

  it('has a `metrics.<domain>.<metric>` entry for every registry id and no orphans', () => {
    // The mirror image of the checks above: a catalog entry with no metric
    // behind it is copy nobody can ever reach, and usually means a rename
    // landed on one side only.
    for (const domain of DOMAINS) {
      const catalogIds = Object.keys(
        (read(catalog, `analytics:metrics.${domain}`) ?? {}) as Record<string, unknown>,
      ).sort();
      const registryIds = Object.keys(METRIC_REGISTRY[domain]).sort();
      expect([domain, catalogIds]).toEqual([domain, registryIds]);
    }
  });

  /**
   * ═══ THE PREMISE `metric-catalog.ts` RESTS ON ════════════════════════════
   *
   * `components/navigation/breadcrumb-trail.ts` must name a drill-down's leaf
   * ("Daily active users", not the prettified segment "Dau") and must stay a
   * pure function of a URL — no `lib/api`, no live i18next. So it asks
   * `metricTitleKey()`, which reads the CATALOG, where this file's `lookupMetric`
   * reads the REGISTRY.
   *
   * Those are only interchangeable while the two id sets agree, which the test
   * directly above enforces. This one closes the loop from the other end: for
   * every id, the two functions must agree on *existence*, and the key handed
   * back must be exactly the `titleKey` the detail page's own heading renders —
   * so a crumb and the `<h1>` under it can never say different things.
   */
  it('agrees with `metricTitleKey`, which the breadcrumb trail uses instead', () => {
    for (const [domain, metric, definition] of ALL) {
      expect([domain, metric, metricTitleKey(domain, metric)]).toEqual([
        domain,
        metric,
        definition.titleKey,
      ]);
    }
  });

  it('answers `null` from `metricTitleKey` wherever `lookupMetric` answers null', () => {
    const unknowns: [string | undefined, string | undefined][] = [
      ['traffic', 'nonsense'],
      ['nonsense', 'latency'],
      ['overview', 'anything'],
      ['traffic', 'toString'],
      ['toString', 'latency'],
      [undefined, 'latency'],
      ['traffic', undefined],
    ];
    for (const [domain, metric] of unknowns) {
      expect([domain, metric, metricTitleKey(domain, metric)]).toEqual([domain, metric, null]);
      expect([domain, metric, lookupMetric(domain, metric)]).toEqual([domain, metric, null]);
    }
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 3. detailPath / lookupMetric
// ═══════════════════════════════════════════════════════════════════════════

describe('detailPath', () => {
  it('round-trips EVERY metric back through lookupMetric', () => {
    for (const [domain, metric, definition] of ALL) {
      const path = detailPath(domain, metric as never);
      expect(path).toBe(`/admin/analytics/${domain}/${metric}`);

      const [, , , routeDomain, routeMetric] = path.split('/');
      expect([path, lookupMetric(routeDomain, routeMetric)]).toEqual([path, definition]);
    }
  });

  it('builds on DOMAIN_PATHS, so a dashboard and its drill-downs cannot diverge', () => {
    for (const domain of DOMAINS) {
      expect(detailPath(domain, Object.keys(METRIC_REGISTRY[domain])[0] as never)).toContain(
        DOMAIN_PATHS[domain],
      );
    }
  });
});

describe('lookupMetric', () => {
  it('returns null for an unknown metric inside a real domain', () => {
    expect(lookupMetric('traffic', 'nonsense')).toBeNull();
  });

  it('returns null for `overview`, which deliberately has no registry', () => {
    // `/admin/analytics/overview/x` must reach the not-found card rather than
    // promising a drill-down that has no metrics behind it.
    expect(lookupMetric('overview', 'dau')).toBeNull();
  });

  it('returns null for missing segments rather than throwing', () => {
    expect(lookupMetric(undefined, 'dau')).toBeNull();
    expect(lookupMetric('traffic', undefined)).toBeNull();
  });

  it('is not fooled by inherited Object properties', () => {
    // `METRIC_REGISTRY['constructor']` is truthy on a plain object lookup; a
    // pasted URL must not resolve one.
    expect(lookupMetric('constructor', 'dau')).toBeNull();
    expect(lookupMetric('traffic', 'toString')).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 4. Sorting — nullish last, in BOTH directions
// ═══════════════════════════════════════════════════════════════════════════

describe('compareRows', () => {
  it('sinks nullish and blank values in ascending order', () => {
    expect(compareRows(null, 5, 1)).toBeGreaterThan(0);
    expect(compareRows(undefined, 5, 1)).toBeGreaterThan(0);
    expect(compareRows('', 'a', 1)).toBeGreaterThan(0);
  });

  it('STILL sinks them descending — an absent value is not a large one either', () => {
    expect(compareRows(null, 5, -1)).toBeGreaterThan(0);
    expect(compareRows(5, null, -1)).toBeLessThan(0);
  });

  it('treats two empties as equal', () => {
    expect(compareRows(null, '', 1)).toBe(0);
  });

  it('compares numbers numerically, not lexically', () => {
    // The bug this exists to prevent: `9` after `10`.
    expect(compareRows(9, 10, 1)).toBeLessThan(0);
  });
});

describe('sortRows', () => {
  const columns: MetricColumn[] = [
    {
      key: 'cycle',
      headerKey: 'analytics:columns.cycleTime',
      value: () => '',
      accessor: (row) => (row.cycle === null ? null : Number(row.cycle)),
    },
    { key: 'plain', headerKey: 'analytics:columns.bucket', value: () => '' },
  ];

  const rows: MetricRow[] = [{ cycle: 12 }, { cycle: null }, { cycle: 3 }];

  it('puts the null LAST ascending and descending alike', () => {
    expect(sortRows(rows, { sort: 'cycle', order: 'asc' }, columns).map((r) => r.cycle)).toEqual([
      3, 12, null,
    ]);
    expect(sortRows(rows, { sort: 'cycle', order: 'desc' }, columns).map((r) => r.cycle)).toEqual([
      12, 3, null,
    ]);
  });

  it('leaves the loader order alone for a column with NO accessor', () => {
    // The latency ladder's guarantee: p50 → max is the meaning, and a sort that
    // scrambled it would destroy the only thing it communicates.
    expect(sortRows(rows, { sort: 'plain', order: 'asc' }, columns)).toBe(rows);
  });

  it('leaves the loader order alone when nothing is sorted', () => {
    expect(sortRows(rows, {}, columns)).toBe(rows);
    expect(sortRows(rows, undefined, columns)).toBe(rows);
  });

  it('does not mutate the input', () => {
    const original = [...rows];
    sortRows(rows, { sort: 'cycle', order: 'desc' }, columns);
    expect(rows).toEqual(original);
  });
});

describe('the latency metric', () => {
  it('gives NO column an accessor, so its ladder can never be re-sorted', () => {
    const latency = METRIC_REGISTRY.traffic.latency;
    expect(latency.columns.every((column) => column.accessor === undefined)).toBe(true);
  });

  it('offers no CSV — five rows you can read at a glance are not a file', () => {
    expect(METRIC_REGISTRY.traffic.latency.csv).toBeUndefined();
  });

  it('climbs p50 → max, which is the reading order', () => {
    expect(LATENCY_LADDER).toEqual(['p50', 'p90', 'p95', 'p99', 'max']);
  });
});

describe('CSV configuration', () => {
  it('gives every other metric a filename stem, and every stem is unique', () => {
    const stems = ALL.filter(([, metric]) => metric !== 'latency').map(([domain, metric, def]) => {
      expect([`${domain}/${metric}`, def.csv?.stem !== undefined]).toEqual([
        `${domain}/${metric}`,
        true,
      ]);
      return def.csv?.stem;
    });
    expect(stems.length).toBe(new Set(stems).size);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 5. Facets
// ═══════════════════════════════════════════════════════════════════════════

describe('facets', () => {
  const facetOf = (domain: AnalyticsDomain, metric: string, key: string) => {
    const definition = lookupMetric(domain, metric);
    const facet = definition?.filters?.find((entry) => entry.key === key);
    if (!facet) throw new Error(`no ${key} facet on ${domain}/${metric}`);
    return facet;
  };

  it('matches an event type exactly', () => {
    const facet = facetOf('engagement', 'events-by-type', 'type');
    expect(facet.match({ type: 'auth_login' }, 'auth_login')).toBe(true);
    expect(facet.match({ type: 'page_view' }, 'auth_login')).toBe(false);
  });

  it('matches an HTTP method exactly', () => {
    const facet = facetOf('traffic', 'top-endpoints', 'method');
    expect(facet.match({ method: 'GET' }, 'GET')).toBe(true);
    expect(facet.match({ method: 'POST' }, 'GET')).toBe(false);
  });

  it('matches a status class against the row LABEL, which is what carries it', () => {
    const facet = facetOf('traffic', 'status-breakdown', 'statusClass');
    expect(facet.match({ label: '5xx' }, '5xx')).toBe(true);
    expect(facet.match({ label: '2xx' }, '5xx')).toBe(false);
    // The four classes the API always zero-fills.
    expect(STATUS_CLASSES).toEqual(['2xx', '3xx', '4xx', '5xx']);
  });

  it('derives the organization facet from the ROWS, deduped and sorted by name', () => {
    // A closed list would be a lie the moment somebody creates an org.
    const facet = facetOf('work', 'by-project', 'orgSlug');
    const options = resolveFacetOptions(facet, [
      { orgSlug: 'zebra', orgName: 'Zebra' },
      { orgSlug: 'acme', orgName: 'Acme' },
      { orgSlug: 'acme', orgName: 'Acme' },
    ]);
    expect(options).toEqual([
      { value: 'acme', label: 'Acme' },
      { value: 'zebra', label: 'Zebra' },
    ]);
    expect(facet.match({ orgSlug: 'acme' }, 'acme')).toBe(true);
  });

  it('offers NO empty "all" sentinel — the facet has its own Clear row', () => {
    for (const [, , definition] of ALL) {
      for (const filter of definition.filters ?? []) {
        if (typeof filter.options === 'function') continue;
        expect(filter.options.every((option) => option.value !== '')).toBe(true);
      }
    }
  });
});

describe('optionsOf', () => {
  it('translates a `labelKey` and passes a `label` through untouched', () => {
    const tk = translate(CATALOGS.en);
    expect(
      optionsOf(
        [
          { value: 'auth_login', labelKey: 'admin:eventType.auth_login' },
          { value: 'GET', label: 'GET' },
        ],
        tk,
      ),
    ).toEqual([
      { value: 'auth_login', label: 'Signed in' },
      // An HTTP method IS the identifier it filters on; translating it would
      // stop it matching the row it selects.
      { value: 'GET', label: 'GET' },
    ]);
  });

  it('falls back to the raw value when a label was never supplied', () => {
    expect(optionsOf([{ value: 'x' }], translate(CATALOGS.en))).toEqual([
      { value: 'x', label: 'x' },
    ]);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 6. fromSeries
// ═══════════════════════════════════════════════════════════════════════════

describe('fromSeries', () => {
  const series = [
    { t: '2026-07-03T00:00:00.000Z', value: 1 },
    { t: '2026-07-10T00:00:00.000Z', value: 2 },
  ];

  it('keeps chart points OLDEST first and table rows NEWEST first', () => {
    const { points, rows } = fromSeries(series, 'day');
    expect(points.map((p) => p.value)).toEqual([1, 2]);
    expect(rows.map((r) => r.value)).toEqual([2, 1]);
  });

  it('carries the RAW `t` on every row, so the Bucket column sorts by time', () => {
    // `Jul 3` before `Jul 10` — which a lexical sort of the LABEL gets backwards.
    const { rows } = fromSeries(series, 'day');
    expect(rows.map((r) => r.t)).toEqual([series[1]?.t, series[0]?.t]);
  });

  it('gives every row a display label', () => {
    const { rows } = fromSeries(series, 'day');
    expect(rows.every((row) => typeof row.label === 'string' && row.label !== '')).toBe(true);
  });

  it('survives an empty series', () => {
    expect(fromSeries([], 'day')).toEqual({ points: [], rows: [] });
  });
});

describe('METRIC_PAGE_SIZE', () => {
  it('is the comfort number, not a protection — every payload here is bounded', () => {
    expect(METRIC_PAGE_SIZE).toBe(25);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 7. fetch — load once, then project
// ═══════════════════════════════════════════════════════════════════════════

describe('defineMetric#fetch', () => {
  const WINDOW = {
    from: '2026-08-01T00:00:00.000Z',
    to: '2026-08-03T00:00:00.000Z',
    interval: 'day' as const,
  };

  const TRAFFIC = {
    requestsSeries: [],
    errorSeries: [],
    errorRateSeries: [],
    latency: { p50: 1, p90: 2, p95: 3, p99: 4, max: 5 },
    topEndpoints: [
      { method: 'GET', path: '/a', count: 3, avgDurationMs: 1, errorRate: 0 },
      { method: 'POST', path: '/b', count: 2, avgDurationMs: 2, errorRate: 0.5 },
      { method: 'GET', path: '/c', count: 1, avgDurationMs: 3, errorRate: 0 },
    ],
    statusBreakdown: { '2xx': 5, '3xx': 0, '4xx': 1, '5xx': 0 },
  };

  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    __clearMetricDomainCache();
    useAuthStore.setState({ accessToken: 'token', refreshToken: null, user: null });
    // A fresh `Response` per call — a body can only be read once.
    fetchMock = vi.fn().mockImplementation(
      () =>
        new Promise<Response>((resolve) => {
          resolve(
            new Response(JSON.stringify({ success: true, data: TRAFFIC }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          );
        }),
    );
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    __clearMetricDomainCache();
  });

  it('reads the DOMAIN endpoint — there is no per-metric route on the server', async () => {
    await METRIC_REGISTRY.traffic['top-endpoints'].fetch(WINDOW, {}, 1);

    const url = String(fetchMock.mock.calls[0]?.[0] ?? '');
    expect(url).toContain('/api/admin/analytics/traffic');
    expect(url).not.toContain('top-endpoints');
  });

  it('projects a facet change WITHOUT a second request', async () => {
    const all = await METRIC_REGISTRY.traffic['top-endpoints'].fetch(WINDOW, {}, 1);
    expect(all.total).toBe(3);

    const filtered = await METRIC_REGISTRY.traffic['top-endpoints'].fetch(
      WINDOW,
      { method: 'GET' },
      1,
    );

    expect(filtered.total).toBe(2);
    // The payload did not change; only the predicate over it did. Re-running a
    // `generate_series` aggregate for that would be the whole point missed.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('shares ONE in-flight request between two metrics of the same domain', async () => {
    await Promise.all([
      METRIC_REGISTRY.traffic.latency.fetch(WINDOW, {}, 1),
      METRIC_REGISTRY.traffic['status-breakdown'].fetch(WINDOW, {}, 1),
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refetches when the WINDOW moves', async () => {
    await METRIC_REGISTRY.traffic.latency.fetch(WINDOW, {}, 1);
    await METRIC_REGISTRY.traffic.latency.fetch({ ...WINDOW, interval: 'hour' }, {}, 1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does NOT cache a rejection — the error state’s retry must reach the network', async () => {
    __clearMetricDomainCache();
    fetchMock.mockImplementationOnce(() => Promise.reject(new Error('down')));

    await expect(METRIC_REGISTRY.traffic.latency.fetch(WINDOW, {}, 1)).rejects.toThrow();
    // The retry succeeds rather than replaying the cached failure forever.
    await expect(METRIC_REGISTRY.traffic.latency.fetch(WINDOW, {}, 1)).resolves.toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('resolves facet options from the UNFILTERED rows', async () => {
    // Narrowing to one method must not then hide every other method from the
    // control you would use to widen again.
    const page = await METRIC_REGISTRY.traffic['top-endpoints'].fetch(
      WINDOW,
      { method: 'POST' },
      1,
    );
    expect(page.total).toBe(1);
    expect(page.facetOptions.method?.map((option) => option.value)).toEqual([
      'GET',
      'POST',
      'PATCH',
      'PUT',
      'DELETE',
    ]);
  });

  it('carries the whole filtered set in `exportRows`, not just the page', async () => {
    const page = await METRIC_REGISTRY.traffic['top-endpoints'].fetch(WINDOW, {}, 1);
    // A CSV built from `rows` would depend on which page the reader was on.
    expect(page.exportRows).toHaveLength(3);
    expect(page.rows).toHaveLength(3);
    expect(page.pageSize).toBe(METRIC_PAGE_SIZE);
  });

  it('clamps a nonsense page number rather than returning an empty slice', async () => {
    const page = await METRIC_REGISTRY.traffic['top-endpoints'].fetch(WINDOW, {}, 0);
    expect(page.page).toBe(1);
    expect(page.rows).toHaveLength(3);
  });

  it('sorts the FULL set before paging, so page 1 is the real page 1', async () => {
    const page = await METRIC_REGISTRY.traffic['top-endpoints'].fetch(WINDOW, {}, 1, {
      sort: 'value',
      order: 'desc',
    });
    expect(page.rows.map((row) => row.value)).toEqual([3, 2, 1]);
  });
});
