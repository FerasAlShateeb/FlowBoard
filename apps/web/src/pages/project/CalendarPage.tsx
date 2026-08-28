import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import { Outlet, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  DndContext,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from '@dnd-kit/core';
import { CalendarDays } from 'lucide-react';
import type { PatchTaskInput, TaskSummary } from '@flowboard/shared';

import { getIntlLocale, useLang } from '@/lib/lang-policy';
import { useProjectScope } from '@/hooks/useProjects';
import { usePatchTask } from '@/hooks/useTaskMutations';
import PageHeader from '@/components/common/PageHeader';
import PageSpinner from '@/components/common/PageSpinner';
import ErrorState from '@/components/common/ErrorState';
import EmptyState from '@/components/common/EmptyState';
import { Skeleton } from '@/components/ui/skeleton';
import CalendarToolbar from '@/components/calendar/CalendarToolbar';
import CalendarMonthView from '@/components/calendar/CalendarMonthView';
import CalendarWeekView from '@/components/calendar/CalendarWeekView';
import UnscheduledTray from '@/components/calendar/UnscheduledTray';
import {
  formatDayRange,
  formatFullDate,
  formatMonthYear,
  gridDays,
  monthGridWeeks,
  rangeOf,
  shiftCursor,
  todayKey,
  weekStartFor,
  weekdayNames,
  type CalendarView,
  type DayKey,
} from '@/components/calendar/calendar-dates';
import {
  isArrowKey,
  nextChipIndex,
  readDragData,
  readDropData,
  reschedulePatch,
  resizePatch,
  scheduleTodayPatch,
} from '@/components/calendar/calendar-dnd';
import { statusCategories, useCalendarTasks } from '@/components/calendar/useCalendarTasks';

/**
 * The Calendar view — month and week grids over a project's dated work, with
 * drag-to-reschedule and a tray of everything still unscheduled.
 *
 * ═══ WHAT THIS FILE OWNS ═══════════════════════════════════════════════════
 *
 * Only the wiring. The date arithmetic is `calendar-dates`, the bar layout is
 * `calendar-layout`, the meaning of a drop is `calendar-dnd`, and the two grids
 * render what those hand them. Everything here is state (which day, which view,
 * is the tray open) and the four callbacks the grids need.
 *
 * ═══ ONE FETCH PER VISIBLE RANGE ═══════════════════════════════════════════
 *
 * `useCalendarTasks` takes the range the GRID covers — six weeks for a month,
 * seven days for a week — and issues one due-date-filtered query for it, plus
 * one unfiltered query behind the tray. Paging the cursor changes the range,
 * which changes the query key, which is the whole of the "refetch on
 * navigation" logic. See that module for why the upper bound is padded.
 *
 * ═══ RESCHEDULING, THREE WAYS ══════════════════════════════════════════════
 *
 * 1. **Drag a chip onto a day** — pointer. `reschedulePatch` decides whether
 *    that means moving a due date or shifting a whole span.
 * 2. **Drag a bar's edge** (week view) — pointer. `resizePatch`, minimum one
 *    day.
 * 3. **The reschedule menu on a focused chip** — KEYBOARD. The context-menu key
 *    (or `M`, or a right-click) opens a date picker anchored to the chip. This
 *    is the documented keyboard equivalent of the drag: a dnd-kit
 *    `KeyboardSensor` can move a card between two lists, but "which of 42 cells
 *    am I over" has no good non-visual reading, whereas "type a date" does.
 *    Arrow keys move the focus ring between chips; Enter opens the task.
 *
 * All three end in the same optimistic `usePatchTask`, so a failure rolls back
 * and toasts once, in one place.
 */
export default function CalendarPage() {
  const { t } = useTranslation(['calendar', 'common']);
  const navigate = useNavigate();
  const lang = useLang();
  const locale = getIntlLocale();
  const rtl = lang === 'ar';

  const { projectId, projectKey, project, isPending, error } = useProjectScope();

  const [view, setView] = useState<CalendarView>('month');
  const [cursor, setCursor] = useState<DayKey>(() => todayKey());
  const [trayOpen, setTrayOpen] = useState(false);

  const today = todayKey();
  const weekStart = weekStartFor(lang);

  const days = useMemo(() => gridDays(cursor, view, weekStart), [cursor, view, weekStart]);
  const weeks = useMemo(
    () => (view === 'month' ? monthGridWeeks(cursor, weekStart) : []),
    [cursor, view, weekStart],
  );
  const range = useMemo(() => rangeOf(days), [days]);
  const weekdayLabels = useMemo(() => weekdayNames(weekStart, locale), [weekStart, locale]);

  const {
    tasks,
    spans,
    unscheduled,
    byId,
    isPending: tasksPending,
    error: tasksError,
    refetch,
  } = useCalendarTasks(projectId, range);
  const categories = useMemo(() => statusCategories(project?.statuses), [project?.statuses]);

  const patchTask = usePatchTask(projectId ?? '');
  const { mutate: patch } = patchTask;

  const gridRef = useRef<HTMLDivElement>(null);

  /** The one place a calendar gesture becomes a request. */
  const applyPatch = useCallback(
    (task: TaskSummary, body: PatchTaskInput | null) => {
      if (!body) return;
      patch(
        { taskId: task.id, ...body },
        {
          onSuccess: () => {
            toast.success(
              t('calendar:toast.rescheduled', {
                key: `${project?.key ?? projectKey}-${String(task.number)}`,
              }),
            );
          },
        },
      );
    },
    [patch, t, project?.key, projectKey],
  );

  const handleOpen = useCallback(
    (task: TaskSummary) => {
      // Relative navigation: `t/:taskKey` is a CHILD of this route, so the task
      // sheet opens OVER the calendar and closing it is a history back().
      void navigate(`t/${project?.key ?? projectKey}-${String(task.number)}`);
    },
    [navigate, project?.key, projectKey],
  );

  const handleReschedule = useCallback(
    (task: TaskSummary, dayKey: DayKey) => {
      applyPatch(task, reschedulePatch(task, dayKey));
    },
    [applyPatch],
  );

  const handleScheduleToday = useCallback(
    (task: TaskSummary) => {
      applyPatch(task, scheduleTodayPatch(task, today));
    },
    [applyPatch, today],
  );

  const sensors = useSensors(
    // A small activation distance is what keeps a chip CLICKABLE: without it
    // every press starts a drag and the task sheet becomes unreachable by
    // pointer. `TaskChip` re-checks the same distance before it opens anything.
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const drag = readDragData(event.active.data.current);
      const drop = readDropData(event.over?.data.current);
      if (!drag || !drop) return;

      const task = byId.get(drag.taskId);
      if (!task) return;

      const body =
        drag.kind === 'resize' && drag.edge
          ? resizePatch(task, drag.edge, drop.dayKey)
          : reschedulePatch(task, drop.dayKey);

      applyPatch(task, body);
    },
    [applyPatch, byId],
  );

  /**
   * Screen-reader narration for the reschedule drag (WP5.1).
   *
   * A calendar drop CHANGES A DATE, so every sentence names the task key and
   * the DAY — dnd-kit's own English default ("was dropped over droppable area
   * 17") names neither, and leaks English into an Arabic page besides. The day
   * comes from the same `formatFullDate`/`getIntlLocale()` pair the grid's own
   * labels use, so the announcement and the cell agree, digits included.
   */
  const announcements = useMemo<Announcements>(() => {
    const keyOf = (data: unknown): string => {
      const drag = readDragData(data);
      const task = drag ? byId.get(drag.taskId) : undefined;
      return task ? `${project?.key ?? projectKey}-${String(task.number)}` : '';
    };
    const dayOf = (data: unknown): string => {
      const drop = readDropData(data);
      return drop ? formatFullDate(drop.dayKey, locale) : '';
    };

    return {
      onDragStart: ({ active }) => t('calendar:dnd.picked', { key: keyOf(active.data.current) }),
      onDragOver: ({ active, over }) =>
        over
          ? t('calendar:dnd.over', {
              key: keyOf(active.data.current),
              day: dayOf(over.data.current),
            })
          : undefined,
      onDragEnd: ({ active, over }) =>
        over
          ? t('calendar:dnd.dropped', {
              key: keyOf(active.data.current),
              day: dayOf(over.data.current),
            })
          : undefined,
      onDragCancel: ({ active }) =>
        t('calendar:dnd.cancelled', { key: keyOf(active.data.current) }),
    };
  }, [byId, locale, project?.key, projectKey, t]);

  const screenReaderInstructions = useMemo(
    () => ({ draggable: t('calendar:dnd.instructions') }),
    [t],
  );

  /**
   * Arrow-key focus movement between chips.
   *
   * Handled on the CONTAINER rather than on every chip: the answer depends on
   * the chips' relative positions, which only the container can see, and a
   * per-chip handler would need every chip to know its neighbours. The DOM
   * order of `[data-calendar-chip]` is reading order, and each carries its own
   * `data-day` — which is all `nextChipIndex` needs.
   */
  const handleGridKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (!isArrowKey(event.key)) return;
      const root = gridRef.current;
      if (!root) return;

      const focused =
        event.target instanceof Element ? event.target.closest('[data-calendar-chip]') : null;
      if (!focused) return;

      const chips = Array.from(root.querySelectorAll<HTMLElement>('[data-calendar-chip]'));
      const current = chips.indexOf(focused as HTMLElement);
      if (current === -1) return;

      const next = nextChipIndex(
        chips.map((chip) => ({ dayKey: chip.dataset.day ?? '' })),
        current,
        event.key,
        rtl,
      );
      if (next === null) return;

      event.preventDefault();
      chips[next]?.focus();
    },
    [rtl],
  );

  if (isPending) return <PageSpinner />;
  if (error) return <ErrorState error={error} />;

  const label = view === 'month' ? formatMonthYear(cursor, locale) : formatDayRange(range, locale);

  return (
    <>
      <div className="flex min-h-[560px] flex-col">
        <PageHeader
          title={t('calendar:title')}
          description={project?.name ?? undefined}
          className="mb-2"
        >
          <CalendarToolbar
            view={view}
            onViewChange={setView}
            label={label}
            onPrevious={() => setCursor((current) => shiftCursor(current, view, -1))}
            onNext={() => setCursor((current) => shiftCursor(current, view, 1))}
            onToday={() => setCursor(todayKey())}
            trayOpen={trayOpen}
            onToggleTray={() => setTrayOpen((open) => !open)}
            unscheduledCount={unscheduled.length}
          />
        </PageHeader>

        {tasksError ? (
          <ErrorState error={tasksError} onRetry={refetch} />
        ) : (
          <DndContext
            sensors={sensors}
            accessibility={{ announcements, screenReaderInstructions }}
            onDragEnd={handleDragEnd}
          >
            <div className="flex min-h-0 flex-1 items-stretch gap-[var(--gap)]">
              <div
                ref={gridRef}
                onKeyDown={handleGridKeyDown}
                className="flex min-h-0 min-w-0 flex-1 flex-col gap-2"
              >
                {tasksPending ? (
                  <CalendarSkeleton />
                ) : view === 'month' ? (
                  <CalendarMonthView
                    cursor={cursor}
                    today={today}
                    weeks={weeks}
                    weekdayLabels={weekdayLabels}
                    tasks={tasks}
                    spans={spans}
                    byId={byId}
                    categories={categories}
                    projectKey={project?.key ?? projectKey}
                    onOpen={handleOpen}
                    onReschedule={handleReschedule}
                    onSelectDay={(dayKey) => {
                      setCursor(dayKey);
                      setView('week');
                    }}
                  />
                ) : (
                  <CalendarWeekView
                    today={today}
                    days={days}
                    weekdayLabels={weekdayLabels}
                    tasks={tasks}
                    spans={spans}
                    byId={byId}
                    categories={categories}
                    projectKey={project?.key ?? projectKey}
                    onOpen={handleOpen}
                    onReschedule={handleReschedule}
                  />
                )}

                {!tasksPending && tasks.length === 0 ? (
                  <EmptyState
                    className="py-6"
                    icon={<CalendarDays className="size-4" />}
                    title={t('calendar:states.empty')}
                    message={t('calendar:states.emptyBody')}
                  />
                ) : null}
              </div>

              {trayOpen ? (
                <UnscheduledTray
                  tasks={unscheduled}
                  projectKey={project?.key ?? projectKey}
                  categories={categories}
                  today={today}
                  isPending={tasksPending}
                  onOpen={handleOpen}
                  onScheduleToday={handleScheduleToday}
                  onReschedule={handleReschedule}
                  onClose={() => setTrayOpen(false)}
                />
              ) : null}
            </div>
          </DndContext>
        )}
      </div>

      {/* The route-layered task sheet (`t/:taskKey`). Removing this silently
          breaks every deep link into a task from this view. */}
      <Outlet />
    </>
  );
}

/** The grid's loading state: the same shape, without the content. */
function CalendarSkeleton() {
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2 rounded-[var(--card-radius)] border border-border p-2">
      <Skeleton className="h-5 w-full" />
      {Array.from({ length: 5 }, (_, row) => (
        <Skeleton key={row} className="h-[88px] w-full" />
      ))}
    </div>
  );
}
