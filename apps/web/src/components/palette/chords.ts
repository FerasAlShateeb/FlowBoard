/**
 * Chord → key caps.
 *
 * `lib/shortcuts.ts` stores a chord as machine text (`mod+shift+j`), because
 * that is what `matchChord` can compare against a `KeyboardEvent`. The cheat
 * sheet has to show what is PRINTED ON THE KEYS, which is a different string on
 * a Mac than on a PC and a different string again for a key with a glyph. This
 * module is that translation, and it is pure so both halves are testable
 * without a keyboard or a user agent.
 *
 * ═══ WHY `shift` SOMETIMES DISAPPEARS ══════════════════════════════════════
 *
 * The cheat sheet's chord for the cheat sheet is `shift+?`. Rendering that as
 * `Shift + ?` would be a lie in two directions at once: on a US layout `?` IS
 * Shift+/ so the cap says `?` and Shift is implied, and on a layout where `?`
 * is unshifted, holding Shift would produce something else entirely. So a
 * `shift` part is dropped when the final key is a single NON-alphanumeric
 * character — it is already the shifted glyph. `mod+shift+j` keeps its Shift,
 * because `j` is not.
 *
 * ═══ RTL ═══════════════════════════════════════════════════════════════════
 *
 * The caps come back in LOGICAL order (modifier first, key last) and the row
 * that renders them is an ordinary flex row with no `ltr:`/`rtl:` variants — so
 * an Arabic session reads Ctrl → K from right to left, which is the direction
 * everything else on that screen reads. The cap TEXT stays Latin: `Ctrl` and
 * `Esc` are what the hardware says, not prose.
 */

/** Modifier and named-key caps, keyed by the chord grammar's own words. */
const NAMED_KEYS: Record<string, string> = {
  escape: 'Esc',
  esc: 'Esc',
  enter: '↵',
  space: 'Space',
  tab: 'Tab',
  backspace: '⌫',
  delete: 'Del',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  pageup: 'PgUp',
  pagedown: 'PgDn',
  home: 'Home',
  end: 'End',
};

/**
 * Is this an Apple keyboard? Read from a user-agent string rather than
 * `navigator` so a test can assert both platforms in one process.
 *
 * `navigator.platform` is the more direct answer and is also deprecated; the
 * substrings below cover macOS, iPadOS (which reports as a Mac) and iOS.
 */
export function isApplePlatform(userAgent: string): boolean {
  return /mac|iphone|ipad|ipod/iu.test(userAgent);
}

/** The live platform, defaulting to non-Apple where there is no navigator. */
export function currentPlatformIsApple(): boolean {
  if (typeof navigator === 'undefined') return false;
  return isApplePlatform(navigator.userAgent);
}

/** True for a key whose glyph already implies Shift (`?`, `/`, `+`). */
function isShiftedGlyph(key: string): boolean {
  return key.length === 1 && !/[a-z0-9]/u.test(key);
}

/**
 * The caps for one chord, in display order: mod, alt, shift, key.
 *
 * The chord grammar is order-insensitive (`matchChord` tests membership), so
 * the parts are re-ordered here into the sequence every keyboard reference
 * uses. An unknown part is passed through capitalized rather than dropped: a
 * chord this function does not understand should still be readable.
 */
export function chordKeys(chord: string, apple: boolean): string[] {
  const parts = chord.toLowerCase().split('+');
  const key = parts[parts.length - 1] ?? '';
  const modifiers = parts.slice(0, -1);

  const caps: string[] = [];
  if (modifiers.includes('mod')) caps.push(apple ? '⌘' : 'Ctrl');
  if (modifiers.includes('alt')) caps.push(apple ? '⌥' : 'Alt');
  if (modifiers.includes('shift') && !isShiftedGlyph(key)) caps.push(apple ? '⇧' : 'Shift');

  const named = NAMED_KEYS[key];
  if (named !== undefined) caps.push(named);
  else if (key.length === 1) caps.push(key.toUpperCase());
  else caps.push(key.charAt(0).toUpperCase() + key.slice(1));

  return caps;
}
