// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { AnimatedTooltip } from '@/components/ui/animated-tooltip';
import { TooltipProvider } from '@/components/ui/tooltip';
import { setMotionPref } from '@/lib/motion-policy';

/**
 * `ui/animated-tooltip` — motion registry entry #1, and above all its MANDATORY
 * reduced-motion branch.
 *
 * ── WHY THE REAL POLICY, NOT A `vi.mock` ───────────────────────────────────
 *
 * `MotionCard.test.tsx` established the house pattern: drive `setMotionPref`
 * and let the real module answer. A mocked `prefersReducedMotion` would prove
 * the component branches on SOMETHING; only the real policy proves it branches
 * on the thing the Motion card writes, resolved against the OS, through the
 * `useSyncExternalStore` subscription that makes a live change take effect
 * without a remount. That subscription is the one part of this component a mock
 * would quietly delete.
 *
 * The policy caches its preference in module state, so `beforeEach` restores the
 * default explicitly — clearing `localStorage` alone leaves the cache stale.
 *
 * ── WHAT IS NOT ASSERTED ───────────────────────────────────────────────────
 *
 * Not the spring's numbers, and not the parallax pixel offsets. jsdom has no
 * layout, so `getBoundingClientRect()` is all zeroes and every transform Motion
 * computes would be asserted against a fiction. What IS assertable — and is what
 * actually breaks — is WHICH BRANCH renders, that both branches carry the same
 * testid and the same copy, and that the label reaches assistive technology
 * whether or not anything is floating.
 */

function renderTooltip(label = 'Ada Lovelace') {
  return render(
    <TooltipProvider delayDuration={0}>
      <AnimatedTooltip label={label}>
        <button type="button" data-testid="avatar">
          A
        </button>
      </AnimatedTooltip>
    </TooltipProvider>,
  );
}

/** The pointer-follow wrapper only exists in the animated branch. */
function animatedWrapper(): HTMLElement | null {
  return document.querySelector('span.relative.inline-flex');
}

beforeAll(() => {
  // Radix's floating `TooltipContent` measures its trigger through
  // `ResizeObserver`, which jsdom does not implement. Only the REDUCED branch
  // reaches it — the animated branch is our own absolutely-positioned span —
  // so without this stub exactly one branch of this suite would be unreachable.
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

beforeEach(() => {
  setMotionPref('full');
});

afterEach(() => {
  cleanup();
  setMotionPref('full');
  delete document.documentElement.dataset.motion;
});

describe('AnimatedTooltip — full motion', () => {
  it('renders the pointer-follow wrapper around the trigger', () => {
    renderTooltip();

    expect(animatedWrapper()).not.toBeNull();
    expect(screen.getByTestId('avatar')).toBeInTheDocument();
    // The tell that Radix is NOT involved in this branch.
    expect(document.querySelector('[data-slot="tooltip-trigger"]')).toBeNull();
  });

  it('keeps the label available to assistive tech while nothing is floating', () => {
    renderTooltip();

    // The floating label is `aria-hidden` and only exists on hover; without this
    // sr-only copy an avatar row would be a set of unnamed images.
    const srOnly = document.querySelector('span.sr-only');
    expect(srOnly).not.toBeNull();
    expect(srOnly).toHaveTextContent('Ada Lovelace');
  });

  it('mounts no floating label until the trigger is hovered or focused', () => {
    renderTooltip();
    expect(screen.queryByTestId('animated-tooltip')).toBeNull();
  });

  it('presents the floating label on hover, and removes it on leave', async () => {
    renderTooltip();
    const wrapper = animatedWrapper() as HTMLElement;

    fireEvent.mouseEnter(wrapper);
    const floating = await screen.findByTestId('animated-tooltip');
    expect(floating).toHaveTextContent('Ada Lovelace');
    // Decorative: the sr-only copy above is the accessible one, so the floating
    // label must not be announced a second time.
    expect(floating).toHaveAttribute('aria-hidden', 'true');

    fireEvent.mouseLeave(wrapper);
    await waitFor(() => {
      expect(screen.queryByTestId('animated-tooltip')).toBeNull();
    });
  });

  it('presents it on FOCUS too, so the row is reachable by keyboard', async () => {
    renderTooltip();

    fireEvent.focus(animatedWrapper() as HTMLElement);
    expect(await screen.findByTestId('animated-tooltip')).toBeInTheDocument();
  });

  it('survives a pointer move without layout (jsdom rects are all zero)', () => {
    renderTooltip();
    const wrapper = animatedWrapper() as HTMLElement;

    // The parallax reads `getBoundingClientRect()`, which jsdom answers with
    // zeroes. A NaN written into a motion value would throw at the next frame.
    fireEvent.mouseEnter(wrapper);
    expect(() => {
      fireEvent.mouseMove(wrapper, { clientX: 42 });
    }).not.toThrow();
  });
});

describe('AnimatedTooltip — reduced motion', () => {
  beforeEach(() => {
    setMotionPref('reduced');
  });

  it('falls back to the plain ui/tooltip primitive', () => {
    renderTooltip();

    // Radix's trigger is the tell: the animated branch has no Radix in it.
    expect(document.querySelector('[data-slot="tooltip-trigger"]')).not.toBeNull();
    expect(screen.getByTestId('avatar')).toBeInTheDocument();
    expect(animatedWrapper()).toBeNull();
  });

  it('keeps the trigger inside the span idiom, never a bare asChild child', () => {
    renderTooltip();

    // `asChild` merges Radix's own `data-state` onto its child, which would
    // clobber the state attribute of a control that has one. The span absorbs it.
    const trigger = document.querySelector('[data-slot="tooltip-trigger"]');
    expect(trigger?.tagName).toBe('SPAN');
    expect(trigger).toContainElement(screen.getByTestId('avatar'));
  });

  it('shows the SAME copy under the SAME testid when opened', async () => {
    renderTooltip();

    fireEvent.focus(document.querySelector('[data-slot="tooltip-trigger"]') as HTMLElement);

    // One testid across both branches is what lets a caller (or an e2e run)
    // assert "the tooltip said X" without first asking what the motion policy is.
    const content = await screen.findAllByTestId('animated-tooltip');
    expect(content[0]).toHaveTextContent('Ada Lovelace');
  });

  it('does not duplicate the copy as sr-only text', () => {
    renderTooltip();

    // Radix's `TooltipContent` is the accessible description in this branch, so
    // a second sr-only copy would announce the name twice.
    expect(document.querySelector('span.sr-only')).toBeNull();
  });
});

describe('AnimatedTooltip — a live preference change', () => {
  it('swaps branches without a remount, in both directions', () => {
    renderTooltip();
    expect(animatedWrapper()).not.toBeNull();

    // `act` because the notification originates outside React's event system —
    // this is exactly what the Motion card on `/me` does.
    act(() => {
      setMotionPref('reduced');
    });
    expect(animatedWrapper()).toBeNull();
    expect(document.querySelector('[data-slot="tooltip-trigger"]')).not.toBeNull();

    act(() => {
      setMotionPref('full');
    });
    expect(animatedWrapper()).not.toBeNull();
    expect(document.querySelector('[data-slot="tooltip-trigger"]')).toBeNull();
  });

  it('follows the OS only under "system" — Full outranks a reducing OS', () => {
    // The policy's whole point: an OS-wide "animation effects: off" must not be
    // able to silently disable a FlowBoard setting the user chose.
    act(() => {
      setMotionPref('full');
    });
    renderTooltip();
    expect(animatedWrapper()).not.toBeNull();
  });
});
