// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { UseQueryResult } from '@tanstack/react-query';
import type { TaskSummary } from '@flowboard/shared';

import { makeTask } from '@/components/calendar/calendar-test-fixtures';
import { gridDays, rangeOf } from '@/components/calendar/calendar-dates';

/**
 * WHAT THE CALENDAR ASKS THE SERVER FOR.
 *
 * The interesting property is not the merge below it — `calendar-layout.test.ts`
 * covers the span arithmetic — it is the QUERY. Before WP3.8 this hook padded
 * the due-date bound by six weeks and re-filtered in the browser, and populated
 * the tray by fetching the project's first page unfiltered. Both were
 * workarounds for a contract that could only filter `due_date`, and both were
 * silently lossy. `taskFiltersSchema` now carries `startFrom`/`startTo` and
 * `undated`, so the two fetches are exact — and that is what is asserted here,
 * by recording the arguments `useTaskList` is called with.
 *
 * `useTaskList` is mocked rather than the transport: this hook's job IS the
 * argument construction, and going through a real query client would put the
 * assertion two layers away from the thing that can be wrong.
 */

const calls: { filters: unknown }[] = [];

vi.mock('@/hooks/useTasks', () => ({
  useTaskList: (_projectId: unknown, filters: unknown) => {
    calls.push({ filters });
    return {
      data: [] as TaskSummary[],
      isPending: false,
      error: null,
      refetch: () => undefined,
    } as unknown as UseQueryResult<TaskSummary[]>;
  },
}));

const { useCalendarTasks } = await import('@/components/calendar/useCalendarTasks');

const PROJECT_ID = 'p-1';
/** The six-week grid around April 2026 — the range the page would compute. */
const RANGE = rangeOf(gridDays('2026-04-15', 'month', 0));

beforeEach(() => {
  calls.length = 0;
});

describe('useCalendarTasks — the two queries', () => {
  it('fetches the grid EXACTLY: both date columns, both bounds, no padding', () => {
    renderHook(() => useCalendarTasks(PROJECT_ID, RANGE));

    expect(calls[0]?.filters).toEqual({
      dueFrom: RANGE.from,
      dueTo: RANGE.to,
      startFrom: RANGE.from,
      startTo: RANGE.to,
    });
  });

  it('asks for the tray by NAME rather than sieving an unfiltered page', () => {
    renderHook(() => useCalendarTasks(PROJECT_ID, RANGE));

    // The regression: an empty filter object here means "the project's first
    // 100 tasks", which over-fetches every project and UNDER-reports any
    // project with more than 100 tasks.
    expect(calls[1]?.filters).toEqual({ undated: true });
  });

  it('keys the tray independently of the cursor, so it is fetched once', () => {
    renderHook(() => useCalendarTasks(PROJECT_ID, RANGE));
    const trayFilters = calls[1]?.filters;

    calls.length = 0;
    renderHook(() => useCalendarTasks(PROJECT_ID, rangeOf(gridDays('2026-09-15', 'month', 0))));

    expect(calls[1]?.filters).toEqual(trayFilters);
    // …while the grid's query DID move.
    expect(calls[0]?.filters).not.toEqual({
      dueFrom: RANGE.from,
      dueTo: RANGE.to,
      startFrom: RANGE.from,
      startTo: RANGE.to,
    });
  });

  it('does not put tray rows on the grid', () => {
    const undated = makeTask({ id: 'u-1', startDate: null, dueDate: null });
    calls.length = 0;

    const { result } = renderHook(() => useCalendarTasks(PROJECT_ID, RANGE));

    // With `undated=true` the tray query returns ONLY dateless rows, and a
    // dateless row has no span — so merging the two lists into the grid, which
    // is how a start-only task used to reach it, is now dead weight.
    expect(result.current.tasks).not.toContainEqual(undated);
  });
});
