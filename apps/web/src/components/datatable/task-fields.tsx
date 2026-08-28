import { useMemo } from 'react';

import type { TaskPriority, TaskType } from '@flowboard/shared';

import { getIntlLocale, useLang } from '@/lib/lang-policy';
import { formatDateTime, fromIsoDate, relativeParts } from '@/lib/format';
import { useTaskVocabulary } from '@/components/common/task-vocabulary';

/**
 * The Table view's field vocabulary: the date/number formatting every cell and
 * the CSV exporter share.
 *
 * THE GLYPHS AND THE ENUM ORDERS USED TO LIVE HERE TOO — one of six copies
 * Wave 3's parallel view packages each grew, and they had diverged (see the
 * note atop `components/common/task-icons.tsx`). WP3.8 lifted them into
 * `components/common`, which is what this file's own TODO asked for; the
 * re-exports below keep this module the one import the table's cells reach for.
 *
 * DIGITS AND DATES. `getIntlLocale()` returns `ar-u-nu-latn` for Arabic, so
 * every formatter below emits WESTERN digits in both languages — the table is a
 * `tabular-nums` grid and a digit swap between rows breaks column alignment
 * (see `lib/lang-policy`).
 */

export {
  PriorityIcon,
  TASK_PRIORITIES,
  TASK_TYPES,
  TaskTypeIcon,
} from '@/components/common/task-icons';

/**
 * Localized names for both enums, under the names the table's cells and the CSV
 * exporter already call them.
 *
 * A THIN ALIAS over `useTaskVocabulary()` rather than a second lookup: the
 * words came from `table:types.*`/`table:priorities.*` until WP3.8 folded four
 * identical catalog subtrees into `common`. Keeping the alias means the ten
 * call sites in `cells.tsx`, `TableToolbar.tsx` and `csv-rows.ts` did not have
 * to change spelling to gain a single source of truth.
 */
export function useTaskFieldLabels(): {
  typeLabel: (type: TaskType) => string;
  priorityLabel: (priority: TaskPriority) => string;
} {
  const { typeName, priorityName } = useTaskVocabulary();
  return useMemo(
    () => ({ typeLabel: typeName, priorityLabel: priorityName }),
    [typeName, priorityName],
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Dates
// ───────────────────────────────────────────────────────────────────────────

/**
 * The calendar-day conversions, from `lib/format`.
 *
 * They used to be defined here. The parse's own comment claimed to reject
 * `2026-02-31`, and it did not — `new Date(2026, 1, 31)` rolls forward to 3
 * March without ever being `NaN`, so a typo in a date cell became a real, wrong
 * due date. The shared version round-trips the parse to catch exactly that.
 *
 * `parseIsoDate` keeps its local name: it is what `cells.tsx` calls it.
 */
export { fromIsoDate as parseIsoDate, toIsoDate } from '@/lib/format';

/**
 * The three formatters the grid needs, rebuilt only on a language switch.
 *
 * `useLang()` is in the dependency list purely to re-run the memo — the locale
 * itself comes from `getIntlLocale()`. Building an `Intl` formatter is not free
 * and a 100-row grid would otherwise build one per cell per render.
 *
 * WHY `formatDate` IS STILL LOCAL and not `lib/format.formatIsoDate`: the grid
 * asks for a TWO-DIGIT day (`05 Mar 2026`, not `5 Mar 2026`) so the date column
 * stays a fixed width down the page, and it returns `null` rather than `''` so a
 * cell can render its own em-dash placeholder. Both are grid decisions.
 */
export function useTableFormatters(): {
  /** `YYYY-MM-DD` → a localized calendar day, or `null` for an unset date. */
  formatDate: (iso: string | null) => string | null;
  /** An ISO instant → "3 days ago". */
  formatRelative: (iso: string) => string;
  /** An ISO instant → the full date and time, for a `title` tooltip. */
  formatDateTime: (iso: string) => string;
} {
  const lang = useLang();

  return useMemo(() => {
    const locale = getIntlLocale();
    const dateFormat = new Intl.DateTimeFormat(locale, {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    });

    return {
      formatDate: (iso: string | null) => {
        const date = fromIsoDate(iso);
        return date ? dateFormat.format(date) : null;
      },
      formatRelative: (iso: string) => {
        const at = new Date(iso);
        if (Number.isNaN(at.getTime())) return '';
        // CLAMPED TO THE PAST. This only ever describes `updatedAt`, and a few
        // seconds of clock skew between the server and the browser should read
        // as "now", not "in 3 seconds".
        const now = new Date();
        const { value, unit } = relativeParts(new Date(Math.min(at.getTime(), now.getTime())), now);
        return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(value, unit);
      },
      formatDateTime: (iso: string) => formatDateTime(iso, locale),
    };
    // `lang` is not READ inside the memo — it is the signal that
    // `getIntlLocale()` now answers differently. The rule cannot see through
    // that indirection, and dropping the dependency would freeze every
    // formatter on the language the component first mounted with.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above.
  }, [lang]);
}

/**
 * Story points as text, for a CELL EDITOR.
 *
 * `String(points)` rather than `lib/format.formatPoints`: this value round-trips
 * through an `<input>` that `parsePoints` reads back, so it must be the machine
 * spelling. A locale-formatted `0,5` or `٠٫٥` would not survive the round trip —
 * which is exactly why this one is NOT the shared formatter despite the name.
 */
export function formatPoints(points: number | null): string {
  return points === null ? '' : String(points);
}
