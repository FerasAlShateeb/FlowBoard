import { useTranslation } from 'react-i18next';

import { Skeleton } from '@/components/ui/skeleton';

/**
 * The route-change placeholder — a page-shaped grey frame held for a beat while
 * one view is swapped for another.
 *
 * WHY A SKELETON AND NOT JUST THE SPINNER. `PageSpinner` answers "the code for
 * this page is still downloading"; this answers "you are now somewhere else".
 * They are different messages and they happen at different times: the spinner
 * only appears on a COLD chunk, while every navigation crosses this one. A hard
 * cut from a full board to a full backlog with nothing in between reads as a
 * flicker — the eye has no anchor for where the new content came from — and the
 * fix is a short, deliberate, low-contrast intermediate state.
 *
 * `ROUTE_SKELETON_MS` is a MINIMUM, not a delay for its own sake: below roughly
 * a fifth of a second a placeholder is itself a flash, which is worse than the
 * cut it was meant to smooth.
 *
 * UNDER REDUCED MOTION IT STAYS, AND STAYS VISIBLE. `index.css` §A2 freezes the
 * `animate-pulse` breath every `Skeleton` carries and pins it at a static
 * opacity — reduced motion removes movement, never information, and "content is
 * loading" is information. Nothing here is conditional on the policy.
 */

/**
 * How long the placeholder is held on a view change.
 *
 * Exported so `AppShell` and this component's tests share one number, and so
 * an e2e run can reason about the window instead of guessing at it.
 */
export const ROUTE_SKELETON_MS = 350;

/**
 * A trailing task-sheet segment: `/…/board/t/FB-142`, with or without a slash.
 *
 * `t` is matched as a WHOLE segment, so `/admin/telemetry` and `/…/p/FB/table`
 * are untouched — only the literal `/t/<key>` the router mounts as a child of
 * each project view (see `routes/index.tsx` → `taskSheetRoute`).
 */
const TASK_SHEET_SEGMENT = /\/t\/[^/]+\/?$/;

/**
 * The VIEW a pathname belongs to: the path with any task-sheet segment removed.
 *
 * `/o/acme/p/FB/board` and `/o/acme/p/FB/board/t/FB-142` are the SAME view —
 * the sheet is a child route rendered over a parent that never unmounts, which
 * is exactly why opening a task keeps the board's scroll position and its
 * cache. Flashing a whole-page skeleton for it would throw away the thing the
 * nested route was built to preserve.
 */
export function routeViewKey(pathname: string): string {
  return pathname.replace(TASK_SHEET_SEGMENT, '') || '/';
}

/**
 * Should a navigation from `previous` to `next` show the placeholder?
 *
 * A pure function, and separate from the component, because every interesting
 * case here is a comparison rather than a render: the FIRST render (`previous`
 * is `null`) must not flash — the shell has only just mounted and there is no
 * outgoing page to smooth over — and a board → task-sheet move must not either.
 */
export function isRouteViewChange(previous: string | null, next: string): boolean {
  if (previous === null) return false;
  return routeViewKey(previous) !== routeViewKey(next);
}

/**
 * The placeholder itself: a header pair, a KPI row, and two content blocks.
 *
 * Deliberately GENERIC. It stands in for a board, a backlog, a report and an
 * admin table alike, so it is shaped like "a page" rather than like any one of
 * them — a placeholder that promises a layout the incoming view does not have
 * is a worse lie than a neutral one.
 *
 * `role="status"` with the shared loading label, matching `PageSpinner`: the
 * individual bars are `aria-hidden` (every `Skeleton` is), so without this the
 * whole navigation would be silent to a screen reader.
 */
export default function RouteSkeleton() {
  const { t } = useTranslation(['common']);

  return (
    <div
      role="status"
      aria-label={t('common:states.loading')}
      data-testid="route-skeleton"
      className="flex w-full flex-col gap-[var(--gap)]"
    >
      {/* Page header: title + description. */}
      <div className="flex flex-col gap-2">
        <Skeleton className="h-6 w-48 max-w-full" />
        <Skeleton className="h-3.5 w-72 max-w-full" />
      </div>

      {/* A KPI/toolbar row. `sm:`/`lg:` only — no physical properties, so it
          mirrors under RTL without a variant. */}
      <div className="grid grid-cols-2 gap-[var(--gap)] lg:grid-cols-4">
        {[0, 1, 2, 3].map((index) => (
          <Skeleton key={index} className="h-20 rounded-[var(--card-radius)]" />
        ))}
      </div>

      {/* The main content block, then a shorter secondary one. */}
      <Skeleton className="h-64 rounded-[var(--card-radius)]" />
      <Skeleton className="h-40 rounded-[var(--card-radius)]" />
    </div>
  );
}
