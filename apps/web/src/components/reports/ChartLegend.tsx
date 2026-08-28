import { cn } from '@/lib/utils';

/**
 * The chart legend — deliberately HTML, not Recharts' `<Legend>`.
 *
 * Three reasons, in order of weight:
 *
 *   1. **RTL.** Recharts renders its legend inside the plot's SVG, which is an
 *      LTR island (see `ChartFrame`). An Arabic legend trapped in there would
 *      run left-to-right with its swatches on the wrong side of the words. As
 *      page content it flips with everything else, for free.
 *   2. **i18n.** A `<Legend>` label comes from the series' `name` prop or its
 *      `dataKey`; overriding it means a `formatter` per chart. Here the label
 *      is just a translated string a caller passes in.
 *   3. **Layout.** The legend is above the plot rather than inside it, so it
 *      does not steal height from a card with a fixed aspect — six charts of
 *      the same size stay the same size.
 *
 * Swatches take a `var(--chart-*)` string like every other colour on the
 * dashboard; `dashed` draws the guide-line style (the burndown's ideal, the
 * velocity average) so the legend matches what is actually on the canvas.
 */
export interface LegendEntry {
  /** Already translated. */
  label: string;
  /** A `var(--…)` token string — never a literal. */
  color: string;
  /** Renders the swatch as a dashed rule, matching a guide series. */
  dashed?: boolean;
  /** Renders the swatch at the series' own reduced opacity. */
  faded?: boolean;
}

export function ChartLegend({
  entries,
  className,
}: {
  entries: readonly LegendEntry[];
  className?: string;
}) {
  return (
    <ul
      data-slot="chart-legend"
      className={cn('flex flex-wrap items-center gap-x-3 gap-y-1', className)}
    >
      {entries.map((entry) => (
        <li
          key={entry.label}
          className="flex items-center gap-1.5 text-[11px] text-muted-foreground"
        >
          {entry.dashed ? (
            <span
              aria-hidden
              className="inline-block h-0 w-3 border-t-2 border-dashed"
              style={{ borderColor: entry.color }}
            />
          ) : (
            <span
              aria-hidden
              className="inline-block size-2 rounded-[2px]"
              style={{
                backgroundColor: entry.color,
                opacity: entry.faded ? 0.45 : 1,
              }}
            />
          )}
          {entry.label}
        </li>
      ))}
    </ul>
  );
}

export default ChartLegend;
