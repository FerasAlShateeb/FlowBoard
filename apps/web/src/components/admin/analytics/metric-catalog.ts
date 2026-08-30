import type enAnalytics from '@/locales/en/analytics';
import enAnalyticsCatalog from '@/locales/en/analytics';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * The analytics KEY layer — the part of the metric registry that is pure data.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `metric-registry.ts` is the console's engine: it holds `load()` functions, so
 * it imports `lib/api`, `@/i18n` and the chart formatters, and importing it
 * drags the whole HTTP client and a live i18next instance along with it.
 *
 * That is fine for the console. It is NOT fine for
 * `components/navigation/breadcrumb-trail.ts`, whose entire value is that it is
 * a pure function of a URL — i18next-free, router-free, and therefore
 * table-testable in a node environment without booting anything. The trail
 * nevertheless needs one fact the registry owns: **what a metric is called**,
 * so that `/admin/analytics/engagement/dau` reads "… › Engagement › Daily
 * active users" instead of the prettified URL segment "Dau" — which is not
 * English, is certainly not Arabic, and was the defect W3.1 handed over.
 *
 * ═══ WHY THE CATALOG, NOT THE REGISTRY, IS THE RUNTIME SOURCE ═════════════
 *
 * The check below is `Object.hasOwn(enAnalytics.metrics[domain], metric)`, not
 * `lookupMetric(domain, metric)`. Those two answers are the SAME answer, and
 * that is enforced rather than hoped for: `metric-registry.test.ts` asserts
 * "has a `metrics.<domain>.<metric>` entry for every registry id and no
 * orphans" in both directions. So the catalog is a faithful, dependency-free
 * proxy for the registry's id set, and reading it costs a plain object import
 * where reading the registry would cost the API client.
 *
 * If that test ever goes, this module's premise goes with it — which is why the
 * test names this file in its own comment.
 *
 * ═══ WHY NO KEY IS BUILT WITHOUT A LOOKUP ════════════════════════════════
 *
 * `` `analytics:metrics.${domain}.${metric}.title` `` is derivable from two URL
 * segments, and a version of this function that just concatenated them would be
 * shorter. It would also render `analytics:metrics.traffic.nonsense.title` —
 * the raw key — in a topbar, for any path a reader hand-types. The `hasOwn`
 * pair (never a plain index: these strings come off a URL, and
 * `…/traffic/toString` would otherwise resolve `Object.prototype.toString`) is
 * what turns an unknown metric into `null`, which the trail then falls back to
 * prettifying.
 */

/**
 * Every dotted leaf path of a catalog namespace.
 *
 * The catalogs are `as const` objects, so every leaf is a string LITERAL type
 * and the recursion terminates on `T[K] extends string`.
 */
export type LeafPath<T> = {
  [K in keyof T & string]: T[K] extends string ? K : `${K}.${LeafPath<T[K]>}`;
}[keyof T & string];

/** Every key the `analytics` namespace can resolve, prefixed. */
export type AnalyticsKey = `analytics:${LeafPath<typeof enAnalytics>}`;

/** The subset of {@link AnalyticsKey} that names a metric — a drill-down title. */
export type MetricTitleKey = Extract<AnalyticsKey, `analytics:metrics.${string}.title`>;

/** The catalog's metric block, read as data rather than as a typed literal. */
const METRIC_TITLES: Record<string, Record<string, unknown>> = enAnalyticsCatalog.metrics;

/**
 * The catalog key for a `/admin/analytics/:domain/:metric` pair, or `null`.
 *
 * `null` is the honest answer for a domain nobody defined, a metric nobody
 * defined, and a URL segment that happens to name an `Object.prototype` member.
 * Every caller must have a fallback for it.
 */
export function metricTitleKey(
  domain: string | undefined,
  metric: string | undefined,
): MetricTitleKey | null {
  if (domain === undefined || metric === undefined) return null;
  if (!Object.hasOwn(METRIC_TITLES, domain)) return null;
  const entry = METRIC_TITLES[domain];
  if (entry === undefined || !Object.hasOwn(entry, metric)) return null;
  // The only cast in this module: `domain` and `metric` are runtime strings, so
  // the template literal cannot be a literal type. The two `hasOwn` guards above
  // are what make it true, and `metric-registry.test.ts` resolves the result of
  // this function against BOTH catalogs.
  return `analytics:metrics.${domain}.${metric}.title` as MetricTitleKey;
}
