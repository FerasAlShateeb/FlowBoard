import { Fragment, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

import { useRouteScope } from '@/hooks/useRouteScope';
import { useOrgBySlug } from '@/hooks/useOrgs';
import { buildCrumbs, type Crumb } from '@/components/navigation/breadcrumb-trail';
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';

/**
 * The topbar's "where am I" trail.
 *
 * All of the thinking is in `navigation/breadcrumb-trail.ts` (pure,
 * table-tested — and named for the trail rather than the component because
 * Windows and macOS filesystems are case-INSENSITIVE, so `breadcrumbs.ts` next
 * to `Breadcrumbs.tsx` is a module-resolution collision, not a naming choice);
 * this file is the two things that need React — resolving the org's display
 * name from the already-cached org list, and turning {@link Crumb}s into
 * elements.
 *
 * ── THE `ui/breadcrumb` SWAP (DONE — W3.1) ──────────────────────────────────
 * W1.3 wrote this trail by hand because W1.4's `components/ui/breadcrumb`
 * primitive was being hand-copied in PARALLEL, and left an element-for-element
 * mapping table for the integrator. That swap has now happened:
 *
 *   was here             →  now
 *   the topbar's `<nav>`    `<Breadcrumb>`      (owns `aria-label`)
 *   `<ol>`                  `<BreadcrumbList>`
 *   `<li>`                  `<BreadcrumbItem>`
 *   `<Link>`                `<BreadcrumbLink asChild>`
 *   the last `<span>`       `<BreadcrumbPage>`  (owns `aria-current="page"`)
 *   the `<ChevronRight>`    `<BreadcrumbSeparator>`
 *
 * TWO THINGS THE SWAP MOVED, both deliberate:
 *
 *  - **The separator is now a sibling `<li>`** rather than a child of the crumb
 *    that follows it. That is the better markup — a chevron is not part of the
 *    next item — and it is `role="presentation" aria-hidden`, so a screen reader
 *    walking the list hears "1 of 3" instead of a chevron between every pair.
 *    The list's own `gap` now does the spacing the item's gap used to.
 *  - **The `<nav>` moved INTO this component.** The topbar's wrapper is a plain
 *    `<div>` now (it also hosts the `zone="start"` slot registry, which is not
 *    part of the trail and must not be inside its `<nav>`); `<Breadcrumb>`
 *    carries the accessible name, from the same `common:nav.breadcrumb` key.
 *
 * `data-testid="breadcrumbs"` rides on the list, unchanged, so every trail test
 * and every e2e selector still resolves.
 */

/**
 * The namespaces a crumb key can come from.
 *
 * `common` for every nav destination, and `analytics` for the twenty metric
 * titles the drill-down trail reads (W3.2 — see `breadcrumb-trail`'s
 * `analyticsDrillDown`). Both are loaded here rather than at the two call sites
 * because `CrumbLabelKey` spans them and a `t` bound to only one of them would
 * render the OTHER's keys raw — which is precisely the "Dau" class of bug this
 * whole change removes.
 */
const CRUMB_NAMESPACES = ['common', 'analytics'] as const;

/** The trail for the current location, org name resolved where it is known. */
export function useBreadcrumbs(): Crumb[] {
  const { pathname } = useLocation();
  const { orgSlug } = useRouteScope();
  // Resolved from the list the switcher already holds — no request, and no
  // flicker while it loads (the builder falls back to the slug).
  const { org } = useOrgBySlug(orgSlug);

  return useMemo(
    () => buildCrumbs({ pathname, orgName: org?.name ?? null }),
    [pathname, org?.name],
  );
}

/**
 * The label of the deepest crumb — the mobile topbar's `<h1>`.
 *
 * A phone has no room for a trail, but it still owes the reader the name of the
 * page, and deriving it from the same source the desktop trail uses is what
 * keeps the two from disagreeing.
 */
export function useCurrentPageTitle(): string {
  const crumbs = useBreadcrumbs();
  const { t } = useTranslation(CRUMB_NAMESPACES);
  const last = crumbs.at(-1);
  if (last === undefined) return t('common:nav.home');
  return last.kind === 'key' ? t(last.labelKey) : last.label;
}

export default function Breadcrumbs() {
  const crumbs = useBreadcrumbs();
  const { t } = useTranslation(CRUMB_NAMESPACES);

  if (crumbs.length === 0) return null;

  return (
    <Breadcrumb className="min-w-0">
      {/* `flex-nowrap`: the primitive wraps by default, which is right for a
          page-body trail and wrong inside a 48px topbar — a second line would
          push the bar's own height around. Truncation is the answer here, which
          is what every `min-w-0` below is for. */}
      <BreadcrumbList data-testid="breadcrumbs" className="min-w-0 flex-nowrap gap-1">
        {crumbs.map((crumb, index) => {
          const label = crumb.kind === 'key' ? t(crumb.labelKey) : crumb.label;
          const isLast = index === crumbs.length - 1;

          return (
            // A fragment rather than a wrapper: the separator is a SIBLING
            // `<li>` of the crumb it precedes, so `<ol>` keeps only `<li>`
            // children and the list's own gap does the spacing.
            <Fragment key={`${label}-${String(index)}`}>
              {/* A chevron is a DIRECTION, and direction mirrors: under RTL the
                  trail reads right-to-left, so the arrow points the other way.
                  The primitive's own `rtl:rotate-180` is the whole fix, and it
                  is why this is not a `/` character. */}
              {index > 0 ? <BreadcrumbSeparator className="shrink-0" /> : null}

              <BreadcrumbItem className="min-w-0">
                {isLast ? (
                  /* The last crumb is the page you are on. The primitive's
                     `aria-current="page"` is what tells a screen reader the
                     trail has ended — without it the final item is announced as
                     one more link to somewhere. */
                  <BreadcrumbPage dir="auto" className="truncate">
                    {label}
                  </BreadcrumbPage>
                ) : crumb.path === null ? (
                  /* A section heading. Real ancestry, but not a place: the nav
                     model's headings ("Administration") have no route of their
                     own, and a link that goes nowhere is worse than plain
                     text — so it gets neither `BreadcrumbLink` nor `Page`. */
                  <span dir="auto" className="truncate">
                    {label}
                  </span>
                ) : (
                  /* `dir="auto"` because an org name is USER content — a Latin
                     name inside an Arabic session would otherwise truncate from
                     its reading start and cut off the half that identifies it. */
                  <BreadcrumbLink asChild className="truncate">
                    <Link to={crumb.path} dir="auto">
                      {label}
                    </Link>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
