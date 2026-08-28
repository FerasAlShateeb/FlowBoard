// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
// DOM matchers, imported HERE rather than in the shared setup file: the rest of
// this package's suites run in the `node` environment and must not pay for them.
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';
import type { StatusCategory, TaskSummary } from '@flowboard/shared';

// Boots the English i18next instance the components' `useTranslation` reads.
import '@/i18n';
import CalendarMonthView from '@/components/calendar/CalendarMonthView';
import { makeTask } from '@/components/calendar/calendar-test-fixtures';
import {
  monthGridWeeks,
  rangeOf,
  monthGridDays,
  weekdayNames,
} from '@/components/calendar/calendar-dates';
import { selectRangeTasks } from '@/components/calendar/calendar-layout';

/**
 * A rendering smoke test for the month grid — the one calendar suite that needs
 * a DOM (hence the `@vitest-environment jsdom` pragma; the default here is
 * `node`, see `vitest.config.ts`).
 *
 * It asserts the things the pure layout tests CANNOT: that the grid actually
 * emits 42 day cells, that a span becomes one grid item per week row with the
 * right `grid-column`, that the overdue tint reaches the DOM, and that the lane
 * cap surfaces as a "+n more" control. The data hooks are not mocked because
 * this component takes its data as PROPS — which is most of why it is shaped
 * that way.
 */

/**
 * Radix primitives (the `+n more` popover here) observe their trigger's box,
 * and jsdom ships no `ResizeObserver`. A no-op constructor is enough: nothing
 * in these assertions depends on a measured size, and the alternative — a real
 * polyfill — would add a dependency for one stub.
 */
beforeAll(() => {
  const globals = globalThis as typeof globalThis & { ResizeObserver?: unknown };
  globals.ResizeObserver ??= class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
});

// Testing Library only auto-cleans when its global `afterEach` is installed by a
// setup file; this package's setup is DOM-free by design, so the unmount is
// explicit. Without it, the second test would query a document still holding
// the first one's grid and `getByText` would find two of everything.
afterEach(cleanup);

const CURSOR = '2026-03-15';
const TODAY = '2026-03-10';
const PROJECT_KEY = 'FLOW';

const TASKS: TaskSummary[] = [
  makeTask({ id: 't1', number: 1, title: 'Write the spec', dueDate: '2026-03-10' }),
  makeTask({
    id: 't2',
    number: 2,
    title: 'Fix the leak',
    dueDate: '2026-03-05',
    statusId: 'status-doing',
  }),
  makeTask({
    id: 't3',
    number: 3,
    title: 'Migration window',
    startDate: '2026-03-11',
    dueDate: '2026-03-17',
  }),
  makeTask({ id: 't4', number: 4, title: 'Review A', dueDate: '2026-03-12' }),
  makeTask({ id: 't5', number: 5, title: 'Review B', dueDate: '2026-03-12' }),
  makeTask({ id: 't6', number: 6, title: 'Review C', dueDate: '2026-03-12' }),
];

const CATEGORIES = new Map<string, StatusCategory>([
  ['status-todo', 'todo'],
  ['status-doing', 'in_progress'],
]);

function renderMonth(onOpen = vi.fn()) {
  const { tasks, spans } = selectRangeTasks(TASKS, rangeOf(monthGridDays(CURSOR, 0)));
  const byId = new Map(tasks.map((task) => [task.id, task]));

  const utils = render(
    <DndContext>
      <CalendarMonthView
        cursor={CURSOR}
        today={TODAY}
        weeks={monthGridWeeks(CURSOR, 0)}
        weekdayLabels={weekdayNames(0, 'en-US')}
        tasks={tasks}
        spans={spans}
        byId={byId}
        categories={CATEGORIES}
        projectKey={PROJECT_KEY}
        onOpen={onOpen}
        onReschedule={vi.fn()}
      />
    </DndContext>,
  );

  return { ...utils, onOpen };
}

/** The chip's outer box — the element that carries the tint and the placement. */
function chipRoot(container: HTMLElement, taskId: string): HTMLElement {
  const button = container.querySelector(`[data-task-id="${taskId}"]`);
  const root = button?.closest('[data-calendar-chip-root]');
  if (!(root instanceof HTMLElement)) throw new Error(`no chip rendered for ${taskId}`);
  return root;
}

describe('CalendarMonthView', () => {
  it('renders six weeks of day cells under localized weekday headers', () => {
    const { container } = renderMonth();
    expect(container.querySelectorAll('[data-calendar-day]')).toHaveLength(42);
    expect(screen.getByText('Sun')).toBeDefined();
    expect(screen.getByText('Sat')).toBeDefined();
  });

  it('dims the days that belong to a neighbouring month', () => {
    const { container } = renderMonth();
    // March 2026 opens on a Sunday, so the grid's outside days are all in April.
    expect(container.querySelectorAll('[data-outside]').length).toBe(11);
    expect(container.querySelector('[data-calendar-day="2026-04-01"]')).toHaveAttribute(
      'data-outside',
    );
  });

  it('draws a chip for each task, with its key and title', () => {
    const { container } = renderMonth();
    expect(screen.getByText('Write the spec')).toBeDefined();
    expect(screen.getAllByText('FLOW-1')).toHaveLength(1);
    expect(chipRoot(container, 't1')).toBeDefined();
  });

  it('tints an overdue chip with the danger token and leaves others alone', () => {
    const { container } = renderMonth();
    expect(chipRoot(container, 't2').className).toContain('bg-danger/12');
    expect(chipRoot(container, 't1').className).not.toContain('bg-danger/12');
  });

  it('splits a span across the week break, rounding only its real ends', () => {
    const { container } = renderMonth();
    const segments = container.querySelectorAll('[data-task-id="t3"]');
    expect(segments).toHaveLength(2);

    const first = chipRoot(container, 't3');
    // Wed 11th is column 4 of a Sunday-start week; it runs to the Saturday.
    expect(first.style.gridColumn).toBe('4 / span 4');
    expect(first.className).toContain('rounded-s-[var(--radius)]');
    expect(first.className).toContain('rounded-e-none');
  });

  it('caps the lanes and offers the rest behind "+n more"', () => {
    renderMonth();
    // Thu 12th carries four overlapping bars; three lanes are shown.
    expect(screen.getByText('+1 more')).toBeDefined();
    expect(screen.queryByText('Review C')).toBeNull();
  });

  it('opens the task when a chip is clicked', () => {
    const onOpen = vi.fn();
    const { container } = renderMonth(onOpen);
    fireEvent.click(container.querySelector('[data-task-id="t1"]') as HTMLElement);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen.mock.calls[0]?.[0]).toMatchObject({ id: 't1' });
  });
});
