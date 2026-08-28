// Aliased so the DOM's own `PointerEvent`/`KeyboardEvent` stay reachable: the
// window listeners below are DOM events, the JSX handlers are React's.
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { isSideDock, useLayoutStore, type DiagDock } from '@/stores/useLayoutStore';

/**
 * The drawer's drag-to-resize grip.
 *
 * It sits absolutely on the DOCK-OPPOSITE physical edge — bottom dock → grip on
 * top, left dock → grip on the right — because that is the only edge that faces
 * the page, and dragging it is what the user reads as "make the panel bigger".
 * Keying the position off the physical dock (not a logical edge) is also what
 * makes it RTL-proof for free: the grip follows the panel, and the panel's
 * edges are physical by design.
 *
 * ── Why the pointer math is per-side ────────────────────────────────────────
 * Each dock measures its size as the distance from the pointer to its OWN
 * anchored edge — `innerHeight - clientY` for a bottom dock, `clientY` for a
 * top one — so the panel always grows toward the pointer. Using one formula for
 * both axes would invert two of the four sides.
 *
 * ── Keyboard resize ─────────────────────────────────────────────────────────
 * A `separator` with `aria-orientation` that only responds to a pointer is a
 * control half the users cannot reach. The arrow keys on the resize axis move
 * it in `KEYBOARD_STEP` px, and Home/End jump to the clamped extremes (the
 * store clamps, so asking for 0 or 99999 lands on the min/max).
 */

/** One arrow press, in px. Big enough to feel, small enough to aim. */
export const KEYBOARD_STEP = 24;

/**
 * Absolute placement of the grip, per physical dock.
 *
 * PHYSICAL, NOT LOGICAL: the grip belongs on the dock's INNER edge — the one
 * facing the page — and a dock side is a screen edge that does not mirror with
 * the language (the devtools convention this panel follows). `end-0` would put
 * the left dock's grip on its outer edge under Arabic, where there is nothing
 * to resize against.
 */
const HANDLE_POSITION: Record<DiagDock, string> = {
  bottom: 'inset-x-0 top-0 h-1.5 cursor-row-resize',
  top: 'inset-x-0 bottom-0 h-1.5 cursor-row-resize',
  left: 'inset-y-0 right-0 w-1.5 cursor-col-resize',
  right: 'inset-y-0 left-0 w-1.5 cursor-col-resize',
};

export default function DrawerResizeHandle({ dock }: { dock: DiagDock }) {
  const { t } = useTranslation(['diagnostics']);
  const setDiagHeight = useLayoutStore((state) => state.setDiagHeight);
  const setDiagWidth = useLayoutStore((state) => state.setDiagWidth);
  const side = isSideDock(dock);

  /** Absolute size for a pointer position, in the dock's own axis. */
  const applyPointer = (event: { clientX: number; clientY: number }): void => {
    switch (dock) {
      case 'bottom':
        setDiagHeight(window.innerHeight - event.clientY);
        break;
      case 'top':
        setDiagHeight(event.clientY);
        break;
      case 'left':
        setDiagWidth(event.clientX);
        break;
      case 'right':
        setDiagWidth(window.innerWidth - event.clientX);
        break;
    }
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>): void => {
    event.preventDefault();
    const element = event.currentTarget;
    element.setPointerCapture(event.pointerId);

    const onMove = (moveEvent: PointerEvent): void => {
      applyPointer(moveEvent);
    };
    const onUp = (): void => {
      try {
        element.releasePointerCapture(event.pointerId);
      } catch {
        // Capture already released (the pointer left the window) — nothing to do.
      }
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
    };

    // Listeners on the WINDOW, not the handle: a fast drag outruns a 6px grip,
    // and a resize that stops the moment the pointer leaves it is a resize
    // nobody can perform.
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    const { diagHeight, diagWidth } = useLayoutStore.getState();
    const size = side ? diagWidth : diagHeight;
    const resize = side ? setDiagWidth : setDiagHeight;

    // Which arrow GROWS the panel depends on the edge it is anchored to: a
    // bottom dock grows upward (ArrowUp), a top dock grows downward.
    const grow = dock === 'bottom' || dock === 'right' ? -1 : 1;

    switch (event.key) {
      case 'ArrowUp':
      case 'ArrowDown': {
        if (side) return;
        const direction = event.key === 'ArrowUp' ? -1 : 1;
        resize(size + direction * grow * KEYBOARD_STEP);
        break;
      }
      case 'ArrowLeft':
      case 'ArrowRight': {
        if (!side) return;
        const direction = event.key === 'ArrowLeft' ? -1 : 1;
        resize(size + direction * grow * KEYBOARD_STEP);
        break;
      }
      case 'Home':
        // Clamped by the store — 0 resolves to the minimum for this axis.
        resize(0);
        break;
      case 'End':
        resize(Number.MAX_SAFE_INTEGER);
        break;
      default:
        return;
    }
    event.preventDefault();
    // The drawer closes on Escape from within; an arrow key must not travel on
    // to the page behind it and scroll the board while the grip has focus.
    event.stopPropagation();
  };

  return (
    <div
      role="separator"
      // The separator's orientation is the LINE it draws, not the axis it
      // moves along: a side dock's grip is a vertical line.
      aria-orientation={side ? 'vertical' : 'horizontal'}
      aria-label={t('diagnostics:resize')}
      tabIndex={0}
      data-testid="fb-diag-resize"
      onPointerDown={onPointerDown}
      onKeyDown={onKeyDown}
      className={cn(
        'group absolute z-10 flex touch-none items-center justify-center focus-visible:outline-2 focus-visible:outline-[var(--ring)]',
        HANDLE_POSITION[dock],
      )}
    >
      <div
        className={cn(
          'rounded-full bg-[var(--border)] transition-colors duration-[var(--speed)] group-hover:bg-[var(--text-muted)]',
          side ? 'h-10 w-1' : 'h-1 w-10',
        )}
      />
    </div>
  );
}
