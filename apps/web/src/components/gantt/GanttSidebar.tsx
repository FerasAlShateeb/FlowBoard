import type { VirtualItem } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';
import { CalendarPlus, ChevronDown, ChevronRight, Inbox } from 'lucide-react';

import { cn } from '@/lib/utils';
import UserAvatar from '@/components/common/UserAvatar';
import { TaskTypeIcon } from '@/components/common/task-icons';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ROW_HEIGHT, SIDEBAR_WIDTH } from '@/components/gantt/useGanttGeometry';
import { rowSpan, type GanttRow } from '@/components/gantt/gantt-rows';

/**
 * The row list beside the chart — the RTL half of the roadmap.
 *
 * ═══ IT IS *NOT* AN ISLAND ════════════════════════════════════════════════
 *
 * The canvas next door is forced to `dir="ltr"` because time only runs one way
 * (see `GanttTimeAxis`). This pane is the opposite: it is ordinary product
 * chrome — a tree of names — and it inherits the page direction, so on an
 * Arabic page it reads right-to-left, its disclosure arrows point the reading
 * way, and its indentation grows towards the reading start. Every offset here
 * is therefore a LOGICAL property (`ps-*`, `border-e`), never a physical one.
 * That is the whole of plan §Risks 5: the grid is an island, the labels are not.
 *
 * ═══ ONE VIRTUALIZER, TWO PANES ═══════════════════════════════════════════
 *
 * It renders the SAME `VirtualItem[]` the canvas does — not its own copy of the
 * row list, and not its own virtualizer. Two virtualizers over one list would
 * agree until the first fractional scroll offset and then shear apart by a
 * pixel per row. The only difference is the y origin: this pane's scroll box
 * starts BELOW its own header, so the canvas's `paddingStart` (the axis strip)
 * is subtracted here.
 */

export interface GanttSidebarProps {
  rows: readonly GanttRow[];
  items: readonly VirtualItem[];
  /** The canvas virtualizer's `paddingStart`; subtracted from every `start`. */
  paddingStart: number;
  projectKey: string;
  canWrite: boolean;
  /** Which task the pointer is over, so a row and its bar light up together. */
  hoveredTaskIds: ReadonlySet<string>;
  onToggle: (rowId: string) => void;
  onOpen: (taskId: string) => void;
  onSchedule: (taskId: string) => void;
  onHover: (taskId: string | null) => void;
}

