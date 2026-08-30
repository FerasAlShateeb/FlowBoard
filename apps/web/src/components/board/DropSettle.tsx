import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { motion } from 'motion/react';

import { prefersReducedMotion } from '@/lib/motion-policy';

/**
 * THE DROP SETTLE — the one beat of movement a board card gets when it lands.
 *
 * ═══ WHAT IT IS, AND WHY IT IS NOT A CSS TRANSITION ════════════════════════
 *
 * A dropped card arrives instantly: dnd-kit releases its transform, the
 * optimistic cache write re-renders the column, and the card is simply THERE.
 * On a wall of near-identical cards that is a real problem — the eye has no
 * anchor for which one just moved, and the answer people reach for (a coloured
 * flash) says "something is wrong" rather than "this is the one you moved".
 *
 * A ~150ms spring from `scale(1.02)` to rest is the Linear answer: it reads as
 * mass arriving, not as a state change, and it is over before it can annoy
 * anyone who does this fifty times an hour.
 *
 * CSS cannot express it. A keyframe under `index.css`'s `data-motion='full'`
 * gate would have to be RETRIGGERED per drop — which means re-keying the element
 * anyway — and a keyframed approximation of a spring is a cubic-bezier guess
 * that has to be re-tuned every time the numbers move. `index.css` is also a
 * closed, append-only block owned by another work package. So this is entry #2
 * of the sanctioned motion registry (`lib/motion-registry.ts`).
 *
 * ═══ THE REDUCED BRANCH ════════════════════════════════════════════════════
 *
 * Under `prefersReducedMotion()` the settle key is NEVER incremented, so this
 * renders a bare `<div>` with no `motion` component in it at all — not a
 * `motion.div` with its animation props stripped, an actual plain div. Nothing
 * is hidden and nothing moves: the card still lands where it landed, the toast
 * and the announcement still fire, and reduced-motion users lose exactly the
 * movement and nothing else.
 *
 * The gate is read AT FIRE TIME (inside the effect), not at render time, which
 * is what makes a live preference change on `/me` take effect on the very next
 * drop without this component subscribing to the policy. There is nothing to
 * re-render when the preference flips — a settle that is not currently playing
 * has no state to correct.
 *
 * ═══ WHY A MODULE SIGNAL AND NOT THE DRAG CONTEXT ══════════════════════════
 *
 * `BoardDragContext` changes on EVERY drag-over frame. `BoardCard` is `memo`'d
 * precisely so a 200-card board does not re-render 200 cards per frame, and a
 * context subscription is immune to `memo` — reading the drop signal from there
 * would undo that optimisation for a one-frame flourish.
 *
 * So the signal is a module-level listener set, the same shape as
 * `lib/motion-policy.ts` and `lib/lang-policy.ts`, and each card's
 * `useSyncExternalStore` snapshot is the BOOLEAN "was it me?" rather than the
 * id. A drop therefore re-renders exactly one card: every other card's snapshot
 * is `false` before the signal and `false` after it, so React bails out.
 */

/** How far above rest the card starts. Small on purpose — this is a settle. */
const SETTLE_FROM_SCALE = 1.02;

/**
 * Near-critical (ζ ≈ 0.94), ~150ms to rest.
 *
 * A settle is an ARRIVAL, so it must not bounce: an overshoot below rest would
 * make the card look like it is still deciding where to go. Compare the
 * deliberately springy `POP_SPRING` in `ui/animated-tooltip.tsx`, where the
 * overshoot IS the effect.
 */
const SETTLE_SPRING = { type: 'spring', stiffness: 420, damping: 30, mass: 0.6 } as const;

/** The task whose card should settle, or `null`. Consumed by the first observer. */
let droppedTaskId: string | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

/**
 * "This task's card just landed."
 *
 * Called from `BoardDndProvider`'s `onDragEnd`, AFTER the move has been accepted
 * and handed to the mutation — never for a rejected drop (a WIP or transition
 * refusal already has a toast, and rewarding it with a landing animation would
 * say the opposite of what the toast says).
 */
export function signalTaskDropped(taskId: string): void {
  droppedTaskId = taskId;
  notify();
}

/**
 * Clears the pending signal. Called by the card that consumed it, so one drop
 * can only ever produce one settle — including when the card lands in a
 * different column and therefore MOUNTS rather than updating.
 */
function consumeDrop(taskId: string): void {
  if (droppedTaskId !== taskId) return;
  droppedTaskId = null;
  notify();
}

/** Test seam (house convention): drops the pending signal and all subscribers. */
export function clearDropSettleForTest(): void {
  droppedTaskId = null;
  listeners.clear();
}

export interface DropSettleProps {
  /** The card's task id — the signal is addressed to exactly one of them. */
  taskId: string;
  children: ReactNode;
}

export function DropSettle({ taskId, children }: DropSettleProps) {
  // The boolean, not the id: see the header note on why this re-renders one card.
  const justDropped = useSyncExternalStore(
    subscribe,
    () => droppedTaskId === taskId,
    () => false,
  );

  // Monotonic: each increment re-keys the wrapper below, which is what makes a
  // second drop on the same card replay the spring instead of no-op'ing on an
  // `animate` target it is already at.
  const [settleKey, setSettleKey] = useState(0);

  useEffect(() => {
    if (!justDropped) return;
    consumeDrop(taskId);
    // THE REDUCED BRANCH. Read here rather than at render time so the answer is
    // the one in force when the card actually lands.
    if (prefersReducedMotion()) return;
    setSettleKey((current) => current + 1);
  }, [justDropped, taskId]);

  if (settleKey === 0) {
    // Idle, and the reduced branch: a plain div, no animation runtime attached.
    return <div data-slot="drop-settle">{children}</div>;
  }

  return (
    <motion.div
      // The remount is the retrigger. `initial` only applies on mount, and a
      // fresh mount is also exactly what a cross-column landing does anyway, so
      // both landings take the identical path through this component.
      key={settleKey}
      data-slot="drop-settle"
      data-settled="true"
      initial={{ scale: SETTLE_FROM_SCALE }}
      animate={{ scale: 1 }}
      transition={SETTLE_SPRING}
    >
      {children}
    </motion.div>
  );
}

export default DropSettle;
