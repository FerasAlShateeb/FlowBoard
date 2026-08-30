// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

// Registers the English catalog on the default i18next instance.
import '@/i18n';
import RouteSkeleton, {
  isRouteViewChange,
  ROUTE_SKELETON_MS,
  routeViewKey,
} from '@/components/common/RouteSkeleton';

/**
 * The route-change placeholder.
 *
 * The interesting half of this feature is a COMPARISON, not a render — "is this
 * navigation a view change?" — which is why `routeViewKey` /
 * `isRouteViewChange` are pure exports rather than logic buried in an effect.
 * Testing them here means `AppShell` needs no router harness to prove the one
 * rule that actually bites: opening a task must not blank the board behind it.
 */

afterEach(() => {
  cleanup();
});

const BOARD = '/o/acme/p/FB/board';
const BACKLOG = '/o/acme/p/FB/backlog';

describe('routeViewKey', () => {
  it('leaves an ordinary view path alone', () => {
    expect(routeViewKey(BOARD)).toBe(BOARD);
    expect(routeViewKey('/')).toBe('/');
    expect(routeViewKey('/admin/analytics/traffic')).toBe('/admin/analytics/traffic');
  });

  it('strips a trailing task-sheet segment, with or without a slash', () => {
    expect(routeViewKey(`${BOARD}/t/FB-142`)).toBe(BOARD);
    expect(routeViewKey(`${BOARD}/t/FB-142/`)).toBe(BOARD);
    expect(routeViewKey(`${BACKLOG}/t/FB-7`)).toBe(BACKLOG);
  });

  it('matches `t` as a whole segment only', () => {
    // The regression this guards: a naive `/t` match would fold `/…/p/FB/table`
    // and `/admin/telemetry` into their parents and suppress every skeleton on
    // those routes.
    expect(routeViewKey('/o/acme/p/FB/table')).toBe('/o/acme/p/FB/table');
    expect(routeViewKey('/admin/telemetry/events')).toBe('/admin/telemetry/events');
    expect(routeViewKey('/o/acme/p/FB/board/tasks/1')).toBe('/o/acme/p/FB/board/tasks/1');
  });

  it('never returns an empty string', () => {
    // Defensive: a bare `/t/x` has no parent left after the strip, and an empty
    // key would compare equal to another empty key and silently disable the
    // placeholder for every such path.
    expect(routeViewKey('/t/FB-1')).toBe('/');
  });
});

describe('isRouteViewChange', () => {
  it('is false on the first render', () => {
    // The shell has only just mounted: there is no outgoing page to smooth
    // over, and the lazy chunk's own `PageSpinner` already owns that moment.
    expect(isRouteViewChange(null, BOARD)).toBe(false);
    expect(isRouteViewChange(null, '/')).toBe(false);
  });

  it('is true when one view replaces another', () => {
    expect(isRouteViewChange(BOARD, BACKLOG)).toBe(true);
    expect(isRouteViewChange('/', BOARD)).toBe(true);
    expect(isRouteViewChange('/me', '/notifications')).toBe(true);
  });

  it('is FALSE for the task sheet opening, closing, or switching tasks', () => {
    // The sheet is a child route over a parent that never unmounts — that is
    // what preserves the board's scroll position and its cache. A whole-page
    // skeleton would throw away exactly the thing the nested route buys.
    expect(isRouteViewChange(BOARD, `${BOARD}/t/FB-142`)).toBe(false);
    expect(isRouteViewChange(`${BOARD}/t/FB-142`, BOARD)).toBe(false);
    expect(isRouteViewChange(`${BOARD}/t/FB-142`, `${BOARD}/t/FB-9`)).toBe(false);
  });

  it('is false when the pathname has not moved at all', () => {
    // Re-running the effect (React `<StrictMode>` double-invokes it in dev)
    // must not flash a placeholder.
    expect(isRouteViewChange(BOARD, BOARD)).toBe(false);
  });

  it('is true when the same task key moves to another view', () => {
    // Board → backlog with the sheet still open is a real view change; the
    // sheet segment is stripped from both sides before they are compared.
    expect(isRouteViewChange(`${BOARD}/t/FB-1`, `${BACKLOG}/t/FB-1`)).toBe(true);
  });
});

describe('ROUTE_SKELETON_MS', () => {
  it('is long enough to read and short enough not to be a wait', () => {
    // A placeholder shown for less than ~200ms is itself a flash — worse than
    // the hard cut it replaces — and one held past ~500ms reads as latency the
    // app invented. The exact value is a judgement call; the range is not.
    expect(ROUTE_SKELETON_MS).toBeGreaterThanOrEqual(200);
    expect(ROUTE_SKELETON_MS).toBeLessThanOrEqual(500);
  });
});

describe('<RouteSkeleton/>', () => {
  it('announces itself as a loading status rather than going silent', () => {
    render(<RouteSkeleton />);

    const status = screen.getByRole('status');
    expect(status).toHaveAttribute('aria-label', 'Loading…');
    expect(status).toHaveAttribute('data-testid', 'route-skeleton');
  });

  it('renders pulsing placeholder bars — the surface the reduced gate freezes', () => {
    const { container } = render(<RouteSkeleton />);

    const bars = container.querySelectorAll('[data-slot="skeleton"]');
    // Header pair + a four-tile row + two content blocks.
    expect(bars).toHaveLength(8);
    // Every bar carries `animate-pulse`, which `index.css` §A2 neutralises to a
    // static opacity under `html[data-motion='reduced']` — the placeholder must
    // stay VISIBLE there, because "content is loading" is information, not
    // movement. Nothing in this component branches on the motion policy.
    for (const bar of bars) expect(bar).toHaveClass('animate-pulse');
    // …and each is hidden from assistive tech; the wrapper's status role is the
    // single announcement.
    for (const bar of bars) expect(bar).toHaveAttribute('aria-hidden');
  });
});
