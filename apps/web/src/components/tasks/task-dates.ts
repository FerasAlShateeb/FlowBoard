/**
 * Calendar-day helpers for the task sheet's date fields.
 *
 * ── The bug this module exists to prevent ───────────────────────────────────
 *
 * `startDate` and `dueDate` are `YYYY-MM-DD` strings (`isoDate` in the shared
 * contract) — a CALENDAR BUCKET, not an instant. The obvious conversions are
 * both wrong:
 *
 *   `new Date('2026-03-01')`        parses as UTC MIDNIGHT, so anyone west of
 *                                   Greenwich renders it as February 28th.
 *   `date.toISOString().slice(0,10)` converts back through UTC, so a date picked
 *                                   at 22:00 in Riyadh is stored as the next day.
 *
 * The primitives that enforce that now live in `lib/format.ts` — this module is
 * the task sheet's ADAPTER onto them: it speaks `lang` (the value the sheet's
 * components already hold from `useLang()`) rather than a BCP-47 tag, and it
 * keeps the `Date | undefined` return the shadcn calendar popover expects, where
 * `lib/format` returns `Date | null`.
 *
 * Before WP3.8 this file carried its own copies of all six, and inlined the
 * Arabic-locale rule three times — producing `en` where the rest of the app used
 * `en-US`.
 */
import { intlLocaleFor } from '@/lib/lang-policy';
import {
  formatDateTime as formatInstant,
  formatIsoDate,
  formatRelative,
  fromIsoDate,
  isOverdue as isDayOverdue,
  toIsoDate,
  todayIso,
} from '@/lib/format';

/** A `Date` → the calendar day it names in the LOCAL zone. */
export const toDateOnly = toIsoDate;

/** Today, as a `YYYY-MM-DD` in the reader's own zone. */
export const todayDateOnly = todayIso;

/**
 * A `YYYY-MM-DD` → local midnight of that day, or `undefined`.
 *
 * `undefined` rather than `null` because this feeds the calendar popover's
 * `selected` prop, which reads `undefined` as "nothing selected" and `null` as
 * a type error.
 */
export function fromDateOnly(value: string | null | undefined): Date | undefined {
  return fromIsoDate(value) ?? undefined;
}

/** True when `value` names a calendar day strictly before today. */
export function isOverdue(value: string | null | undefined, now: Date = new Date()): boolean {
  return isDayOverdue(value, todayIso(now));
}

/** A calendar day, formatted for reading. Empty for a missing or bad value. */
export function formatDateOnly(value: string | null | undefined, lang: string): string {
  return formatIsoDate(value, intlLocaleFor(lang));
}

/**
 * An ISO INSTANT (`createdAt`, `updatedAt`) as an absolute date+time.
 *
 * Separate from {@link formatDateOnly} because the inputs are genuinely
 * different types: an instant DOES belong in the reader's zone, so `new Date()`
 * on it is correct here and wrong there.
 */
export function formatDateTime(value: string | null | undefined, lang: string): string {
  return formatInstant(value, intlLocaleFor(lang));
}

/**
 * "3 hours ago" for a comment or an activity row.
 *
 * `Intl.RelativeTimeFormat` rather than a hand-rolled table: it is the only way
 * to get Arabic's dual and plural forms right, and it comes with the
 * `numeric: 'auto'` wording ("yesterday" instead of "1 day ago") for free.
 */
export function formatRelativeTime(value: string, lang: string, now: Date = new Date()): string {
  return formatRelative(value, intlLocaleFor(lang), now);
}
