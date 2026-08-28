import { useRef, type Ref } from 'react';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { useVirtualizer } from '@tanstack/react-virtual';
import { useTranslation } from 'react-i18next';
import type { Label, Sprint, Status, TaskSummary } from '@flowboard/shared';

import { cn } from '@/lib/utils';
import type { SprintBucket } from '@/lib/board-cache';
import { Skeleton } from '@/components/ui/skeleton';
import ErrorState from '@/components/common/ErrorState';
import BacklogTaskRow from '@/components/backlog/BacklogTaskRow';

/**
 * The rows of ONE bucket, and the four states that bucket can be in: loading,
 * failed, empty, populated.
 *
 * ── One `SortableContext` per bucket ────────────────────────────────────────
 * dnd-kit sorts WITHIN a context. Each backlog bucket is its own cache entry and
 * its own ordering, so each gets its own context — all of them inside the page's
 * single `DndContext`, which is what makes a drag from one section into another
 * a single gesture.
 *
 * ── The drop strip ──────────────────────────────────────────────────────────
 * The last row is the last drop target a sortable list offers, so without the
 * strip below it there is nowhere to say "put this at the very end". It is the
 * SAME droppable the section registers for its collapsed header and its empty
 * body — never two at once, which is why one id is enough (see `backlog-dnd`).
 * It sits OUTSIDE the scroll viewport below, so "the end of this bucket" is
 * reachable without scrolling to the end of a long one.
 *
 * ═══ WINDOWING (WP5.6) ═════════════════════════════════════════════════════
 *
 * A backlog is the one list in FlowBoard with no page size: `useBacklogBucket`
 * asks for 100 rows and a real project's backlog is the biggest bucket in it.
 * Every row is a `useSortable` subscription, a dropdown menu, an avatar and
 * several icons, and rendering all of them made a planning session's first
 * paint — and every drag frame after it — proportional to the whole backlog
 * rather than to what is on screen.
 *
 * Above {@link VIRTUALIZE_ABOVE} rows the list renders a WINDOW, following the
 * same pattern as the Table view's grid (`components/datatable/TaskDataTable`):
 * a fixed row height, no `measureElement` (the rows are one line by
 * construction, so a ResizeObserver per row would measure a number this file
 * already knows), and a small overscan so a fast scroll shows no gap.
 *
 * ── Two things the window must not break ────────────────────────────────────
 *
 * 1. **`SortableContext` still receives the FULL id list.** Only the RENDERED
 *    set is windowed. dnd-kit derives a sortable's index from that array, and
 *    handing it the visible slice would make every drag compute its
 *    neighbours against a list that starts at whatever row happened to be at
 *    the top of the viewport — the drop would land dozens of rows away. (The
 *    page's drag mapping reads the cache rather than the DOM for the same
 *    reason; see `BacklogView`.)
 * 2. **The rows stay in normal flow.** The window is expressed as PADDING above
 *    and below the rendered slice, not as absolutely-positioned rows. dnd-kit's
 *    sortable already owns each row's `transform` while a drag is in flight,
 *    and a second transform for virtual positioning would fight it — the row
 *    would jump the moment it was picked up. Padding costs one extra style on
 *    the `<ul>` and leaves the drag maths untouched.
 *
 * The pitch below (`ROW_HEIGHT + ROW_GAP`) is what the virtualizer measures in.
 * The rendered block is one gap short of `n × pitch` (n rows have n-1 gaps
 * between them), so a fully scrolled bucket is at most 1px shorter than the
 * spacer claims — invisible, and the price of keeping `gap-px` rather than
 * hard-coding margins the theme cannot change.
 */

/** One row, `h-8`. Fixed by design — see the note above about `measureElement`. */
const ROW_HEIGHT = 32;

/** The `gap-px` between two rows, so the pitch matches what is drawn. */
const ROW_GAP = 1;

const ROW_PITCH = ROW_HEIGHT + ROW_GAP;

/** The `<ul>`'s own `p-1.5`, which the window's spacers are added ON TOP of. */
const LIST_PAD = 6;

/**
 * Below this many rows the whole bucket renders, exactly as before.
 *
 * Windowing is not free — a scroll container, a spacer, a measurement — and a
 * sprint of twelve stories is laid out by the browser in one pass. Fifty is the
 * same threshold the Table view uses, for the same reason.
 */
const VIRTUALIZE_ABOVE = 50;

/** Rows kept rendered outside the viewport, so a fast scroll shows no gap. */
const OVERSCAN = 8;

