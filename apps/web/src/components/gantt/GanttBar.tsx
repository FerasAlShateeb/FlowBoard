import {
  useCallback,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import type { StatusCategory } from '@flowboard/shared';

import { cn } from '@/lib/utils';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  BAR_HEIGHT,
  EPIC_BAR_HEIGHT,
  type GanttGeometry,
} from '@/components/gantt/useGanttGeometry';
import {
  spanOf,
  type DateSpan,
  type GanttEpicRow,
  type GanttTaskRow,
} from '@/components/gantt/gantt-rows';
import { applyDrag, deltaDaysFromPx, type DragMode } from '@/components/gantt/gantt-drag';
import { longDayRange } from '@/components/gantt/gantt-format';

/**
 * One bar: the only draggable thing in the product outside the Kanban board.
 *
 * ═══ WHAT THIS FILE OWNS AND WHAT IT DOES NOT ═════════════════════════════
 *
 * It owns POINTER MECHANICS — capture, the live preview, suppressing the click
 * that a completed drag would otherwise fire — and nothing else. Every date
 * decision is `gantt-drag.ts` (`deltaDaysFromPx`, `applyDrag`) and every pixel
 * is `useGanttGeometry` (`barRect`). That split is deliberate: pointer
 * mechanics can only be verified by using them, date arithmetic can only be
 * verified by testing it, and mixing the two would leave the arithmetic
 * unreachable from a test.
 *
 * ═══ POINTER CAPTURE, NOT WINDOW LISTENERS ════════════════════════════════
 *
 * `setPointerCapture` routes every subsequent move and the release to THIS
 * element, whatever the pointer is over. So a drag survives the pointer leaving
 * the bar, crossing another row, or exiting the canvas entirely — and it ends
 * exactly once, with no `mouseup`-on-window listener to leak. It is also what
 * makes the gesture work with a pen or a touch contact unchanged.
 *
 * ═══ THE PREVIEW AND WHO CLEARS IT ════════════════════════════════════════
 *
 * While dragging, the bar renders a LOCAL span so it tracks the pointer at 60fps
 * without a request per frame. On release it keeps that preview and awaits the
 * PATCH: on success the fresh task arrives through the query cache and the
 * preview is dropped onto identical dates (no flicker); on failure the preview
 * is dropped onto the OLD dates, so the bar visibly snaps back to where the
 * server says it is — which, next to the error toast `usePatchTask` raises, is
 * the correct story. Clearing the preview at `pointerup` instead would flash
 * the old position for a frame on every successful drag.
 *
 * ═══ EPICS ═══════════════════════════════════════════════════════════════
 *
 * An epic bar whose dates are ROLLED UP from its children is not draggable, and
 * says so in its tooltip: there is no date on the epic to write, and inventing
 * one would silently convert a derived range into a fixed commitment. An epic
 * that carries its OWN dates drags like any other bar.
 */

/** Tints, one per status category. Tokens only — no colour literal anywhere. */
const CATEGORY_TINT: Record<StatusCategory, { background: string; borderColor: string }> = {
  todo: {
    background: 'color-mix(in oklab, var(--text-muted) 24%, transparent)',
    borderColor: 'color-mix(in oklab, var(--text-muted) 45%, transparent)',
  },
  in_progress: {
    background: 'color-mix(in oklab, var(--primary) 42%, transparent)',
    borderColor: 'color-mix(in oklab, var(--primary) 72%, transparent)',
  },
  // "done at reduced alpha": finished work should recede, not compete with the
  // work still in flight.
  done: {
    background: 'color-mix(in oklab, var(--success) 26%, transparent)',
    borderColor: 'color-mix(in oklab, var(--success) 48%, transparent)',
  },
};

const EPIC_TINT: CSSProperties = {
  background: 'color-mix(in oklab, var(--primary) 22%, transparent)',
  borderColor: 'color-mix(in oklab, var(--primary) 55%, transparent)',
};

/** Narrower than this and the title is illegible, so it moves outside the bar. */
const TITLE_MIN_WIDTH = 72;

/** A drag under this many pixels is a click that wobbled, not a gesture. */
const DRAG_THRESHOLD_PX = 3;

