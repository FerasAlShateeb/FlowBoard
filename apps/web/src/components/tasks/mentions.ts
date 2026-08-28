import { MENTION_PATTERN } from '@flowboard/shared';

/**
 * The @mention encoding, on the CLIENT side — everything the composer and the
 * renderer need, as pure functions with no React and no DOM.
 *
 * THE WIRE FORMAT IS `@[Display Name](userId)` and it belongs to
 * `@flowboard/shared` (`MENTION_PATTERN`, `extractMentionUserIds`), because the
 * SERVER parses the same string to decide who gets notified. Nothing here
 * redefines it; this module only writes it and reads it back.
 *
 * ── Why the renderer needs a transform at all ───────────────────────────────
 *
 * `@[Ada](uuid)` is, to a markdown parser, a literal `@` followed by an ordinary
 * link whose text is `Ada` and whose href is a bare uuid. So a naive render puts
 * a dead link on the page, and detecting "this link was really a mention" after
 * the fact means asking whether the character before it happened to be an `@` —
 * a question the AST cannot answer once the text has been split into nodes.
 *
 * {@link mentionsToMarkdownLinks} answers it BEFORE parsing instead: it rewrites
 * each mention into `[@Ada](fb-mention:uuid)`, an ordinary markdown link with a
 * private scheme. Everything downstream — GFM tables, nested lists, code spans —
 * keeps working untouched, and the renderer's `a` override recognises a mention
 * by its href rather than by its neighbours. The trade is one string pass per
 * render, which is cheaper than the alternative (a bespoke remark plugin) by
 * every measure that matters here.
 *
 * The transform is deliberately NOT applied inside fenced code: a code block
 * showing the raw encoding should show the raw encoding. See
 * {@link mentionsToMarkdownLinks} for how that is preserved.
 */

/** The private URL scheme a rewritten mention carries. Never leaves this app. */
export const MENTION_HREF_PREFIX = 'fb-mention:';

/** A person as the mention encoder needs them — `UserSummary`-compatible. */
export interface MentionTarget {
  id: string;
  name: string;
}

/**
 * Escapes the characters that would break a display name out of the encoding.
 *
 * `]` ends the name half (the shared pattern excludes it outright, so a name
 * containing one could never round-trip) and newlines would split the mention
 * across two markdown lines. Both are replaced rather than escaped: a backslash
 * escape is not part of the wire format, so the server's regex would not see
 * through it.
 */
export function sanitizeMentionName(name: string): string {
  return name
    .replace(/[\r\n]+/gu, ' ')
    .replace(/[[\]()]/gu, '')
    .trim();
}

/** `{ id, name }` → `@[Name](id)`. The exact string that is stored and sent. */
export function encodeMention(user: MentionTarget): string {
  return `@[${sanitizeMentionName(user.name)}](${user.id})`;
}

/**
 * The `@…` token the caret is currently sitting in, or `null`.
 *
 * A trigger is an `@` at the very start of the body or preceded by whitespace —
 * so an email address (`ada@example.com`) never opens the autocomplete — with no
 * whitespace between it and the caret. The `end` is the caret itself rather than
 * the end of the word, so typing into the middle of an existing token replaces
 * only what was typed.
 */
export function findMentionQuery(
  text: string,
  caret: number,
): { start: number; end: number; query: string } | null {
  const position = Math.max(0, Math.min(caret, text.length));

  for (let index = position - 1; index >= 0; index -= 1) {
    const char = text[index];
    if (char === undefined) return null;
    // Whitespace before an `@` was found means the caret is not inside a token.
    if (/\s/u.test(char)) return null;
    if (char !== '@') continue;

    const before = index === 0 ? '' : (text[index - 1] ?? '');
    if (before !== '' && !/\s/u.test(before)) return null;

    return { start: index, end: position, query: text.slice(index + 1, position) };
  }

  return null;
}

/** The textarea state after accepting an autocomplete suggestion. */
export interface MentionInsertion {
  text: string;
  /** Where the caret belongs afterwards — just past the trailing space. */
  caret: number;
}

/**
 * Replaces the `@…` token at `caret` with an encoded mention.
 *
 * A trailing space is appended because the very next thing a writer does is
 * keep typing, and without it the encoding sits flush against the next word and
 * the next `@` would not be a valid trigger.
 */
export function insertMention(text: string, caret: number, user: MentionTarget): MentionInsertion {
  const token = findMentionQuery(text, caret);
  const start = token?.start ?? caret;
  const end = token?.end ?? caret;
  const encoded = `${encodeMention(user)} `;

  return {
    text: `${text.slice(0, start)}${encoded}${text.slice(end)}`,
    caret: start + encoded.length,
  };
}

/** A fresh, non-global matcher — `MENTION_PATTERN` is `/g` and therefore stateful. */
function mentionMatcher(): RegExp {
  return new RegExp(MENTION_PATTERN.source, 'gu');
}

/**
 * `@[Ada](uuid)` → `[@Ada](fb-mention:uuid)` everywhere OUTSIDE fenced code.
 *
 * Fenced blocks are skipped by walking the source line by line and toggling on
 * ``` / ~~~ fences: a code sample that shows the raw encoding must keep showing
 * it. Inline code spans are not protected — the cost of a full inline parse is
 * not worth a case nobody writes — and a mention inside backticks therefore
 * renders as a chip. That is a documented, deliberate corner.
 */
export function mentionsToMarkdownLinks(source: string): string {
  const lines = source.split('\n');
  let inFence = false;

  return lines
    .map((line) => {
      if (/^\s{0,3}(?:```|~~~)/u.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      return line.replace(mentionMatcher(), (_match, name: string, id: string) => {
        // The name is re-escaped for MARKDOWN here (not for the wire format):
        // a `[` inside the link text would close it early.
        const safeName = name.replace(/[[\]]/gu, '');
        return `[@${safeName}](${MENTION_HREF_PREFIX}${id})`;
      });
    })
    .join('\n');
}

/** The user id behind a rewritten mention link, or `null` for a real link. */
export function mentionUserIdFromHref(href: string | undefined): string | null {
  if (href === undefined || !href.startsWith(MENTION_HREF_PREFIX)) return null;
  const id = href.slice(MENTION_HREF_PREFIX.length);
  return id.length > 0 ? id : null;
}

/**
 * The PLAIN-TEXT reading of a body: `@[Ada](uuid)` → `@Ada`.
 *
 * For the places a body appears without a markdown renderer — a notification
 * preview, a `title` attribute, an activity sentence — where the raw encoding
 * would read as gibberish.
 */
export function mentionsToPlainText(source: string): string {
  return source.replace(mentionMatcher(), (_match, name: string) => `@${name}`);
}
