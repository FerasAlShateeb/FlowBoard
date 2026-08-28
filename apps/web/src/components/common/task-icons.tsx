import {
  Bookmark,
  Bug,
  ChevronDown,
  ChevronUp,
  ChevronsDown,
  ChevronsUp,
  GitBranch,
  Minus,
  SquareCheck,
  Zap,
  type LucideIcon,
} from 'lucide-react';
import type { TaskPriority, TaskType } from '@flowboard/shared';

import { cn } from '@/lib/utils';

/**
 * THE task-type and priority glyphs — one definition, every view.
 *
 * ═══ WHAT THIS REPLACED ════════════════════════════════════════════════════
 *
 * Six. There were six independent definitions of this pair when WP3.8 started
 * (`backlog/TaskTypeIcon.tsx`, `backlog/PriorityIcon.tsx`,
 * `datatable/task-fields.tsx`, `tasks/task-visuals.tsx`, `board/board-meta.ts`,
 * plus private maps in `calendar/TaskChip.tsx` and `gantt/GanttSidebar.tsx`),
 * and they had genuinely DIVERGED: a story was a `Bookmark` on three surfaces,
 * a `BookMarked` on one and a `BookOpen` on another; a subtask was a
 * `GitBranch` on four, a `SquareCheck` on the roadmap and a `CornerDownRight`
 * on the calendar; and no two files agreed on the type colours at all. Nobody
 * chose that — it is what five agents building five views in parallel produces,
 * and it reads to a user as five different products.
 *
 * ═══ WHICH PALETTE WON ═════════════════════════════════════════════════════
 *
 * The board's, expressed as Tailwind tone classes rather than inline
 * `var(--chart-n)` strings. It is the densest and most-looked-at surface, its
 * ramp is the only one that gives all five types a distinct hue, and it was
 * already the one `board-meta.test.ts` asserted totality over. Priorities take
 * the reading `tasks/task-visuals.tsx` and `datatable/task-fields.tsx` already
 * agreed on byte-for-byte.
 *
 * ═══ LABELLED OR DECORATIVE ════════════════════════════════════════════════
 *
 * `label` decides, and the default is DECORATIVE (`aria-hidden`). That is
 * right far more often than not: in a menu row, a filter chip or a select
 * option the glyph sits next to text that already says the word, and a screen
 * reader announcing it twice is noise. Pass `label` — from
 * `useTaskVocabulary().typeAria(...)` — only where the glyph stands ALONE, as
 * it does on a board card and a backlog row.
 */

// ───────────────────────────────────────────────────────────────────────────
// The vocabularies, in canonical order
// ───────────────────────────────────────────────────────────────────────────

/** Issue types, in hierarchy order. */
export const TASK_TYPES: readonly TaskType[] = ['epic', 'story', 'task', 'bug', 'subtask'];

/**
 * Priorities, HIGHEST FIRST.
 *
 * Every menu and filter list in the app renders them in this order, and it is
 * the one a triage list wants: the thing you act on is at the top.
 */
export const TASK_PRIORITIES: readonly TaskPriority[] = [
  'highest',
  'high',
  'medium',
  'low',
  'lowest',
];

// ───────────────────────────────────────────────────────────────────────────
// Glyphs and tones
// ───────────────────────────────────────────────────────────────────────────

export const TASK_TYPE_ICON: Record<TaskType, LucideIcon> = {
  epic: Zap,
  story: Bookmark,
  task: SquareCheck,
  bug: Bug,
  subtask: GitBranch,
};

/** Tone classes, not colour literals — the ramp is defined in `index.css`. */
export const TASK_TYPE_TONE: Record<TaskType, string> = {
  epic: 'text-chart-1',
  story: 'text-chart-4',
  task: 'text-chart-2',
  bug: 'text-chart-5',
  subtask: 'text-chart-3',
};

export const TASK_PRIORITY_ICON: Record<TaskPriority, LucideIcon> = {
  highest: ChevronsUp,
  high: ChevronUp,
  medium: Minus,
  low: ChevronDown,
  lowest: ChevronsDown,
};

export const TASK_PRIORITY_TONE: Record<TaskPriority, string> = {
  highest: 'text-danger',
  high: 'text-warning',
  medium: 'text-muted-foreground',
  low: 'text-info',
  lowest: 'text-muted-foreground',
};

// ───────────────────────────────────────────────────────────────────────────
// The components
// ───────────────────────────────────────────────────────────────────────────

interface GlyphProps {
  className?: string;
  /**
   * The accessible name. Omit for a decorative glyph (`aria-hidden`), which is
   * the right answer wherever adjacent text already names the value.
   */
  label?: string;
}

export function TaskTypeIcon({ type, className, label }: GlyphProps & { type: TaskType }) {
  const Icon = TASK_TYPE_ICON[type];
  const tone = TASK_TYPE_TONE[type];

  if (label === undefined) {
    return <Icon aria-hidden className={cn('size-3.5 shrink-0', tone, className)} />;
  }
  return (
    <Icon role="img" aria-label={label} className={cn('size-3.5 shrink-0', tone, className)} />
  );
}

export function PriorityIcon({
  priority,
  className,
  label,
}: GlyphProps & { priority: TaskPriority }) {
  const Icon = TASK_PRIORITY_ICON[priority];
  const tone = TASK_PRIORITY_TONE[priority];

  if (label === undefined) {
    return <Icon aria-hidden className={cn('size-3.5 shrink-0', tone, className)} />;
  }
  return (
    <Icon role="img" aria-label={label} className={cn('size-3.5 shrink-0', tone, className)} />
  );
}