export interface GanttBarProps {
  row: GanttEpicRow | GanttTaskRow;
  geometry: GanttGeometry;
  category: StatusCategory | undefined;
  /** False for viewers, and for epics whose dates are derived. */
  editable: boolean;
  /** True while a dependency arrow touching this bar is hovered. */
  highlighted: boolean;
  locale: string;
  /** Resolves when the PATCH settles — see "the preview and who clears it". */
  onCommit: (taskId: string, patch: { startDate: string; dueDate: string }) => Promise<unknown>;
  onOpen: (taskId: string) => void;
  onHover: (taskId: string | null) => void;
}

export function GanttBar({
  row,
  geometry,
  category,
  editable,
  highlighted,
  locale,
  onCommit,
  onOpen,
  onHover,
}: GanttBarProps) {
  const { t } = useTranslation(['roadmap']);
  const isEpic = row.kind === 'epic';
  const baseSpan: DateSpan = isEpic ? row.span : spanOf(row.task);

  const [preview, setPreview] = useState<DateSpan>(null);
  const previewRef = useRef<DateSpan>(null);
  const dragRef = useRef<{
    mode: DragMode;
    originX: number;
    base: DateSpan;
    pointerId: number;
    moved: boolean;
  } | null>(null);
  /** Set by a completed drag, consumed by the click it would otherwise fire. */
  const suppressClickRef = useRef(false);

  const draggable = editable && !(isEpic && row.rolledUp);

  const commit = useCallback(
    (next: DateSpan) => {
      if (next === null) return;
      previewRef.current = next;
      setPreview(next);
      void onCommit(row.task.id, { startDate: next.startDate, dueDate: next.dueDate })
        // The toast is `usePatchTask`'s job; this only has to stop the rejection
        // escaping and to put the bar back where the server says it is.
        .catch(() => undefined)
        .finally(() => {
          previewRef.current = null;
          setPreview(null);
        });
    },
    [onCommit, row.task.id],
  );

  const cancelDrag = useCallback(() => {
    dragRef.current = null;
    previewRef.current = null;
    setPreview(null);
  }, []);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>, mode: DragMode) => {
    // Only the primary button drags; a right-click must reach the context menu.
    if (!draggable || baseSpan === null || event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      mode,
      originX: event.clientX,
      base: baseSpan,
      pointerId: event.pointerId,
      moved: false,
    };
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;

    // `clientX` is a VIEWPORT coordinate, and the canvas is a `dir="ltr"`
    // island, so a rightward drag is a positive delta and later in time — on an
    // Arabic page as much as an English one. That is the single line the RTL
    // island buys us; without it every delta here would need a sign flip.
    const dx = event.clientX - drag.originX;
    if (Math.abs(dx) > DRAG_THRESHOLD_PX) drag.moved = true;

    const next = applyDrag(drag.base, drag.mode, deltaDaysFromPx(dx, geometry.dayWidth));
    previewRef.current = next;
    setPreview(next);
  };

  const onPointerUp = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;

    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }

    // A gesture that never crossed the threshold is a click. Committing it
    // anyway would PATCH a single-dated task into a two-dated one just for
    // being clicked, because the resolved span always carries both dates.
    if (!drag.moved) {
      cancelDrag();
      return;
    }

    suppressClickRef.current = true;
    commit(previewRef.current);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape' && dragRef.current) {
      cancelDrag();
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onOpen(row.task.id);
      return;
    }

    const forward = event.key === 'ArrowRight';
    const back = event.key === 'ArrowLeft';
    if (!forward && !back) return;
    if (!draggable || baseSpan === null) return;

    // Arrow keys are the accessible twin of the drag, and they go through the
    // SAME `applyDrag` — so the minimum-one-day clamp and the inclusive-end
    // arithmetic cannot differ between mouse and keyboard.
    event.preventDefault();
    event.stopPropagation();
    commit(applyDrag(baseSpan, event.shiftKey ? 'resize-end' : 'move', forward ? 1 : -1));
  };

  const span = preview ?? baseSpan;
  const rect = span === null ? null : geometry.barRect(span);
  if (rect === null) return null;

  const height = isEpic ? EPIC_BAR_HEIGHT : BAR_HEIGHT;
  const tint: CSSProperties = isEpic ? EPIC_TINT : CATEGORY_TINT[category ?? 'todo'];
  const showTitle = rect.width >= TITLE_MIN_WIDTH;
  const progress = isEpic && row.childCount > 0 ? row.doneCount / row.childCount : 0;
  const dragging = dragRef.current !== null;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          data-testid="gantt-bar"
          data-task-id={row.task.id}
          data-dragging={dragging || undefined}
          aria-label={`${row.task.title} — ${longDayRange(rect.start, rect.end, locale)}`}
          className={cn(
            'absolute flex touch-none items-center rounded-[4px] border text-[11px] leading-none transition-shadow duration-[var(--speed)]',
            draggable ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer',
            dragging && 'z-20 shadow-[var(--shadow-2)]',
            highlighted && 'ring-2 ring-[var(--accent)] ring-offset-1 ring-offset-background',
          )}
          style={{
            left: rect.x,
            width: Math.max(rect.width, 6),
            height,
            top: `calc(50% - ${height / 2}px)`,
            ...tint,
          }}
          onPointerDown={(event) => {
            onPointerDown(event, 'move');
          }}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={cancelDrag}
          onKeyDown={onKeyDown}
          onMouseEnter={() => {
            onHover(row.task.id);
          }}
          onMouseLeave={() => {
            onHover(null);
          }}
          onClick={() => {
            if (suppressClickRef.current) {
              suppressClickRef.current = false;
              return;
            }
            onOpen(row.task.id);
          }}
        >
          {/* Epic progress: how much of the epic's scope is already done, drawn
              INSIDE its own bar rather than as a separate row, so the roll-up
              and its completion are one object. */}
          {isEpic && progress > 0 ? (
            <div
              aria-hidden
              className="absolute inset-y-0 left-0 rounded-l-[3px]"
              style={{
                width: `${Math.min(100, progress * 100)}%`,
                background: 'color-mix(in oklab, var(--primary) 62%, transparent)',
              }}
            />
          ) : null}

          {showTitle ? (
            <span className="relative z-10 truncate px-1.5 text-foreground">{row.task.title}</span>
          ) : null}

          {/* Resize handles. `aria-hidden` on purpose: a keyboard user resizes
              with Shift+Arrow on the bar itself (see `onKeyDown`), which is one
              focus stop instead of three.

              `left-0`/`right-0` and `rounded-l`/`rounded-r` are PHYSICAL on
              purpose: the bar sits in the canvas's `dir="ltr"` island (see
              `GanttChart`), where the start date is always the left edge. Under
              Arabic a logical `start-0` would put the START handle on the bar's
              right edge while the geometry underneath still grew rightwards
              with time — the handle and the date it drags would be at opposite
              ends. The epic progress fill above is left-anchored for the same
              reason: progress accumulates from the start date. */}
          {draggable ? (
            <>
              <div
                aria-hidden
                data-testid="gantt-resize-start"
                className="absolute inset-y-0 left-0 w-2 cursor-ew-resize rounded-l-[4px] hover:bg-foreground/10"
                onPointerDown={(event) => {
                  onPointerDown(event, 'resize-start');
                }}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={cancelDrag}
              />
              <div
                aria-hidden
                data-testid="gantt-resize-end"
                className="absolute inset-y-0 right-0 w-2 cursor-ew-resize rounded-r-[4px] hover:bg-foreground/10"
                onPointerDown={(event) => {
                  onPointerDown(event, 'resize-end');
                }}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={cancelDrag}
              />
            </>
          ) : null}
        </div>
      </TooltipTrigger>

      <TooltipContent side="top" className="max-w-64">
        <p className="font-mono text-[10px] text-muted-foreground">{row.task.type.toUpperCase()}</p>
        <p className="font-medium">{row.task.title}</p>
        <p className="tabular-nums" dir="ltr">
          {longDayRange(rect.start, rect.end, locale)}
        </p>
        {isEpic ? (
          <p className="mt-1 text-muted-foreground">
            {t('roadmap:bar.progress', { done: row.doneCount, total: row.childCount })}
          </p>
        ) : null}
        {isEpic && row.rolledUp ? (
          <p className="mt-1 text-muted-foreground">{t('roadmap:bar.rolledUp')}</p>
        ) : null}
        {row.subtaskCount > 0 ? (
          <p className="text-muted-foreground">
            {t('roadmap:sidebar.subtasks', { count: row.subtaskCount })}
          </p>
        ) : null}
        {draggable ? (
          <p className="mt-1 text-muted-foreground">{t('roadmap:bar.keyboardHint')}</p>
        ) : null}
      </TooltipContent>
    </Tooltip>
  );
}

export default GanttBar;
