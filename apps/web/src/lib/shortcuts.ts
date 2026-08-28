/**
 * The central keyboard-shortcut registry — the single source of truth for
 * every global chord in the app.
 *
 * Why a registry instead of scattered `keydown` listeners: two Wave-4 packages
 * (diagnostics drawer: mod+j / mod+shift+j; command palette: mod+k, '?')
 * register chords in parallel, the cheat sheet must be able to LIST every
 * live chord truthfully, and collisions should be loud. It was written ahead of
 * the wave and frozen for its duration; WP4.7 (integration) owns it now, and
 * this header is kept TRUE rather than aspirational — see the dispatch rules on
 * {@link installGlobalShortcutListener}, which are implemented, not promised.
 *
 * Chord grammar: lowercase, '+'-joined — `mod+k`, `mod+shift+j`, `shift+?`,
 * `c`. `mod` = Ctrl on Windows/Linux, Cmd on macOS. Single printable keys
 * (`c`, `?`) never fire while typing and never fire inside a modal surface;
 * chords with `mod` may opt in via `allowInInputs`.
 *
 * Registration is effect-shaped: `registerShortcut()` returns its own
 * unregister, and re-registering the same `id` replaces the old entry
 * (StrictMode-safe). `installGlobalShortcutListener()` is mounted ONCE (in
 * `AppProviders`); `useShortcuts()` gives the cheat sheet a live, ordered
 * snapshot via `useSyncExternalStore`.
 */
import { useSyncExternalStore } from 'react';

export type ShortcutGroup = 'navigation' | 'tasks' | 'system';

export interface ShortcutDef {
  /** Stable unique id, e.g. `palette.open`. Re-registering replaces. */
  id: string;
  /** Chord in the grammar above, e.g. `mod+k`, `shift+?`, `c`. */
  chord: string;
  /** i18n key describing the action, resolved by the cheat sheet at render. */
  descriptionKey: string;
  /** Cheat-sheet grouping. */
  group: ShortcutGroup;
  /** Fire even when focus is in an input/textarea/contenteditable. Default false. */
  allowInInputs?: boolean;
  /** Extra gate evaluated at keydown (e.g. admin-only). Default: always on. */
  enabled?: () => boolean;
  handler: (event: KeyboardEvent) => void;
}

const registry = new Map<string, ShortcutDef>();
const listeners = new Set<() => void>();
let snapshot: readonly ShortcutDef[] = [];

function notify(): void {
  snapshot = [...registry.values()];
  for (const listener of listeners) listener();
}

/** Register a chord. Returns the unregister function; replaces on same id. */
export function registerShortcut(def: ShortcutDef): () => void {
  registry.set(def.id, def);
  notify();
  return () => {
    // Only remove if this exact registration is still the live one.
    if (registry.get(def.id) === def) {
      registry.delete(def.id);
      notify();
    }
  };
}

/** Live, insertion-ordered list for the cheat sheet. */
export function useShortcuts(): readonly ShortcutDef[] {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => snapshot,
  );
}

/** True when the event target is a place where the user is typing. */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

/**
 * Is Shift a MODIFIER for this chord key, or part of TYPING it?
 *
 * This is the whole subtlety of chord matching, and getting it wrong in either
 * direction is a real bug:
 *
 *   - For an alphanumeric key (`j`, `k`, `c`, `7`) Shift is unambiguously a
 *     modifier. `event.key` is already the same character either way (`'J'`
 *     lowercases to `'j'`), so `event.shiftKey` is the ONLY thing separating
 *     Ctrl+J from Ctrl+Shift+J. It is enforced in both directions.
 *   - For a non-alphanumeric single character (`?`, `/`, `+`, `_`) Shift is
 *     part of PRODUCING the glyph, and whether it is needed depends on the
 *     keyboard layout — `?` is Shift+/ on a US layout and an unshifted key on
 *     several others. Enforcing Shift there would make the chord work on some
 *     machines and not others, so it is not enforced at all: the browser has
 *     already told us which character was produced, which is the thing the
 *     chord actually names.
 *   - For a NAMED key (`escape`, `enter`, `arrowup` — length > 1) there is no
 *     glyph to produce, so Shift is a modifier again.
 *
 * The previous rule ("skip the Shift check whenever `event.key` already equals
 * the chord's key") got the `?` case right by accident and the alphanumeric
 * case wrong: it made `mod+shift+j` match a bare Ctrl+J, which WP4.4 had to
 * work around with registration ORDER. That workaround is no longer load-
 * bearing — see `DiagnosticsDrawer.tsx`.
 */
