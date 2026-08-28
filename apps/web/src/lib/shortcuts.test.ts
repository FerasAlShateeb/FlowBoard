// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  clearShortcutsForTest,
  installGlobalShortcutListener,
  isInsideOverlay,
  isTypingTarget,
  matchChord,
  registerShortcut,
} from '@/lib/shortcuts';

/**
 * The chord matcher and the dispatcher, tested directly.
 *
 * WHY THIS SUITE EXISTS. Until WP4.7 `matchChord` had no unit tests at all — it
 * was exercised only through two feature suites that each asserted the one
 * behaviour they happened to need, and between them they papered over a real
 * bug: `mod+shift+j` matched a bare Ctrl+J, which the diagnostics drawer had to
 * work around with registration ORDER. The edges below are the whole reason the
 * function is hard, so they are asserted here, once, rather than re-derived in
 * every consumer.
 *
 * THE RULE, stated once: for an ALPHANUMERIC key Shift is a modifier and is
 * enforced in both directions; for a non-alphanumeric single character Shift is
 * part of typing the glyph and is not enforced at all, because whether it is
 * needed depends on the keyboard layout.
 */

function keydown(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
  return new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
}

describe('matchChord — modifiers', () => {
  it('treats `mod` as either Ctrl or Cmd', () => {
    expect(matchChord(keydown('k', { ctrlKey: true }), 'mod+k')).toBe(true);
    expect(matchChord(keydown('k', { metaKey: true }), 'mod+k')).toBe(true);
  });

  it('requires the modifier the chord names, and refuses the ones it does not', () => {
    expect(matchChord(keydown('k'), 'mod+k')).toBe(false);
    expect(matchChord(keydown('k', { ctrlKey: true }), 'k')).toBe(false);
    expect(matchChord(keydown('k', { ctrlKey: true, altKey: true }), 'mod+k')).toBe(false);
  });

  it('is case-insensitive about the key the browser reports', () => {
    // A shifted letter arrives as `'J'`; the chord grammar is lowercase.
    expect(matchChord(keydown('J', { ctrlKey: true, shiftKey: true }), 'mod+shift+j')).toBe(true);
  });
});

describe('matchChord — Shift on an alphanumeric key is a modifier', () => {
  /**
   * THE BUG THIS SUITE WAS WRITTEN FOR. The old rule skipped the Shift check
   * whenever `event.key` already equalled the chord's key, which is always true
   * for a letter — so the dock-cycle chord matched the plain toggle's keystroke,
   * and only registration order kept the drawer working.
   */
  it('does not match a bare Ctrl+J against `mod+shift+j`', () => {
    expect(matchChord(keydown('j', { ctrlKey: true }), 'mod+shift+j')).toBe(false);
  });

  it('does match Ctrl+Shift+J against `mod+shift+j`', () => {
    expect(matchChord(keydown('j', { ctrlKey: true, shiftKey: true }), 'mod+shift+j')).toBe(true);
  });

  it('rejects a shifted keystroke for an unshifted chord, in both shapes', () => {
    expect(matchChord(keydown('j', { ctrlKey: true, shiftKey: true }), 'mod+j')).toBe(false);
    expect(matchChord(keydown('c', { shiftKey: true }), 'c')).toBe(false);
  });

  it('applies the same rule to digits', () => {
    expect(matchChord(keydown('1', { shiftKey: true }), '1')).toBe(false);
    expect(matchChord(keydown('1', { shiftKey: true }), 'shift+1')).toBe(true);
  });

  it('treats a NAMED key as alphanumeric-like — there is no glyph to produce', () => {
    expect(matchChord(keydown('Escape', { shiftKey: true }), 'escape')).toBe(false);
    expect(matchChord(keydown('Escape'), 'escape')).toBe(true);
  });
});

describe('matchChord — Shift on a punctuation key is how it is typed', () => {
  /**
   * `?` is Shift+/ on a US layout and an unshifted key on several others. One
   * chord string has to serve both, so Shift is not enforced for a
   * non-alphanumeric character — in EITHER direction.
   */
  it('matches `shift+?` whether or not Shift was held', () => {
    expect(matchChord(keydown('?', { shiftKey: true }), 'shift+?')).toBe(true);
    expect(matchChord(keydown('?'), 'shift+?')).toBe(true);
  });

  it('matches a bare `?` chord from a shifted keystroke too', () => {
    expect(matchChord(keydown('?', { shiftKey: true }), '?')).toBe(true);
  });

  it('still enforces the command modifiers on a punctuation chord', () => {
    expect(matchChord(keydown('?', { ctrlKey: true }), 'shift+?')).toBe(false);
  });
});

describe('isTypingTarget', () => {
  it.each(['INPUT', 'TEXTAREA', 'SELECT'])('is true for a <%s>', (tag) => {
    expect(isTypingTarget(document.createElement(tag))).toBe(true);
  });

  it('is true for a contenteditable, and false for anything else', () => {
    const editable = document.createElement('div');
    editable.contentEditable = 'true';
    // jsdom does not implement the `isContentEditable` reflection.
    Object.defineProperty(editable, 'isContentEditable', { value: true });

    expect(isTypingTarget(editable)).toBe(true);
    expect(isTypingTarget(document.createElement('div'))).toBe(false);
    expect(isTypingTarget(null)).toBe(false);
  });
});

