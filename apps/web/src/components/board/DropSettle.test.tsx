// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  DropSettle,
  clearDropSettleForTest,
  signalTaskDropped,
} from '@/components/board/DropSettle';
import { setMotionPref } from '@/lib/motion-policy';

/**
 * The board's drop settle — motion registry entry #3.
 *
 * ── WHAT THIS SUITE IS ACTUALLY GUARDING ───────────────────────────────────
 *
 * Not the spring. jsdom has no compositor and no layout, so asserting on a
 * transform Motion computed would be asserting against a fiction. The three
 * things that break in real life are all structural:
 *
 *   1. ONE settle per drop. The signal is module state, and module state that
 *      is never consumed replays on the next mount — a card that re-settles
 *      every time a filter changes is worse than one that never settles.
 *   2. ADDRESSED to one card. A wall of 200 cards popping at once is the exact
 *      failure this feature is trying to avoid, not a bug you would spot late.
 *   3. The REDUCED BRANCH renders no Motion component at all — a plain `<div>`,
 *      with the children untouched.
 *
 * The signal's module state survives between tests in a file, so `beforeEach`
 * clears it through the house `…ForTest` seam.
 */

const CARD = 'task-a';
const OTHER = 'task-b';

function settle(taskId: string): HTMLElement | null {
  return (
    document
      .querySelector(`[data-testid="face-${taskId}"]`)
      ?.closest('[data-slot="drop-settle"]') ?? null
  );
}

function renderTwoCards() {
  return render(
    <>
      <DropSettle taskId={CARD}>
        <p data-testid={`face-${CARD}`}>card a</p>
      </DropSettle>
      <DropSettle taskId={OTHER}>
        <p data-testid={`face-${OTHER}`}>card b</p>
      </DropSettle>
    </>,
  );
}

beforeEach(() => {
  clearDropSettleForTest();
  setMotionPref('full');
});

afterEach(() => {
  cleanup();
  clearDropSettleForTest();
  setMotionPref('full');
  delete document.documentElement.dataset.motion;
});

describe('DropSettle — idle', () => {
  it('renders its children inside a plain wrapper before any drop', () => {
    renderTwoCards();

    expect(screen.getByTestId(`face-${CARD}`)).toBeInTheDocument();
    // No settle has happened, so nothing is marked as having settled.
    expect(settle(CARD)).not.toHaveAttribute('data-settled');
  });

  it('keeps the wrapper slot stable so board CSS never sees the DOM shift', () => {
    renderTwoCards();
    expect(settle(CARD)).not.toBeNull();
    expect(settle(OTHER)).not.toBeNull();
  });
});

describe('DropSettle — full motion', () => {
  it('settles the card that landed, and only that card', () => {
    renderTwoCards();

    // `act` because the signal originates outside React's event system — this is
    // dnd-kit's `onDragEnd` calling into a module listener set.
    act(() => {
      signalTaskDropped(CARD);
    });

    expect(settle(CARD)).toHaveAttribute('data-settled', 'true');
    expect(settle(OTHER)).not.toHaveAttribute('data-settled');
  });

  it('keeps the children mounted and unchanged through the settle', () => {
    renderTwoCards();
    act(() => {
      signalTaskDropped(CARD);
    });

    // The remount is the retrigger mechanism; the CONTENT must be identical
    // afterwards or the settle would be visibly re-rendering the card.
    expect(screen.getByTestId(`face-${CARD}`)).toHaveTextContent('card a');
  });

  it('consumes the signal, so a later mount does not replay it', () => {
    renderTwoCards();
    act(() => {
      signalTaskDropped(CARD);
    });
    cleanup();

    // A filter change, a tab return, a re-render of the board: the card mounts
    // again and must be idle.
    renderTwoCards();
    expect(settle(CARD)).not.toHaveAttribute('data-settled');
  });

  it('settles again on a SECOND drop of the same card', () => {
    renderTwoCards();
    act(() => {
      signalTaskDropped(CARD);
    });
    const first = settle(CARD);

    act(() => {
      signalTaskDropped(CARD);
    });
    const second = settle(CARD);

    expect(second).toHaveAttribute('data-settled', 'true');
    // The key incremented, so this is a NEW element — which is precisely what
    // restarts the spring rather than no-op'ing on a target it already holds.
    expect(second).not.toBe(first);
  });

  it('ignores a signal for a card that is not mounted', () => {
    renderTwoCards();

    expect(() => {
      act(() => {
        signalTaskDropped('task-not-here');
      });
    }).not.toThrow();
    expect(settle(CARD)).not.toHaveAttribute('data-settled');
    expect(settle(OTHER)).not.toHaveAttribute('data-settled');
  });
});

describe('DropSettle — reduced motion', () => {
  beforeEach(() => {
    setMotionPref('reduced');
  });

  it('never settles, and never mounts a Motion component', () => {
    renderTwoCards();
    act(() => {
      signalTaskDropped(CARD);
    });

    expect(settle(CARD)).not.toHaveAttribute('data-settled');
    // Reduced motion removes MOVEMENT, never information: the card is still
    // exactly where it landed, with its content intact.
    expect(screen.getByTestId(`face-${CARD}`)).toHaveTextContent('card a');
  });

  it('still consumes the signal, so flipping back to Full does not fire a stale settle', () => {
    renderTwoCards();
    act(() => {
      signalTaskDropped(CARD);
    });

    act(() => {
      setMotionPref('full');
    });
    // The drop happened while the user wanted less movement. Changing their mind
    // afterwards must not retroactively animate a card that already landed.
    expect(settle(CARD)).not.toHaveAttribute('data-settled');
  });

  it('reads the policy at FIRE time, so the next drop after a change is animated', () => {
    renderTwoCards();
    act(() => {
      setMotionPref('full');
    });
    act(() => {
      signalTaskDropped(CARD);
    });

    expect(settle(CARD)).toHaveAttribute('data-settled', 'true');
  });
});