function shiftIsModifierFor(key: string): boolean {
  return key.length !== 1 || /[a-z0-9]/u.test(key);
}

/** Parse + match a chord against a keydown event. */
export function matchChord(event: KeyboardEvent, chord: string): boolean {
  const parts = chord.toLowerCase().split('+');
  const key = parts[parts.length - 1];
  if (key === undefined) return false;

  const wantMod = parts.includes('mod');
  const wantAlt = parts.includes('alt');
  const hasMod = event.ctrlKey || event.metaKey;
  if (wantMod !== hasMod) return false;
  if (wantAlt !== event.altKey) return false;

  if (event.key.toLowerCase() !== key) return false;

  return !shiftIsModifierFor(key) || parts.includes('shift') === event.shiftKey;
}

/**
 * Does this chord consist of a single printable key, with no `mod`/`alt`?
 *
 * Those are the chords that compete with TYPING (and with a modal surface's own
 * key handling), which is why the dispatcher treats them differently. `shift+?`
 * counts: Shift is not a command modifier there, it is how the glyph is typed.
 */
function isBarePrintableChord(chord: string): boolean {
  const parts = chord.toLowerCase().split('+');
  const key = parts[parts.length - 1];
  return key?.length === 1 && !parts.includes('mod') && !parts.includes('alt');
}

/**
 * The content elements `ui/dialog` and `ui/sheet` stamp on their panels.
 *
 * `data-slot` rather than `[role="dialog"]`: Radix puts that role on several
 * things that are NOT modal surfaces (a tooltip's positioner, a dropdown), and
 * this check has to mean "a modal panel owns the screen", not "some floating
 * element exists".
 */
const OVERLAY_CONTENT_SELECTOR = '[data-slot="dialog-content"],[data-slot="sheet-content"]';

/** True when the keydown came from inside an open dialog or sheet panel. */
export function isInsideOverlay(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(OVERLAY_CONTENT_SELECTOR) !== null;
}

/**
 * Install the single global keydown listener. Call ONCE (AppProviders).
 * Returns the uninstaller.
 *
 * DISPATCH RULES, in the order they are applied:
 *
 *  1. An already-handled event (`defaultPrevented`) is left alone.
 *  2. A shortcut whose chord does not match the event is skipped.
 *  3. A shortcut that does not set `allowInInputs` is skipped while focus is in
 *     an input, textarea, select or contenteditable — a `c` must be able to
 *     reach the field someone is typing in.
 *  4. A BARE PRINTABLE chord (`c`, `shift+?` — no `mod`, no `alt`) is skipped
 *     while focus is inside an open dialog or sheet, unless it sets
 *     `allowInInputs`. Rule 3 already covers the fields inside that dialog;
 *     this covers the rest of it — Radix moves focus to the panel element
 *     itself when nothing inside autofocuses, and a single letter typed there
 *     must not fire a global command behind the modal. Chords WITH `mod` are
 *     deliberately exempt: Ctrl+K closing the palette from inside the palette
 *     is the behaviour people expect.
 *  5. The shortcut's own `enabled()` gate.
 *
 * First surviving registration wins; the event is then consumed
 * (`preventDefault` + `stopPropagation`) so nothing downstream sees it twice.
 */
export function installGlobalShortcutListener(): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.defaultPrevented) return;
    const typing = isTypingTarget(event.target);
    const inOverlay = isInsideOverlay(event.target);
    for (const def of registry.values()) {
      if (!matchChord(event, def.chord)) continue;
      if (def.allowInInputs !== true) {
        if (typing) continue;
        if (inOverlay && isBarePrintableChord(def.chord)) continue;
      }
      if (def.enabled !== undefined && !def.enabled()) continue;
      event.preventDefault();
      event.stopPropagation();
      def.handler(event);
      return;
    }
  };
  window.addEventListener('keydown', onKeyDown);
  return () => window.removeEventListener('keydown', onKeyDown);
}

/** Test seam: wipe the registry between suites. */
export function clearShortcutsForTest(): void {
  registry.clear();
  notify();
}
