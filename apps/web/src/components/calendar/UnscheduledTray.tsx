import { useTranslation } from 'react-i18next';
import { CalendarPlus, Inbox, X } from 'lucide-react';
import type { StatusCategory, TaskSummary } from '@flowboard/shared';

import EmptyState from '@/components/common/EmptyState';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Skeleton } from '@/components/ui/skeleton';
import TaskChip from '@/components/calendar/TaskChip';
import type { DayKey } from '@/components/calendar/calendar-dates';

/**
 * The side panel of tasks that have no dates at all — the calendar's inbox.
 *
 * ═══ WHY IT IS ON THE LOGICAL END SIDE ═════════════════════════════════════
 *
 * It is the LAST child of the page's flex row, with no `order` and no `right-`
 * anywhere: on an English page it lands on the right, on an Arabic one it lands
 * on the left, because that is where the end of a row is. The grid is the
 * subject of this page and keeps the reading-start position in both languages.
 *
 * ═══ WHY EVERY ROW HAS A BUTTON AS WELL AS A DRAG ══════════════════════════
 *
 * Dragging from the tray onto a day is the expressive gesture, and it is
 * pointer-only. "Schedule for today" is the same intent's one-click form: it is
 * reachable from the keyboard, it is the single commonest destination, and it
 * means the tray is not a dead end for anyone who cannot drag. (The other
 * keyboard route — pick an arbitrary date — is the reschedule menu on the chip
 * itself; see `TaskChip`.)
 *
 * The rows come from a client-side filter over an UNFILTERED task fetch: the
 * API has no "has no dates" filter, so `useCalendarTasks` keeps the rows where
 * both dates are null. That query's page cap is the tray's real limit — see the
 * note there.
 */

export interface UnscheduledTrayProps {
  tasks: readonly TaskSummary[];
  projectKey: string;
  categories: ReadonlyMap<string, StatusCategory>;
  today: DayKey;
  isPending: boolean;
  onOpen: (task: TaskSummary) => void;
  onScheduleToday: (task: TaskSummary) => void;
  onReschedule: (task: TaskSummary, dayKey: DayKey) => void;
  onClose: () => void;
}

export function UnscheduledTray({
  tasks,
  projectKey,
  categories,
  today,
  isPending,
  onOpen,
  onScheduleToday,
  onReschedule,
  onClose,
}: UnscheduledTrayProps) {
  const { t } = useTranslation(['calendar', 'common']);

  return (
    <aside
      aria-label={t('calendar:tray.title')}
      className="flex w-64 shrink-0 flex-col overflow-hidden rounded-[var(--card-radius)] border border-border bg-surface"
    >
      <header className="flex items-center gap-1.5 border-b border-border px-2 py-1.5">
        <Inbox aria-hidden className="size-3.5 text-muted-foreground" />
        <h2 className="min-w-0 flex-1 truncate text-xs font-medium text-foreground">
          {t('calendar:tray.title')}
        </h2>
        <span className="shrink-0 text-[0.6875rem] text-muted-foreground tabular-nums">
          {tasks.length}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={onClose}
          aria-label={t('calendar:tray.hide')}
        >
          <X aria-hidden />
        </Button>
      </header>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-1 p-2">
          {isPending ? (
            <>
              <Skeleton className="h-7 w-full" />
              <Skeleton className="h-7 w-full" />
              <Skeleton className="h-7 w-full" />
            </>
          ) : tasks.length === 0 ? (
            <EmptyState
              className="px-2 py-8"
              icon={<Inbox className="size-4" />}
              title={t('calendar:tray.empty')}
              message={t('calendar:tray.emptyBody')}
            />
          ) : (
            tasks.map((task) => (
              // `min-w-0` so the chip's own `flex-1 min-w-0` can actually
              // shrink: a flex item's default `min-width: auto` is its content,
              // and a long task title would otherwise push the row past the
              // tray's fixed 16rem.
              <div key={task.id} className="flex min-w-0 items-center gap-1">
                <TaskChip
                  task={task}
                  taskKey={`${projectKey}-${String(task.number)}`}
                  category={categories.get(task.statusId)}
                  overdue={false}
                  dayKey={today}
                  size="md"
                  detailed
                  dragKind="tray"
                  className="min-w-0 flex-1"
                  onOpen={onOpen}
                  onReschedule={onReschedule}
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={t('calendar:tray.scheduleToday')}
                  title={t('calendar:tray.scheduleToday')}
                  onClick={() => onScheduleToday(task)}
                >
                  <CalendarPlus aria-hidden />
                </Button>
              </div>
            ))
          )}
        </div>
      </ScrollArea>

      <p className="border-t border-border px-2 py-1.5 text-[0.6875rem] text-muted-foreground">
        {t('calendar:tray.hint')}
      </p>
    </aside>
  );
}

export default UnscheduledTray;
