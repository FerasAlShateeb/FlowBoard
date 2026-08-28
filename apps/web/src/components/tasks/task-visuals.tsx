import type { Status, StatusCategory } from '@flowboard/shared';

import { cn } from '@/lib/utils';

/**
 * The task sheet's STATUS vocabulary — a dot per status, and the lookup every
 * row in the sheet performs.
 *
 * THE TYPE AND PRIORITY GLYPHS MOVED (WP3.8). They lived here as one of six
 * copies across the five views, each with its own palette; they are now
 * `components/common/task-icons.tsx`. The re-exports below keep this module the
 * single import the sheet's components reach for — `TaskPriorityIcon` keeps its
 * old spelling here because five call sites use it and the shared module's
 * `PriorityIcon` is the name the other four views already used.
 *
 * NO HEX LITERALS (checklist §B) — with one documented exemption: a STATUS dot
 * uses `status.color`, which is per-project DATA a user picked and can only
 * arrive as an inline style, the same exemption `common/LabelDot` documents.
 */

export {
  PriorityIcon as TaskPriorityIcon,
  TASK_PRIORITIES,
  TASK_TYPES,
  TaskTypeIcon,
} from '@/components/common/task-icons';

// ───────────────────────────────────────────────────────────────────────────
// Status
// ───────────────────────────────────────────────────────────────────────────

/**
 * The fallback tint for a status whose row is not to hand — a subtask pointing
 * at a column that was deleted, say. Keyed by CATEGORY, which is the only part
 * of a status the product itself reasons about.
 */
const CATEGORY_COLORS: Record<StatusCategory, string> = {
  todo: 'bg-muted-foreground',
  in_progress: 'bg-info',
  done: 'bg-success',
};

/**
 * A status as a dot.
 *
 * The project's own `status.color` wins when the status row is available — that
 * is what the board draws, and the sheet must agree with the board. Only when
 * the status is unknown does it fall back to the category token, so a dangling
 * `statusId` still renders something meaningful instead of a hole.
 */
export function StatusDot({
  status,
  category = 'todo',
  className,
}: {
  status?: Status | null;
  /** Used only when `status` is absent. */
  category?: StatusCategory;
  className?: string;
}) {
  if (status) {
    return (
      <span
        aria-hidden
        data-slot="status-dot"
        className={cn('inline-block size-2 shrink-0 rounded-full', className)}
        style={{ backgroundColor: status.color }}
      />
    );
  }

  return (
    <span
      aria-hidden
      data-slot="status-dot"
      className={cn(
        'inline-block size-2 shrink-0 rounded-full',
        CATEGORY_COLORS[category],
        className,
      )}
    />
  );
}

/** Looks a status up by id — the lookup every row in the sheet performs. */
export function findStatus(
  statuses: readonly Status[],
  statusId: string | null | undefined,
): Status | null {
  if (statusId === null || statusId === undefined) return null;
  return statuses.find((status) => status.id === statusId) ?? null;
}
