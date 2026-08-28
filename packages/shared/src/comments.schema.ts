// Comment contracts, plus the mention encoding that turns a comment into a
// notification.
//
// Runtime-neutral: zod only, no DOM/Node globals.
import { z } from 'zod';
import { isoDateTime, uuid } from './common';
import { userSummarySchema } from './users.schema';
import { VM_COMMENT_MAX, VM_COMMENT_REQUIRED } from './validation-messages';

/**
 * MENTION ENCODING — `@[Display Name](userId)`.
 *
 * A comment body is markdown, stored verbatim. A mention is encoded inline as
 * `@[Ada Lovelace](3f6b…-…)`: the bracketed half is the display name captured at
 * write time (so an old comment still reads correctly after a rename) and the
 * parenthesised half is the stable user id (so the notification fan-out and the
 * deep link keep working after one).
 *
 * BOTH ENDS PARSE THE SAME STRING. The renderer replaces matches with mention
 * chips; the comment service runs {@link extractMentionUserIds} on the stored
 * body to decide who gets a `mentioned` notification. Deriving the recipients
 * from the body rather than from a client-supplied list is deliberate: it makes
 * "who did this comment mention" a property of what was actually saved, so
 * editing a mention out of a comment stops notifying, and a hand-crafted request
 * cannot notify someone the body never named.
 *
 * The name half deliberately excludes `]` and the id half is a strict UUID, so
 * ordinary prose containing brackets or an email-style `@name` never matches.
 */
export const MENTION_PATTERN =
  /@\[([^\]]{1,120})\]\(([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\)/g;

/**
 * Pulls the mentioned user ids out of a comment (or task description) body, in
 * first-appearance order, without duplicates.
 *
 * Ids are lowercased: Postgres renders uuids lowercase, so lowercasing makes the
 * result directly comparable to a row id and makes `@[A](AB-…)` and `@[B](ab-…)`
 * one recipient rather than two.
 *
 * Pure and allocation-cheap — safe to call on every save and in a render pass.
 *
 * @example
 *   extractMentionUserIds('cc @[Ada](3f6b0e2a-....-....-....-............)')
 *   // ['3f6b0e2a-....-....-....-............']
 */
export function extractMentionUserIds(body: string): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];

  // A fresh regex per call: MENTION_PATTERN is /g and therefore stateful, so
  // sharing the instance across calls would make results depend on call order.
  const pattern = new RegExp(MENTION_PATTERN.source, 'g');

  let match = pattern.exec(body);
  while (match !== null) {
    const id = match[2]?.toLowerCase();
    if (id !== undefined && !seen.has(id)) {
      seen.add(id);
      ids.push(id);
    }
    match = pattern.exec(body);
  }

  return ids;
}

/** A comment body: markdown, non-empty after trimming, with inline mentions. */
export const commentBodySchema = z
  .string()
  .trim()
  .min(1, VM_COMMENT_REQUIRED)
  .max(10000, VM_COMMENT_MAX);

/**
 * A comment on a task. `editedAt` is `null` until the body is changed, which is
 * what the "(edited)" affordance keys off — the presence of an edit, not a
 * comparison of two timestamps that always differ by microseconds.
 */
export const commentSchema = z.object({
  id: uuid,
  taskId: uuid,
  author: userSummarySchema,
  body: commentBodySchema,
  editedAt: isoDateTime.nullable(),
  createdAt: isoDateTime,
});
export type Comment = z.infer<typeof commentSchema>;

/** `POST /tasks/:taskId/comments`. */
export const createCommentInputSchema = z.object({
  body: commentBodySchema,
});
export type CreateCommentInput = z.infer<typeof createCommentInputSchema>;

/** `PATCH /tasks/:taskId/comments/:commentId` — author-only, stamps `editedAt`. */
export const updateCommentInputSchema = z.object({
  body: commentBodySchema,
});
export type UpdateCommentInput = z.infer<typeof updateCommentInputSchema>;