describe('isInsideOverlay', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('is true for an element inside a dialog or sheet panel', () => {
    document.body.innerHTML = `
      <div data-slot="dialog-content"><button id="in-dialog"></button></div>
      <div data-slot="sheet-content"><button id="in-sheet"></button></div>
      <button id="outside"></button>`;

    expect(isInsideOverlay(document.querySelector('#in-dialog'))).toBe(true);
    expect(isInsideOverlay(document.querySelector('#in-sheet'))).toBe(true);
    expect(isInsideOverlay(document.querySelector('#outside'))).toBe(false);
  });

  /**
   * `data-slot` rather than `[role="dialog"]`: Radix puts that role on things
   * that are not modal surfaces, and this check has to mean "a modal panel owns
   * the screen", not "some floating element exists".
   */
  it('ignores a non-modal floating element that merely has the dialog role', () => {
    document.body.innerHTML = `<div role="dialog"><button id="tooltip"></button></div>`;

    expect(isInsideOverlay(document.querySelector('#tooltip'))).toBe(false);
  });
});

describe('installGlobalShortcutListener — dispatch rules', () => {
  let uninstall: () => void;
  let fired: string[];

  /** Registers one chord and reports whether the dispatcher reached it. */
  function register(
    id: string,
    chord: string,
    extra: Partial<Parameters<typeof registerShortcut>[0]> = {},
  ) {
    registerShortcut({
      id,
      chord,
      descriptionKey: 'palette:shortcuts.openPalette',
      group: 'system',
      handler: () => fired.push(id),
      ...extra,
    });
  }

  function press(target: EventTarget, key: string, init: KeyboardEventInit = {}): void {
    target.dispatchEvent(keydown(key, init));
  }

  beforeEach(() => {
    fired = [];
    clearShortcutsForTest();
    uninstall = installGlobalShortcutListener();
  });

  afterEach(() => {
    uninstall();
    clearShortcutsForTest();
    document.body.innerHTML = '';
  });

  it('dispatches a matching chord and consumes the event', () => {
    register('a', 'mod+k', { allowInInputs: true });
    const event = keydown('k', { ctrlKey: true });

    window.dispatchEvent(event);

    expect(fired).toEqual(['a']);
    expect(event.defaultPrevented).toBe(true);
  });

  it('ignores an event another handler already claimed', () => {
    register('a', 'mod+k', { allowInInputs: true });
    const event = keydown('k', { ctrlKey: true });
    event.preventDefault();

    window.dispatchEvent(event);

    expect(fired).toEqual([]);
  });

  it('respects the shortcut’s own `enabled` gate', () => {
    register('a', 'mod+k', { allowInInputs: true, enabled: () => false });

    window.dispatchEvent(keydown('k', { ctrlKey: true }));

    expect(fired).toEqual([]);
  });

  it('skips a typing target unless the shortcut opts in', () => {
    register('bare', 'c');
    register('opted', 'mod+k', { allowInInputs: true });

    const input = document.createElement('input');
    document.body.append(input);

    press(input, 'c');
    press(input, 'k', { ctrlKey: true });

    expect(fired).toEqual(['opted']);
  });

  /**
   * The rule the header used to only PROMISE. Radix moves focus to the panel
   * element itself when nothing inside autofocuses, and a single letter typed
   * there must not fire a global command behind the modal — `isTypingTarget`
   * covers the fields inside the dialog, this covers the rest of it.
   */
  it('suppresses a bare printable chord while focus is inside a dialog', () => {
    register('create', 'c');
    register('sheet', 'shift+?');

    document.body.innerHTML = '<div data-slot="dialog-content"><div id="panel"></div></div>';
    const panel = document.querySelector('#panel');
    if (!panel) throw new Error('fixture is missing');

    press(panel, 'c');
    press(panel, '?', { shiftKey: true });

    expect(fired).toEqual([]);
  });

  /**
   * Chords WITH a modifier are exempt: Ctrl+K closing the palette from inside
   * the palette, and Ctrl+J toggling the log drawer over any surface, are both
   * behaviours people expect.
   */
  it('lets a mod chord through from inside a dialog', () => {
    register('palette', 'mod+k', { allowInInputs: true });
    register('diag', 'mod+j', { allowInInputs: true });

    document.body.innerHTML = '<div data-slot="sheet-content"><div id="panel"></div></div>';
    const panel = document.querySelector('#panel');
    if (!panel) throw new Error('fixture is missing');

    press(panel, 'k', { ctrlKey: true });
    press(panel, 'j', { ctrlKey: true });

    expect(fired).toEqual(['palette', 'diag']);
  });

  /**
   * REGISTRATION ORDER IS NO LONGER LOAD-BEARING for the diagnostics pair —
   * `matchChord` separates them now — but "first match wins" is still the
   * dispatch rule, and a genuine duplicate chord must resolve deterministically
   * rather than firing twice.
   */
  it('dispatches only the first registration of a duplicated chord', () => {
    register('first', 'mod+k', { allowInInputs: true });
    register('second', 'mod+k', { allowInInputs: true });

    window.dispatchEvent(keydown('k', { ctrlKey: true }));

    expect(fired).toEqual(['first']);
  });

  it('separates the diagnostics pair regardless of which is registered first', () => {
    register('cycle', 'mod+shift+j', { allowInInputs: true });
    register('toggle', 'mod+j', { allowInInputs: true });

    window.dispatchEvent(keydown('j', { ctrlKey: true }));
    window.dispatchEvent(keydown('j', { ctrlKey: true, shiftKey: true }));

    expect(fired).toEqual(['toggle', 'cycle']);
  });

  it('stops firing once uninstalled', () => {
    register('a', 'mod+k', { allowInInputs: true });
    uninstall();
    // The `afterEach` uninstall is then a no-op, which is also worth not throwing.
    uninstall = vi.fn();

    window.dispatchEvent(keydown('k', { ctrlKey: true }));

    expect(fired).toEqual([]);
  });
});
