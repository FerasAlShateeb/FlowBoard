import type { ReactNode } from 'react';

import { cn } from '@/lib/utils';

/**
 * The box every Recharts plot lives in — and the dashboard's RTL policy in one
 * component.
 *
 * ── THE LTR ISLAND ────────────────────────────────────────────────────────
 * Recharts does not mirror. It computes pixel positions from a left-origin
 * cartesian model: axis ticks, bar offsets, the tooltip cursor and the legend
 * are all laid out from x=0 on the left regardless of `direction`. Rendering it
 * inside an RTL page produces a plot whose axis labels are mirrored but whose
 * data is not — the worst possible outcome, because it looks deliberate.
 *
 * So the plot is an **isolated `dir="ltr"` island** inside the RTL page, the
 * same policy the Gantt time axis uses (plan §Top risks 5, documented in
 * `.agents/docs/i18n.md`). Everything AROUND the plot — the card title, the
 * info tooltip, the legend, the empty and error states, the toolbar — is normal
 * page content and flips with the page. Only the coordinate space stays LTR,
 * which is also how a reader of Arabic expects a time axis to run: left-to-
 * right, because the numerals on it are Latin (`lib/lang-policy`).
 *
 * ── LTR COORDINATES, PER-LABEL DIRECTION (W3.2) ───────────────────────────
 * The island is a statement about the COORDINATE SPACE, and it was being read
 * as a statement about the WORDS. Every tick label inherited `ltr`, and an
 * Arabic label is not an Arabic word — it is a phrase with Latin numbers inside
 * it. `bucketLabel` on an hourly window emits `29 أغسطس، 12 م`; laid out in an
 * LTR paragraph, the bidi algorithm binds `أغسطس، 12 م` into one right-to-left
 * run and leaves the leading `29` outside it, so the axis rendered
 * `29 م 12 ،أغسطس` — the day torn off its month and parked at the far end. An
 * Arabic reader scanning that tick reads the month, the time, and then the day.
 *
 * `unicode-bidi: plaintext` fixes it at the only correct granularity: each
 * `<text>` (and each tooltip line) resolves its OWN direction from its own
 * first strong character, exactly as `dir="auto"` does for user content. An
 * Arabic label becomes one RTL phrase with the day back on its right; an
 * English label is untouched, because its first strong character is Latin.
 *
 * IT CHANGES NO GEOMETRY. `x`/`y` and `text-anchor` are Recharts' and stay
 * Recharts'; only the glyph order inside an already-placed label moves. That is
 * the whole reason this is a bidi property and not a second `dir` island: a
 * `dir="rtl"` here would flip the axis itself, which is the bug the island
 * exists to prevent.
 *
 * ── THE ACCESSIBLE NAME ───────────────────────────────────────────────────
 * `role="img"` + `aria-label` is what makes a chart mean anything to a screen
 * reader: without it the SVG is announced as a bag of paths, or skipped. The
 * label is a full sentence carrying the HEADLINE NUMBERS (see
 * `report-summaries.ts`), not "burndown chart".
 *
 * The `sr-only` paragraph repeats that sentence in the DOM for tooling that
 * prefers text content to a label. It sits INSIDE the `role="img"` element on
 * purpose: an `img` role makes its subtree presentational, so the sentence is
 * announced exactly once, via the label.
 */
export function ChartFrame({
  summary,
  children,
  className,
}: {
  /** The localized, number-interpolated sentence describing the chart. */
  summary: string;
  /** The `<ResponsiveContainer>` and its chart. */
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      // See the header: the plot's coordinate space is LTR in every language.
      dir="ltr"
      role="img"
      aria-label={summary}
      data-slot="chart-frame"
      className={cn(
        'h-full w-full [font-variant-numeric:tabular-nums]',
        // See the header: LTR coordinates, per-label direction. `text` covers
        // every axis tick and in-plot label; the tooltip is HTML rather than
        // SVG and needs its own selector.
        '[&_text]:[unicode-bidi:plaintext] [&_.recharts-tooltip-wrapper]:[unicode-bidi:plaintext]',
        className,
      )}
    >
      <p className="sr-only">{summary}</p>
      {children}
    </div>
  );
}

export default ChartFrame;
