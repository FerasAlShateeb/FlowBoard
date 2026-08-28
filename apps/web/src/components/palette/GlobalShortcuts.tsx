import { useEffect, useRef } from 'react';

import { installGlobalShortcutListener, registerShortcut } from '@/lib/shortcuts';
import type { RouteScope } from '@/hooks/useRouteScope';
import { usePaletteStore } from '@/stores/usePaletteStore';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * The app's global chords: `mod+k`, `?`, `c`.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Renders nothing. It exists to own two effects with different lifetimes and
 * different failure modes, which is exactly the case a component beats a hook
 * call inside something bigger.
 *
 * ═══ THE LISTENER IS INSTALLED ONCE, HERE ══════════════════════════════════
 *
 * `installGlobalShortcutListener()` is documented as mounted once in
 * `AppProviders` — which is where this component is (via `PaletteMount`). It is
 * installed UNCONDITIONALLY, even signed out: WP4.4 registers its diagnostics
 * chords from its own tree, and a listener that came and went with the session
 * would silently break every other package's chords on the login screen. The
 * per-shortcut `enabled` gates below carry the session rule instead.
 *
 * ═══ WHY THE REGISTRATIONS NEVER RE-RUN ════════════════════════════════════
 *
 * `registerShortcut` replaces on the same id and returns its own unregister, so
 * re-registering on every prop change would be CORRECT — and would also churn
 * the registry the cheat sheet subscribes to, re-rendering it on every
 * navigation. The changing inputs go into refs instead and the `enabled`/
 * `handler` closures read them at KEYDOWN TIME, which is the only moment their
 * value matters. The effect then genuinely runs once.
 */

export interface GlobalShortcutsProps {
  /** Where the user is. Read at keydown time — see the header. */
  scope: RouteScope;
  /** No session, no app chords: there is nothing behind them yet. */
  signedIn: boolean;
}

/**
 * Is a modal surface already up?
 *
 * Two sources, because neither is complete alone: the palette's own store
 * covers the three surfaces this package owns, and the DOM query covers every
 * OTHER dialog and sheet in the app (the task sheet, a confirm, a form) —
 * surfaces this package cannot import without depending on all of them.
 *
 * `data-slot` is what `ui/dialog` and `ui/sheet` stamp on their content
 * elements, and Radix removes the element when the overlay closes, so the query
 * cannot go stale.
 */
export function overlayIsOpen(): boolean {
  if (usePaletteStore.getState().anyOpen()) return true;
  if (typeof document === 'undefined') return false;
  return (
    document.querySelector('[data-slot="dialog-content"],[data-slot="sheet-content"]') !== null
  );
}

export default function GlobalShortcuts({ scope, signedIn }: GlobalShortcutsProps) {
  const scopeRef = useRef(scope);
  const signedInRef = useRef(signedIn);

  useEffect(() => {
    scopeRef.current = scope;
  }, [scope]);

  useEffect(() => {
    signedInRef.current = signedIn;
  }, [signedIn]);

  // The single global keydown listener. Its own uninstaller is the cleanup.
  useEffect(() => installGlobalShortcutListener(), []);

  useEffect(() => {
    const unregister = [
      registerShortcut({
        id: 'palette.open',
        chord: 'mod+k',
        descriptionKey: 'palette:shortcuts.openPalette',
        group: 'navigation',
        // Ctrl+K is expected to work FROM a text field — a user half-way
        // through typing a comment is exactly who wants to jump somewhere. It
        // is also how the palette closes itself while its own input has focus.
        allowInInputs: true,
        enabled: () => signedInRef.current,
        handler: () => {
          usePaletteStore.getState().togglePalette();
        },
      }),

      registerShortcut({
        id: 'palette.shortcuts',
        // `shift+?` rather than `?`: the grammar names the modifier, and
        // `matchChord` deliberately does NOT re-require Shift when the key is
        // already the shifted glyph — so this matches a `?` from any layout,
        // shifted or not. (Asserted in `shortcuts-wiring.test.tsx`.)
        chord: 'shift+?',
        descriptionKey: 'palette:shortcuts.cheatSheet',
        group: 'system',
        // A literal `?` must reach the field someone is typing into.
        enabled: () => signedInRef.current && !overlayIsOpen(),
        handler: () => {
          usePaletteStore.getState().setCheatSheetOpen(true);
        },
      }),

      registerShortcut({
        id: 'palette.createTask',
        chord: 'c',
        descriptionKey: 'palette:shortcuts.createTask',
        group: 'tasks',
        // Three gates: a session, somewhere to put the task, and no overlay
        // already owning the screen. (Typing is handled by the listener
        // itself — a single printable key never fires in an input.)
        enabled: () =>
          signedInRef.current && scopeRef.current.projectKey !== null && !overlayIsOpen(),
        handler: () => {
          usePaletteStore.getState().setCreateTaskOpen(true);
        },
      }),
    ];

    return () => {
      for (const off of unregister) off();
    };
  }, []);

  return null;
}
