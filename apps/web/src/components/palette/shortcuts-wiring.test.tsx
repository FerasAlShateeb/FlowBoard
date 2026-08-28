// @vitest-environment jsdom
import { useEffect } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';

import { clearShortcutsForTest, useShortcuts, type ShortcutDef } from '@/lib/shortcuts';
import { usePaletteStore, __resetPaletteStoreForTests } from '@/stores/usePaletteStore';
import GlobalShortcuts from '@/components/palette/GlobalShortcuts';

/**
 * The chords, driven through the REAL registry and the REAL listener.
 *
 * Nothing here stubs `matchChord`: the questions worth asking are exactly the
 * ones about its edges — does `?` need Shift, does `c` survive a text field,
 * does `mod` mean either Ctrl or Cmd — and a mocked matcher would answer them
 * about the mock. `clearShortcutsForTest()` (the registry's own seam) keeps one
 * test's registrations out of the next.
 */

const IN_PROJECT = { orgSlug: 'acme', projectKey: 'FLOW' };
const IN_ORG = { orgSlug: 'acme', projectKey: null };

interface KeyOptions {
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  /** Dispatch from a focused text field instead of the window. */
  fromInput?: boolean;
}

/** Sends one keydown the way a browser would: from a target, bubbling up. */
function press(key: string, options: KeyOptions = {}): void {
  const { fromInput = false, ...modifiers } = options;
  const target = fromInput ? document.createElement('input') : null;
  if (target) document.body.append(target);

  act(() => {
    (target ?? window).dispatchEvent(
      new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...modifiers }),
    );
  });

  target?.remove();
}

/** Renders the registrations. */
function mount(scope: { orgSlug: string | null; projectKey: string | null }, signedIn = true) {
  return render(<GlobalShortcuts scope={scope} signedIn={signedIn} />);
}

/**
 * The registry as the cheat sheet would see it.
 *
 * Read through `useShortcuts()` (its only public accessor) from a throwaway
 * component, so the assertion is about what the sheet renders rather than about
 * a private Map. Mounted and unmounted per call — a probe that lived alongside
 * the component under test could not observe the registry AFTER that component
 * unmounted, which is precisely one of the things worth asserting.
 */
function readRegistry(): readonly ShortcutDef[] {
  let seen: readonly ShortcutDef[] = [];

  function Probe() {
    const shortcuts = useShortcuts();
    useEffect(() => {
      seen = shortcuts;
    }, [shortcuts]);
    return null;
  }

  const view = render(<Probe />);
  view.unmount();
  return seen;
}

beforeEach(() => {
  __resetPaletteStoreForTests();
  clearShortcutsForTest();
});

afterEach(() => {
  cleanup();
  clearShortcutsForTest();
  __resetPaletteStoreForTests();
});

describe('the registry after mounting', () => {
  it('registers exactly the three chords this package owns, with their groups', () => {
    mount(IN_PROJECT);

    expect(
      readRegistry().map((def) => ({ id: def.id, chord: def.chord, group: def.group })),
    ).toEqual([
      { id: 'palette.open', chord: 'mod+k', group: 'navigation' },
      { id: 'palette.shortcuts', chord: 'shift+?', group: 'system' },
      { id: 'palette.createTask', chord: 'c', group: 'tasks' },
    ]);
  });

  it('claims no chord in WP4.4 diagnostics territory', () => {
    // `mod+j` / `mod+shift+j` belong to the diagnostics drawer, and the
    // registry dispatches to the FIRST matching entry — so a collision here
    // would silently shadow another package's shortcut.
    mount(IN_PROJECT);
    const chords = readRegistry().map((def) => def.chord);
    expect(chords).not.toContain('mod+j');
    expect(chords).not.toContain('mod+shift+j');
  });

  it('gives every chord a description key, so the cheat sheet can name it', () => {
    mount(IN_PROJECT);
    for (const def of readRegistry()) expect(def.descriptionKey.startsWith('palette:')).toBe(true);
  });

  it('unregisters everything on unmount', () => {
    const { unmount } = mount(IN_PROJECT);
    expect(readRegistry()).toHaveLength(3);
    unmount();
    expect(readRegistry()).toHaveLength(0);
  });
});

