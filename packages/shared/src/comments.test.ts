import { describe, expect, it } from 'vitest';
import {
  commentSchema,
  createCommentInputSchema,
  extractMentionUserIds,
  updateCommentInputSchema,
} from './comments.schema';

const ADA = '3f6b0e2a-1c4d-4a8e-9b21-6d5f7a8c9e01';
const ALAN = '7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f';

describe('extractMentionUserIds', () => {
  it('returns nothing for a body with no mentions', () => {
    expect(extractMentionUserIds('just a plain comment')).toEqual([]);
    expect(extractMentionUserIds('')).toEqual([]);
  });

  it('pulls a single mention out of surrounding prose', () => {
    expect(extractMentionUserIds(`cc @[Ada Lovelace](${ADA}) please review`)).toEqual([ADA]);
  });

  it('preserves first-appearance order across several mentions', () => {
    const body = `@[Ada](${ADA}) and @[Alan](${ALAN}) — over to you`;

    expect(extractMentionUserIds(body)).toEqual([ADA, ALAN]);
  });

  it('de-duplicates a user mentioned twice', () => {
    const body = `@[Ada](${ADA}) ping @[Ada Lovelace](${ADA})`;

    expect(extractMentionUserIds(body)).toEqual([ADA]);
  });

  it('lowercases ids so casing cannot split one recipient into two', () => {
    const body = `@[Ada](${ADA.toUpperCase()}) @[Ada](${ADA})`;

    expect(extractMentionUserIds(body)).toEqual([ADA]);
  });

  it('ignores an @name that is not the encoded form', () => {
    expect(extractMentionUserIds('@ada please look')).toEqual([]);
    expect(extractMentionUserIds('@[Ada](not-a-uuid)')).toEqual([]);
    expect(extractMentionUserIds('see [Ada](https://example.com)')).toEqual([]);
  });

  it('is not stateful across calls despite the /g pattern', () => {
    const body = `@[Ada](${ADA})`;

    expect(extractMentionUserIds(body)).toEqual([ADA]);
    expect(extractMentionUserIds(body)).toEqual([ADA]);
  });

  it('handles a mention flush against the end of the body', () => {
    expect(extractMentionUserIds(`thanks @[Alan](${ALAN})`)).toEqual([ALAN]);
  });
});

describe('comment contracts', () => {
  const validComment = {
    id: ADA,
    taskId: ALAN,
    author: { id: ADA, name: 'Ada Lovelace', avatarUrl: null },
    body: 'looks good',
    editedAt: null,
    createdAt: '2026-02-01T10:00:00Z',
  };

  it('parses a comment row', () => {
    const parsed = commentSchema.parse(validComment);

    expect(parsed.editedAt).toBeNull();
    expect(parsed.author.name).toBe('Ada Lovelace');
  });

  it('rejects a comment whose author is missing', () => {
    const { author: _author, ...withoutAuthor } = validComment;

    expect(commentSchema.safeParse(withoutAuthor).success).toBe(false);
  });

  it('rejects a whitespace-only body on create and update', () => {
    expect(createCommentInputSchema.safeParse({ body: '   ' }).success).toBe(false);
    expect(updateCommentInputSchema.safeParse({ body: '' }).success).toBe(false);
  });

  it('trims a body before storing it', () => {
    expect(createCommentInputSchema.parse({ body: '  hello  ' }).body).toBe('hello');
  });
});
