// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import { clearShortcutsForTest, registerShortcut, type ShortcutDef } from '@/lib/shortcuts';
// Side-effect import: brings the default i18next instance up with the English
// catalog, so `t()` resolves real copy instead of echoing keys.
import '@/i18n';
import {
  CONTEXTUAL,
  groupShortcuts,
  ShortcutsList,
} from '@/components/palette/ShortcutsCheatSheet';

/**
 * The cheat sheet's promise is that it cannot lie: it renders the REGISTRY, so
 * an unregistered chord cannot appear and a registered one cannot be forgotten.
 * These tests register fixtures and read the dialog body back.
 */

function fixture(overrides: Partial<ShortcutDef> = {}): ShortcutDef {
  return {
    id: 'fixture.one',
    chord: 'mod+k',
    descriptionKey: 'palette:shortcuts.openPalette',
    group: 'navigation',
    handler: vi.fn(),
    ...overrides,
  };
}

beforeEach(clearShortcutsForTest);
afterEach(() => {
  cleanup();
  clearShortcutsForTest();
});

/** The four always-on sections below the fence. */
const CONTEXTUAL_TITLES = ['Board', 'Table', 'Roadmap', 'Panels'];

/** The registered half, without the always-on contextual sections below it. */
function globalSections(): HTMLElement[] {
  const list = screen.getByTestId('shortcuts-list');
  const contextual = new Set(CONTEXTUAL_TITLES);
  return within(list)
    .getAllByRole('heading', { level: 3 })
    .filter((heading) => !contextual.has(heading.textContent ?? ''))
    .map((heading) => heading.parentElement as HTMLElement);
}

describe('groupShortcuts', () => {
  it('buckets by group, in navigation → tasks → system order', () => {
    const grouped = groupShortcuts([
      fixture({ id: 'a', group: 'system' }),
      fixture({ id: 'b', group: 'tasks' }),
      fixture({ id: 'c', group: 'navigation' }),
    ]);
    expect(grouped.map((bucket) => bucket.group)).toEqual(['navigation', 'tasks', 'system']);
  });

  it('drops a group nobody registered into, rather than rendering an empty one', () => {
    const grouped = groupShortcuts([fixture({ group: 'navigation' })]);
    expect(grouped.map((bucket) => bucket.group)).toEqual(['navigation']);
  });

  it('keeps registration order inside a bucket', () => {
    const grouped = groupShortcuts([
      fixture({ id: 'first', group: 'tasks' }),
      fixture({ id: 'second', group: 'tasks' }),
    ]);
    expect(grouped[0]?.defs.map((def) => def.id)).toEqual(['first', 'second']);
  });
});

describe('ShortcutsList', () => {
  it('lists a registered chord, with its caps and its own description', () => {
    registerShortcut(fixture());
    render(<ShortcutsList apple={false} />);

    expect(screen.getByText('Open the command palette')).toBeInTheDocument();
    expect(screen.getByText('Ctrl')).toBeInTheDocument();
    expect(screen.getByText('K')).toBeInTheDocument();
  });

  it('shows NOTHING for a chord nobody registered', () => {
    registerShortcut(fixture());
    render(<ShortcutsList apple={false} />);

    // `c` is a real chord of this package — but not in this registry.
    expect(screen.queryByText('Create a task in this project')).not.toBeInTheDocument();
  });

  it('picks up a chord registered AFTER it rendered', () => {
    render(<ShortcutsList apple={false} />);
    expect(screen.queryByText('Show this list')).not.toBeInTheDocument();

    act(() => {
      registerShortcut(
        fixture({ id: 'late', chord: 'shift+?', descriptionKey: 'palette:shortcuts.cheatSheet' }),
      );
    });

    expect(screen.getByText('Show this list')).toBeInTheDocument();
  });

  it('reads a description out of ANOTHER package’s namespace', () => {
    // The chord's owner owns its words — the sheet only resolves the key.
    registerShortcut(fixture({ id: 'foreign', descriptionKey: 'common:actions.close' }));
    render(<ShortcutsList apple={false} />);
    expect(screen.getByText('Close')).toBeInTheDocument();
  });

  it('renders the platform modifier: Ctrl on a PC, ⌘ on a Mac', () => {
    registerShortcut(fixture());
    const { unmount } = render(<ShortcutsList apple={false} />);
    expect(screen.getByText('Ctrl')).toBeInTheDocument();
    unmount();

    render(<ShortcutsList apple />);
    expect(screen.getByText('⌘')).toBeInTheDocument();
    expect(screen.queryByText('Ctrl')).not.toBeInTheDocument();
  });

  it('renders `shift+?` as a single `?` cap — Shift is already in the glyph', () => {
    registerShortcut(fixture({ chord: 'shift+?' }));
    render(<ShortcutsList apple={false} />);

    const registered = globalSections()[0];
    expect(registered).toBeDefined();
    expect(within(registered as HTMLElement).getByText('?')).toBeInTheDocument();
    // Scoped to the registered half: the roadmap's Shift+← row below the fence
    // is a different (and correct) use of the cap.
    expect(within(registered as HTMLElement).queryByText('Shift')).not.toBeInTheDocument();
  });

  it('titles each bucket with its localized group name', () => {
    registerShortcut(fixture({ id: 'nav', group: 'navigation' }));
    registerShortcut(fixture({ id: 'task', group: 'tasks' }));
    render(<ShortcutsList apple={false} />);

    const titles = globalSections().map((section) => section.querySelector('h3')?.textContent);
    expect(titles).toEqual(['Anywhere', 'Tasks']);
  });

  it('shows no registered sections at all on an empty registry', () => {
    render(<ShortcutsList apple={false} />);
    expect(globalSections()).toHaveLength(0);
  });
});

describe('the contextual section', () => {
  it('is always there, registry or not — those keys are not chords', () => {
    render(<ShortcutsList apple={false} />);

    expect(screen.getByText('These keys work on whatever has focus.')).toBeInTheDocument();
    for (const title of CONTEXTUAL_TITLES) {
      expect(screen.getByRole('heading', { level: 3, name: title })).toBeInTheDocument();
    }
  });

  it('names the keys the views actually implement', () => {
    render(<ShortcutsList apple={false} />);

    expect(screen.getByText('Pick up the focused card')).toBeInTheDocument();
    expect(screen.getByText('Move between cells')).toBeInTheDocument();
    expect(screen.getByText('Move the focused bar by a day')).toBeInTheDocument();
    expect(screen.getByText('Close the open panel')).toBeInTheDocument();
  });

  it('covers the four surfaces that have their own keys, and no others', () => {
    expect(CONTEXTUAL.map((section) => section.id)).toEqual([
      'board',
      'table',
      'roadmap',
      'anywhere',
    ]);
  });
});
