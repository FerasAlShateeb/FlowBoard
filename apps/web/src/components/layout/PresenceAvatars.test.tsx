// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PresenceEntry } from '@flowboard/shared';

import { qk } from '@/lib/query-keys';
import { setMotionPref } from '@/lib/motion-policy';
import { TooltipProvider } from '@/components/ui/tooltip';
import PresenceAvatars from '@/components/layout/PresenceAvatars';
import { useAuthStore, type AuthUser } from '@/stores/useAuthStore';
import { usePresenceStore } from '@/stores/usePresenceStore';

/**
 * The topbar presence row, after it was handed `ui/animated-tooltip`.
 *
 * ── WHAT CHANGED, AND THEREFORE WHAT THIS GUARDS ───────────────────────────
 *
 * The row used to wrap every face in the plain Radix `Tooltip`, whose content is
 * only in the DOM while it is open. `AnimatedTooltip`'s animated branch instead
 * renders an `sr-only` copy of the label at all times — which is a strict
 * accessibility improvement (an avatar stack of five unnamed images becomes five
 * named ones) and, conveniently, the thing that makes this suite assertable
 * without simulating hover on a stack of overlapping 24px circles.
 *
 * The INFORMATION had to survive that move. The old tooltip was two nodes — a
 * name and, when the person had a task open, its key in a `dir="ltr"` span.
 * `AnimatedTooltip` takes a string, so the two are joined; these tests are what
 * stop the key from being quietly dropped on the way.
 *
 * ── WHY BOTH POLICY BRANCHES ARE EXERCISED HERE TOO ────────────────────────
 *
 * `animated-tooltip.test.tsx` proves the component branches. This file proves
 * the ROW still works in both — that Reduced motion does not cost a presence
 * avatar its identity, only its parallax.
 */

const PROJECT = '11111111-1111-4111-8111-111111111111';
const SELF = '22222222-2222-4222-8222-222222222222';
const TASK = '33333333-3333-4333-8333-333333333333';

/** The reader. Only `id` matters here — it is what `useOthersPresent` drops. */
const ME: AuthUser = {
  id: SELF,
  email: 'me@example.com',
  name: 'Me',
  avatarUrl: null,
  isGlobalAdmin: false,
  locale: 'en',
  isActive: true,
  createdAt: '2026-01-01T00:00:00.000Z',
};

/**
 * Seed the one field `taskKeyOf` reads out of the query cache.
 *
 * Deliberately NOT a whole `Task` cast to a partial: the component reads exactly
 * `.key`, and a hand-built 30-field fixture would assert nothing extra while
 * breaking every time the schema grows a column.
 */
function seedTaskKey(key: string): void {
  client.setQueryData(qk.task.detail(TASK), { key });
}

function person(id: string, name: string, taskId: string | null = null): PresenceEntry {
  return { user: { id, name, avatarUrl: null }, taskId };
}

/** Six others, so the row overflows past its five-face cap. */
function crowd(): PresenceEntry[] {
  return [
    person('u1', 'Ada Lovelace'),
    person('u2', 'Grace Hopper'),
    person('u3', 'Alan Turing'),
    person('u4', 'Katherine Johnson'),
    person('u5', 'Barbara Liskov'),
    person('u6', 'Margaret Hamilton'),
  ];
}

let client: QueryClient;

function renderRow(entries: PresenceEntry[]) {
  usePresenceStore.getState().setRoster(PROJECT, entries);
  return render(
    <QueryClientProvider client={client}>
      <TooltipProvider delayDuration={0}>
        <PresenceAvatars projectId={PROJECT} />
      </TooltipProvider>
    </QueryClientProvider>,
  );
}

/** Every label the row currently exposes to assistive tech, in DOM order. */
function srLabels(): string[] {
  return [...document.querySelectorAll('span.sr-only')].map((node) => node.textContent ?? '');
}

beforeAll(() => {
  // Radix's floating tooltip content measures through `ResizeObserver`, which
  // jsdom does not implement. Only the REDUCED branch reaches it.
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
});

beforeEach(() => {
  setMotionPref('full');
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  usePresenceStore.getState().clearAll();
  useAuthStore.setState({ accessToken: 'token', refreshToken: null, user: ME });
});

afterEach(() => {
  cleanup();
  usePresenceStore.getState().clearAll();
  setMotionPref('full');
  delete document.documentElement.dataset.motion;
});