describe('mod+k', () => {
  it('opens the palette on Ctrl+K', () => {
    mount(IN_PROJECT);
    press('k', { ctrlKey: true });
    expect(usePaletteStore.getState().open).toBe(true);
  });

  it('opens it on Cmd+K too — `mod` is either', () => {
    mount(IN_PROJECT);
    press('k', { metaKey: true });
    expect(usePaletteStore.getState().open).toBe(true);
  });

  it('toggles: a second press closes it', () => {
    mount(IN_PROJECT);
    press('k', { ctrlKey: true });
    press('k', { ctrlKey: true });
    expect(usePaletteStore.getState().open).toBe(false);
  });

  it('fires from inside a text field — `allowInInputs`', () => {
    mount(IN_PROJECT);
    press('k', { ctrlKey: true, fromInput: true });
    expect(usePaletteStore.getState().open).toBe(true);
  });

  it('does nothing without the modifier', () => {
    mount(IN_PROJECT);
    press('k');
    expect(usePaletteStore.getState().open).toBe(false);
  });

  it('does nothing signed out', () => {
    mount(IN_PROJECT, false);
    press('k', { ctrlKey: true });
    expect(usePaletteStore.getState().open).toBe(false);
  });
});

describe('the `?` cheat sheet', () => {
  it('opens on Shift+? — the layout that needs Shift to type it', () => {
    mount(IN_PROJECT);
    press('?', { shiftKey: true });
    expect(usePaletteStore.getState().cheatSheetOpen).toBe(true);
  });

  it('opens on a bare `?` — the layout that does not', () => {
    /*
     * NOT A QUIRK ANY MORE — A RULE, and this is the case it exists for.
     *
     * `matchChord` does not enforce Shift for a chord whose key is a
     * NON-ALPHANUMERIC character, because Shift is part of typing that glyph
     * rather than a command modifier: `?` is Shift+/ on a US layout and an
     * unshifted key on several others, and one chord string has to serve all of
     * them.
     *
     * WP4.6 recorded this as a quirk because the old implementation reached the
     * same answer for the wrong reason — it skipped the Shift check whenever
     * `event.key` matched the chord's key, which is ALWAYS true for a letter,
     * so `mod+shift+j` also matched a bare Ctrl+J and WP4.4 had to work around
     * it with registration order. WP4.7 narrowed the exemption to the keys that
     * actually need it; `lib/shortcuts.test.ts` pins both halves of the rule.
     */
    mount(IN_PROJECT);
    press('?');
    expect(usePaletteStore.getState().cheatSheetOpen).toBe(true);
  });

  it('does NOT open while the user is typing a question mark', () => {
    mount(IN_PROJECT);
    press('?', { shiftKey: true, fromInput: true });
    expect(usePaletteStore.getState().cheatSheetOpen).toBe(false);
  });

  it('does NOT stack on top of the open palette', () => {
    mount(IN_PROJECT);
    act(() => {
      usePaletteStore.getState().openPalette();
    });
    press('?');
    expect(usePaletteStore.getState().cheatSheetOpen).toBe(false);
  });

  it('is not a Ctrl chord — Ctrl+? belongs to the browser', () => {
    mount(IN_PROJECT);
    press('?', { ctrlKey: true });
    expect(usePaletteStore.getState().cheatSheetOpen).toBe(false);
  });
});

describe('`c` — create task', () => {
  it('opens the create dialog inside a project', () => {
    mount(IN_PROJECT);
    press('c');
    expect(usePaletteStore.getState().createTaskOpen).toBe(true);
  });

  it('does nothing outside a project', () => {
    mount(IN_ORG);
    press('c');
    expect(usePaletteStore.getState().createTaskOpen).toBe(false);
  });

  it('is suppressed while typing — a `c` must reach the field', () => {
    mount(IN_PROJECT);
    press('c', { fromInput: true });
    expect(usePaletteStore.getState().createTaskOpen).toBe(false);
  });

  it('does not fire as Shift+C', () => {
    // `matchChord` rejects a shifted alphanumeric for an unshifted chord, so
    // typing a capital C somewhere unfocused is not a command.
    mount(IN_PROJECT);
    press('c', { shiftKey: true });
    expect(usePaletteStore.getState().createTaskOpen).toBe(false);
  });

  it('does not fire as Ctrl+C — the copy shortcut is untouched', () => {
    mount(IN_PROJECT);
    press('c', { ctrlKey: true });
    expect(usePaletteStore.getState().createTaskOpen).toBe(false);
  });

  it('does not stack on an overlay that is already open', () => {
    mount(IN_PROJECT);
    act(() => {
      usePaletteStore.getState().setCheatSheetOpen(true);
    });
    press('c');
    expect(usePaletteStore.getState().createTaskOpen).toBe(false);
  });

  it('follows the URL: a scope change re-gates it without re-registering', () => {
    const { rerender } = mount(IN_ORG);
    const before = readRegistry();

    rerender(<GlobalShortcuts scope={IN_PROJECT} signedIn />);
    press('c');

    expect(usePaletteStore.getState().createTaskOpen).toBe(true);
    // The SAME snapshot array, not a rebuilt one: the registry never churned,
    // so the cheat sheet does not re-render on every navigation.
    expect(readRegistry()).toBe(before);
  });
});
