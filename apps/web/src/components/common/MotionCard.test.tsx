// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

// Registers the English catalog on the default i18next instance. Must be
// imported before anything calls `useTranslation`.
import '@/i18n';
import MotionCard from '@/components/common/MotionCard';
import { getMotionPref, MOTION_STORAGE_KEY, setMotionPref } from '@/lib/motion-policy';

/**
 * The Motion card on `/me`.
 *
 * `motion-policy.test.ts` proves the POLICY in isolation against hand-built
 * fakes; this file proves the two things only a real render can show — that the
 * card is wired to that policy in both directions (it displays the stored
 * preference, and a click persists one), and that choosing an option restamps
 * `<html data-motion>` immediately rather than on the next reload.
 *
 * jsdom, per file: `vitest.config.ts` keeps the package's default environment
 * DOM-free. The policy's module state (its cached preference) survives between
 * tests in a file, so `beforeEach` puts it back to the default explicitly —
 * clearing `localStorage` alone would leave the cache stale.
 */

beforeEach(() => {
  setMotionPref('full');
});

afterEach(() => {
  cleanup();
  delete document.documentElement.dataset.motion;
});

/** The three radios, in render order: full, reduced, system. */
function radios(): HTMLElement[] {
  return screen.getAllByRole('radio');
}

describe('MotionCard', () => {
  it('offers exactly the three policy values, Full first', () => {
    render(<MotionCard />);

    expect(radios().map((radio) => radio.getAttribute('value'))).toEqual([
      'full',
      'reduced',
      'system',
    ]);
  });

  it('renders a label AND a hint for every option', () => {
    render(<MotionCard />);

    // The hints are load-bearing copy, not decoration: "Follow system" is
    // unintelligible without one, and "Reduced" has to promise that nothing
    // disappears.
    expect(screen.getByText('Full')).toBeInTheDocument();
    expect(screen.getByText(/This is the default, even if your system asks for less/)).toBeVisible();
    expect(screen.getByText('Reduced')).toBeInTheDocument();
    expect(screen.getByText(/Nothing is hidden/)).toBeVisible();
    expect(screen.getByText('Follow system')).toBeInTheDocument();
    expect(screen.getByText(/reduce motion/)).toBeVisible();
  });

  it('shows the stored preference as the checked option', () => {
    setMotionPref('system');
    render(<MotionCard />);

    const [full, reduced, system] = radios();
    expect(full).toHaveAttribute('aria-checked', 'false');
    expect(reduced).toHaveAttribute('aria-checked', 'false');
    expect(system).toHaveAttribute('aria-checked', 'true');
  });

  it('persists the choice and restamps <html data-motion> on the spot', async () => {
    const user = userEvent.setup();
    render(<MotionCard />);

    await user.click(radios()[1] as HTMLElement);

    expect(getMotionPref()).toBe('reduced');
    expect(localStorage.getItem(MOTION_STORAGE_KEY)).toBe('reduced');
    // The stamp is the whole point: `index.css`'s gate layer reads this
    // attribute, so the interface has to stop moving without a reload.
    expect(document.documentElement.dataset.motion).toBe('reduced');
  });

  it('re-renders live when the preference changes elsewhere', () => {
    render(<MotionCard />);
    expect(radios()[0]).toHaveAttribute('aria-checked', 'true');

    // `useMotionPref` is a `useSyncExternalStore` subscription, so a change made
    // by any other holder of the policy — including the OS listener under
    // "Follow system" — has to move this card without it being re-mounted.
    // `act` because the notification originates outside React's event system.
    act(() => {
      setMotionPref('reduced');
    });

    expect(radios()[1]).toHaveAttribute('aria-checked', 'true');
    expect(radios()[0]).toHaveAttribute('aria-checked', 'false');
  });

  it('names the group for assistive tech and keeps its testid', () => {
    render(<MotionCard />);

    const group = screen.getByTestId('prefs-motion');
    expect(group).toHaveAttribute('aria-label', 'Animation');
    expect(screen.getByTestId('motion-card')).toContainElement(group);
  });
});