describe('PresenceAvatars — the row', () => {
  it('renders nothing at all when nobody else is here', () => {
    renderRow([]);
    expect(screen.queryByTestId('presence-avatars')).toBeNull();
  });

  it('keeps its testid and its group label after the tooltip swap', () => {
    renderRow([person('u1', 'Ada Lovelace'), person('u2', 'Grace Hopper')]);

    const group = screen.getByTestId('presence-avatars');
    expect(group).toHaveAttribute('role', 'group');
    // The row still names itself with the whole roster — the animated tooltip
    // adds per-face names, it does not replace the group's own label.
    expect(group).toHaveAccessibleName('Ada Lovelace, Grace Hopper');
  });

  it('gives every visible face an animated tooltip carrying the name', () => {
    renderRow([person('u1', 'Ada Lovelace'), person('u2', 'Grace Hopper')]);

    expect(srLabels()).toEqual(['Ada Lovelace', 'Grace Hopper']);
  });

  it('caps the faces at five and gives the +n overflow its own tooltip', () => {
    renderRow(crowd());

    expect(screen.getByText('+1')).toBeInTheDocument();
    // Five names, then the overflow tooltip listing whoever did not fit.
    expect(srLabels()).toEqual([
      'Ada Lovelace',
      'Grace Hopper',
      'Alan Turing',
      'Katherine Johnson',
      'Barbara Liskov',
      'Margaret Hamilton',
    ]);
  });
});

describe('PresenceAvatars — the task key survives the string label', () => {
  it('appends the key of the task someone has open', () => {
    seedTaskKey('FLOW-12');
    renderRow([person('u1', 'Ada Lovelace', TASK)]);

    // The old tooltip said this in two nodes; the animated one says it in one
    // string. Both pieces of information have to still be there.
    expect(srLabels()).toEqual(['Ada Lovelace · FLOW-12']);
  });

  it('shows the name alone when the task is not in this tab’s cache', () => {
    // `taskKeyOf` reads the query cache without subscribing — a cache miss is
    // the normal case for someone reading a card you have never opened.
    renderRow([person('u1', 'Ada Lovelace', TASK)]);

    expect(srLabels()).toEqual(['Ada Lovelace']);
  });

  it('shows the name alone when the person is on a project-level view', () => {
    seedTaskKey('FLOW-12');
    renderRow([person('u1', 'Ada Lovelace', null)]);

    expect(srLabels()).toEqual(['Ada Lovelace']);
  });

  it('marks the avatar of someone reading a task with the presence dot', () => {
    renderRow([person('u1', 'Ada Lovelace', TASK), person('u2', 'Grace Hopper', null)]);

    // The dot is the wordless half of the message and predates this work
    // package — the tooltip swap must not have dropped it.
    expect(document.querySelectorAll('[data-slot="avatar-badge"]')).toHaveLength(1);
  });
});

describe('PresenceAvatars — reduced motion', () => {
  beforeEach(() => {
    setMotionPref('reduced');
  });

  it('falls back to the plain tooltip primitive for every face', () => {
    renderRow([person('u1', 'Ada Lovelace'), person('u2', 'Grace Hopper')]);

    expect(document.querySelectorAll('[data-slot="tooltip-trigger"]')).toHaveLength(2);
    // No sr-only duplication in this branch: Radix's content is the accessible
    // description, and announcing the name twice would be worse than once.
    expect(srLabels()).toEqual([]);
  });

  it('still says the name AND the key when a face is opened', async () => {
    seedTaskKey('FLOW-12');
    renderRow([person('u1', 'Ada Lovelace', TASK)]);

    fireEvent.focus(document.querySelector('[data-slot="tooltip-trigger"]') as HTMLElement);

    const content = await screen.findAllByTestId('animated-tooltip');
    expect(content[0]).toHaveTextContent('Ada Lovelace · FLOW-12');
  });

  it('swaps the whole row live when the preference changes', () => {
    setMotionPref('full');
    renderRow([person('u1', 'Ada Lovelace')]);
    expect(srLabels()).toEqual(['Ada Lovelace']);

    act(() => {
      setMotionPref('reduced');
    });

    expect(srLabels()).toEqual([]);
    expect(document.querySelectorAll('[data-slot="tooltip-trigger"]')).toHaveLength(1);
  });
});
