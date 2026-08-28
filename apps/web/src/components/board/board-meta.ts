/**
 * The board card's own formatting — what is left after WP3.8 lifted the shared
 * primitives into `lib/format.ts`.
 *
 * `formatDueDate` stays HERE because it is not a general date format: dropping
 * the year for the current year is a decision about how much room a board card
 * has (about eight characters), and no other surface makes it. The glyph tables
 * that used to live in this file are now `components/common/task-icons.tsx`.
 */

export { formatPoints, isOverdue, todayIso } from '@/lib/format';

/**
 * A due date as a card chip: `12 Mar`, or `12 Mar 2026` when it is not this
 * year.
 *
 * The year is dropped for the common case because a board card has room for
 * about eight characters of date, and adding a year every reader can infer
 * costs the day and month their legibility. It comes BACK across a year
 * boundary, where the inference stops being safe.
 *
 * Parsed with an explicit `T00:00:00` so the string is read as LOCAL midnight.
 * `new Date('2026-03-12')` is UTC midnight, which renders as the 11th for
 * anyone west of Greenwich.
 */
export function formatDueDate(dueDate: string, locale: string, now: Date = new Date()): string {
  const parsed = new Date(`${dueDate}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return dueDate;

  const sameYear = parsed.getFullYear() === now.getFullYear();
  return new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    ...(sameYear ? {} : { year: 'numeric' }),
  }).format(parsed);
}

/** How many label dots a card draws before collapsing the rest into `+n`. */
export const MAX_LABEL_DOTS = 3;
