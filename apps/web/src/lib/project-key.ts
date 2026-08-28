/**
 * Suggesting a project KEY from a project name — the `FLOW` in `FLOW-123`.
 *
 * A key is typed once and read forever: it prefixes every task id anyone
 * pastes into a commit message, a chat, or a browser bar. Making someone invent
 * one from scratch produces `PROJECT1`; suggesting one from the name they just
 * typed produces `PAY` for "Payments platform", which is what they wanted.
 *
 * THE RULES the suggestion has to satisfy (`projectKeySchema`): uppercase,
 * first character a LETTER, 2–10 characters, letters and digits only. Anything
 * this function returns is valid input for that schema — or it returns `''`,
 * meaning "I have nothing useful; leave the field alone".
 */

/** Matches everything a key may not contain. */
const NON_KEY_CHARS = /[^A-Z0-9]/g;

const MIN_KEY = 2;
const MAX_KEY = 10;

/**
 * Derives a key suggestion from a project name.
 *
 * THE STRATEGY, in order:
 *   1. **Several words → their initials.** "Payments Platform Core" → `PPC`.
 *      This is what a human does, and it stays short.
 *   2. **Initials too short (one word, or one usable word) → the word's first
 *      characters.** "Payments" → `PAYM`. Four rather than the full ten,
 *      because a key is read constantly and a long one stops being a
 *      shorthand.
 *   3. **Nothing usable → `''`.** An Arabic or emoji-only name has no Latin
 *      characters to draw on, and inventing `AA` would be worse than an empty
 *      field the user fills in themselves.
 *
 * Digits are kept but can never LEAD, since the schema requires a letter
 * first — a leading digit is dropped rather than the whole suggestion.
 *
 * @example
 *   suggestProjectKey('Payments Platform');  // 'PP'
 *   suggestProjectKey('Payments');           // 'PAYM'
 *   suggestProjectKey('2024 Roadmap');       // 'R'  → padded from the word → 'ROAD'
 *   suggestProjectKey('لوحة');               // ''
 */
export function suggestProjectKey(name: string): string {
  const words = name
    .toUpperCase()
    .split(/\s+/)
    .map((word) => word.replace(NON_KEY_CHARS, ''))
    .filter((word) => word.length > 0);

  if (words.length === 0) return '';

  // 1 — initials, but only from words that START with a letter: a leading digit
  // cannot open a key, and "2024 Roadmap" should suggest R-something, not 2R.
  const initials = words
    .map((word) => word[0] ?? '')
    .filter((letter) => /[A-Z]/.test(letter))
    .join('');

  if (initials.length >= MIN_KEY) return initials.slice(0, MAX_KEY);

  // 2 — fall back to the first word that begins with a letter.
  const firstWord = words.find((word) => /^[A-Z]/.test(word));
  if (!firstWord) return '';

  const fromWord = firstWord.slice(0, 4);
  return fromWord.length >= MIN_KEY ? fromWord : '';
}

/**
 * Normalizes what a user typed INTO the key field as they type.
 *
 * Uppercases, drops anything illegal, strips leading digits, and caps the
 * length — so the field cannot hold a value the schema will reject, and the
 * user never sees an error for a character the input silently could have
 * refused.
 */
export function normalizeProjectKey(input: string): string {
  return input
    .toUpperCase()
    .replace(NON_KEY_CHARS, '')
    .replace(/^[0-9]+/, '')
    .slice(0, MAX_KEY);
}
