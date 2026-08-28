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
      className={cn('h-full w-full [font-variant-numeric:tabular-nums]', className)}
    >
      <p className="sr-only">{summary}</p>
      {children}
    </div>
  );
}

export default ChartFrame;
