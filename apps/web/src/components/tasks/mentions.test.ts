import { describe, expect, it } from 'vitest';
import { extractMentionUserIds } from '@flowboard/shared';

import {
  MENTION_HREF_PREFIX,
  encodeMention,
  findMentionQuery,
  insertMention,
  mentionUserIdFromHref,
  mentionsToMarkdownLinks,
  mentionsToPlainText,
  sanitizeMentionName,
} from '@/components/tasks/mentions';

/**
 * The mention encoding, from both ends.
 *
 * THE ONE ASSERTION THAT MATTERS MOST is the round trip through the SHARED
 * parser: whatever this module writes, `extractMentionUserIds` — the same
 * function the API runs on the stored body to decide who gets notified — has to
 * be able to read back. An encoder that drifted from that regex would produce
 * comments that render mentions and notify nobody, which is invisible until
 * someone complains they were never told.
 */

const ADA = { id: '3f6b0e2a-1111-4111-8111-111111111111', name: 'Ada Lovelace' };

describe('encodeMention', () => {
  it('writes the wire form the shared pattern parses', () => {
    expect(encodeMention(ADA)).toBe(`@[Ada Lovelace](${ADA.id})`);
  });

  it('round-trips through the SERVER-side extractor', () => {
    const body = `cc ${encodeMention(ADA)} please`;
    expect(extractMentionUserIds(body)).toEqual([ADA.id]);
  });

  it('strips the characters that would break the encoding out of a name', () => {
    // `]` ends the name half and would terminate the mention early; brackets and
    // parens are removed rather than escaped, because the wire format has no
    // escape sequence for the server's regex to see through.
    expect(sanitizeMentionName('Ada [The First] (Byron)')).toBe('Ada The First Byron');
    expect(encodeMention({ id: ADA.id, name: 'Ada\nLovelace' })).toBe(`@[Ada Lovelace](${ADA.id})`);
  });
});

describe('findMentionQuery', () => {
  it('finds the token the caret sits in', () => {
    const text = 'ping @ad';
    expect(findMentionQuery(text, text.length)).toEqual({ start: 5, end: 8, query: 'ad' });
  });

  it('treats a bare @ at the start of the body as a trigger', () => {
    expect(findMentionQuery('@', 1)).toEqual({ start: 0, end: 1, query: '' });
  });

  it('does NOT trigger inside an email address', () => {
    // The `@` is preceded by a word character, so it is an address, not a
    // mention — this is the case that would otherwise open a suggestion list
    // every time somebody typed a colleague's email.
    const text = 'ada@example.com';
    expect(findMentionQuery(text, text.length)).toBeNull();
  });

  it('closes once whitespace follows the token', () => {
    const text = '@ada done';
    expect(findMentionQuery(text, text.length)).toBeNull();
  });

  it('reads the token up to the CARET, not the end of the word', () => {
    // Caret between "ad" and "a": typing into the middle of a token narrows on
    // what is behind the caret only.
    expect(findMentionQuery('@ada', 3)).toEqual({ start: 0, end: 3, query: 'ad' });
  });
});

describe('insertMention', () => {
  it('replaces the token and leaves the caret past a trailing space', () => {
    const result = insertMention('ping @ad', 8, ADA);
    expect(result.text).toBe(`ping @[Ada Lovelace](${ADA.id}) `);
    expect(result.caret).toBe(result.text.length);
  });

  it('keeps the text that followed the token', () => {
    const text = 'ping @ad — thanks';
    const result = insertMention(text, 8, ADA);
    expect(result.text).toBe(`ping @[Ada Lovelace](${ADA.id})  — thanks`);
  });

  it('inserts at the caret when there is no token at all', () => {
    const result = insertMention('hello', 5, ADA);
    expect(result.text).toBe(`hello@[Ada Lovelace](${ADA.id}) `);
  });
});

describe('mentionsToMarkdownLinks', () => {
  it('rewrites a mention into a markdown link with the private scheme', () => {
    expect(mentionsToMarkdownLinks(`hi ${encodeMention(ADA)}`)).toBe(
      `hi [@Ada Lovelace](${MENTION_HREF_PREFIX}${ADA.id})`,
    );
  });

  it('leaves an ordinary markdown link untouched', () => {
    const source = 'see [the docs](https://example.com)';
    expect(mentionsToMarkdownLinks(source)).toBe(source);
  });

  it('does NOT rewrite inside a fenced code block', () => {
    // A code sample showing the raw encoding must keep showing it.
    const source = ['before', '```', encodeMention(ADA), '```', 'after'].join('\n');
    expect(mentionsToMarkdownLinks(source)).toContain(encodeMention(ADA));
    expect(mentionsToMarkdownLinks(source)).not.toContain(MENTION_HREF_PREFIX);
  });
});

describe('mentionUserIdFromHref', () => {
  it('recognises a rewritten mention', () => {
    expect(mentionUserIdFromHref(`${MENTION_HREF_PREFIX}${ADA.id}`)).toBe(ADA.id);
  });

  it('returns null for a real link, an empty id, and nothing at all', () => {
    expect(mentionUserIdFromHref('https://example.com')).toBeNull();
    expect(mentionUserIdFromHref(MENTION_HREF_PREFIX)).toBeNull();
    expect(mentionUserIdFromHref(undefined)).toBeNull();
  });
});

describe('mentionsToPlainText', () => {
  it('reduces the encoding to the readable name', () => {
    expect(mentionsToPlainText(`cc ${encodeMention(ADA)} and ${encodeMention(ADA)}`)).toBe(
      'cc @Ada Lovelace and @Ada Lovelace',
    );
  });
});