/** Everything a row needs that is the same for every row on the page. */
export interface BacklogRowContext {
  projectKey: string;
  labels: readonly Label[];
  statuses: readonly Status[];
  /** Sprints a row may be moved into from its menu. */
  moveTargets: readonly Sprint[];
  canWrite: boolean;
  onMove: (taskId: string, from: SprintBucket, to: SprintBucket) => void;
}

export function TaskRowList({
  sprintId,
  tasks,
  isPending,
  error,
  onRetry,
  emptyMessage,
  emptyHint,
  dropRef,
  isOver,
  context,
}: {
  sprintId: SprintBucket;
  /** The rows to DRAW — already narrowed by any client-side filter. */
  tasks: readonly TaskSummary[];
  isPending: boolean;
  error: unknown;
  onRetry: () => void;
  emptyMessage: string;
  emptyHint?: string;
  /** The section's droppable, attached to whichever element can accept a drop. */
  dropRef: Ref<HTMLDivElement>;
  isOver: boolean;
  context: BacklogRowContext;
}) {
  const { t } = useTranslation(['backlog']);
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualized = tasks.length > VIRTUALIZE_ABOVE;

  // Declared before the early returns below, because hooks are not conditional.
  // It costs nothing while the bucket is loading, failed or empty: `count` is 0
  // and it produces no items.
  const virtualizer = useVirtualizer({
    count: tasks.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_PITCH,
    // Keyed by task id, so a refetch that reorders the bucket keeps each row's
    // React identity rather than remounting the window.
    getItemKey: (index) => tasks[index]?.id ?? index,
    overscan: OVERSCAN,
  });

  if (isPending) {
    return (
      <div className="flex flex-col gap-1 p-1.5">
        {[0, 1, 2].map((row) => (
          <Skeleton key={row} className="h-8 w-full" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <ErrorState
        error={error}
        onRetry={onRetry}
        title={t('backlog:sections.loadFailed')}
        className="py-6"
      />
    );
  }

  if (tasks.length === 0) {
    return (
      <div
        ref={dropRef}
        className={cn(
          'm-1.5 rounded-[var(--radius)] border border-dashed border-border px-3 py-6 text-center text-xs text-muted-foreground transition-colors duration-[var(--speed)]',
          isOver && 'border-brand-accent bg-brand-accent/8 text-foreground',
        )}
      >
        <p>{emptyMessage}</p>
        {emptyHint ? <p className="mt-0.5 opacity-80">{emptyHint}</p> : null}
      </div>
    );
  }

  const items = virtualized ? virtualizer.getVirtualItems() : [];
  const first = items[0];
  const last = items[items.length - 1];

  /** The rows actually put in the DOM, paired with their index in the bucket. */
  const rendered = virtualized
    ? items.flatMap((item) => {
        const task = tasks[item.index];
        return task ? [{ task, index: item.index }] : [];
      })
    : tasks.map((task, index) => ({ task, index }));

  const spacers =
    virtualized && first && last
      ? {
          paddingBlockStart: LIST_PAD + first.start,
          paddingBlockEnd: LIST_PAD + Math.max(virtualizer.getTotalSize() - last.end, 0),
        }
      : undefined;

  const list = (
    <ul className="flex flex-col gap-px p-1.5" style={spacers}>
      {rendered.map(({ task, index }) => (
        <BacklogTaskRow
          key={task.id}
          task={task}
          projectKey={context.projectKey}
          labels={context.labels}
          statuses={context.statuses}
          moveTargets={context.moveTargets}
          currentSprintId={sprintId}
          canWrite={context.canWrite}
          // Only while windowed: otherwise the DOM already IS the list, and
          // stating the obvious in ARIA is noise.
          position={virtualized ? index + 1 : undefined}
          setSize={virtualized ? tasks.length : undefined}
          onMove={(to) => {
            context.onMove(task.id, sprintId, to);
          }}
        />
      ))}
    </ul>
  );

  return (
    // The FULL id list, never the window — see note 1 in the header.
    <SortableContext items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
      {virtualized ? (
        // The viewport the window scrolls in. A long bucket gets its own scroll
        // area rather than growing the page without limit, which is also what
        // gives the virtualizer something to measure — the app shell's `<main>`
        // scrolls, so there is no window scroll to hang this off.
        <div ref={scrollRef} className="max-h-[60vh] overflow-y-auto overscroll-contain">
          {list}
        </div>
      ) : (
        list
      )}

      {/* "The end of this bucket", as a target. Two pixels of dead space that
          make an append possible without a modifier key. */}
      <div
        ref={dropRef}
        aria-hidden
        className={cn(
          'mx-1.5 mb-1.5 h-2 rounded-[var(--radius-sm)] transition-colors duration-[var(--speed)]',
          isOver && 'bg-brand-accent/40',
        )}
      />
    </SortableContext>
  );
}

export default TaskRowList;