export function GanttSidebar({
  rows,
  items,
  paddingStart,
  projectKey,
  canWrite,
  hoveredTaskIds,
  onToggle,
  onOpen,
  onSchedule,
  onHover,
}: GanttSidebarProps) {
  const { t } = useTranslation(['roadmap']);

  return (
    <div className="relative" style={{ width: SIDEBAR_WIDTH }} data-testid="gantt-sidebar">
      {items.map((item) => {
        const row = rows[item.index];
        if (!row) return null;

        const top = item.start - paddingStart;

        // ── The "No epic" group header ────────────────────────────────────
        if (row.kind === 'group') {
          return (
            <div
              key={row.id}
              className="absolute flex items-center gap-1.5 border-b border-border/40 bg-surface-raised/60 px-2 text-xs font-medium text-muted-foreground"
              style={{ top, height: ROW_HEIGHT, insetInlineStart: 0, insetInlineEnd: 0 }}
            >
              <Disclosure
                collapsed={row.collapsed}
                label={t(row.collapsed ? 'roadmap:actions.expand' : 'roadmap:actions.collapse')}
                onToggle={() => {
                  onToggle(row.id);
                }}
              />
              <Inbox className="size-3.5 shrink-0" aria-hidden />
              <span className="truncate">{t('roadmap:sidebar.noEpic')}</span>
              <span className="ms-auto shrink-0 tabular-nums">{row.childCount}</span>
            </div>
          );
        }

        const task = row.task;
        const taskKey = `${projectKey}-${task.number}`;
        const undated = rowSpan(row) === null;

        return (
          <div
            key={row.id}
            data-testid="gantt-sidebar-row"
            className={cn(
              'group absolute flex items-center gap-1.5 border-b border-border/40 pe-1.5 text-xs',
              hoveredTaskIds.has(task.id) && 'bg-sidebar-accent',
            )}
            style={{
              top,
              height: ROW_HEIGHT,
              insetInlineStart: 0,
              insetInlineEnd: 0,
              // Indentation is a LOGICAL inset, so a child sits inside its epic
              // on an Arabic page exactly as it does on an English one.
              paddingInlineStart: row.kind === 'epic' ? 6 : row.depth === 1 ? 26 : 12,
            }}
            onMouseEnter={() => {
              onHover(task.id);
            }}
            onMouseLeave={() => {
              onHover(null);
            }}
          >
            {row.kind === 'epic' ? (
              <Disclosure
                collapsed={row.collapsed}
                label={t(row.collapsed ? 'roadmap:actions.expand' : 'roadmap:actions.collapse')}
                onToggle={() => {
                  onToggle(row.id);
                }}
              />
            ) : null}

            <TaskTypeIcon type={task.type} />

            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-1.5 text-start hover:underline"
              onClick={() => {
                onOpen(task.id);
              }}
            >
              {/* A task key is a Latin identifier in every locale — mono, LTR,
                  never translated. */}
              <span className="shrink-0 font-mono text-[10px] text-muted-foreground" dir="ltr">
                {taskKey}
              </span>
              {/* User content — see `UserChip` in `components/common/UserAvatar.tsx`. */}
              <span
                dir="auto"
                className={cn(
                  'truncate',
                  row.kind === 'epic' ? 'font-medium text-foreground' : 'text-foreground/90',
                )}
              >
                {task.title}
              </span>
            </button>

            {/* The undated affordance. Only on rows that HAVE no bar, so it
                reads as "this is missing something" rather than as an action
                every row carries. */}
            {undated && canWrite && row.kind !== 'epic' ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    data-testid="gantt-schedule"
                    aria-label={t('roadmap:actions.schedule')}
                    className="shrink-0 rounded-[var(--radius)] p-1 text-muted-foreground opacity-0 transition-opacity duration-[var(--speed)] group-hover:opacity-100 hover:bg-sidebar-accent hover:text-foreground focus-visible:opacity-100"
                    onClick={() => {
                      onSchedule(task.id);
                    }}
                  >
                    <CalendarPlus className="size-3.5" aria-hidden />
                  </button>
                </TooltipTrigger>
                <TooltipContent>{t('roadmap:actions.scheduleHint')}</TooltipContent>
              </Tooltip>
            ) : null}

            {row.subtaskCount > 0 ? (
              <span
                className="shrink-0 rounded-[var(--radius)] bg-secondary px-1 text-[10px] text-muted-foreground tabular-nums"
                title={t('roadmap:sidebar.subtasks', { count: row.subtaskCount })}
              >
                {row.subtaskCount}
              </span>
            ) : null}

            <UserAvatar user={task.assignee} size="xs" className="shrink-0" />
          </div>
        );
      })}
    </div>
  );
}

/**
 * The disclosure triangle.
 *
 * `ChevronRight` is NOT mirrored by `dir` — an icon is a glyph, not text — so
 * the collapsed state uses a logical `rtl:-scale-x-100` to point it towards the
 * reading end on an Arabic page. The expanded state points down and needs none.
 */
function Disclosure({
  collapsed,
  label,
  onToggle,
}: {
  collapsed: boolean;
  label: string;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-expanded={!collapsed}
      className="shrink-0 rounded-[var(--radius)] p-0.5 text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
      onClick={onToggle}
    >
      {collapsed ? (
        <ChevronRight className="size-3.5 rtl:-scale-x-100" aria-hidden />
      ) : (
        <ChevronDown className="size-3.5" aria-hidden />
      )}
    </button>
  );
}

export default GanttSidebar;
