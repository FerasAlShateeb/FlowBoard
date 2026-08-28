import type { TooltipContentProps } from 'recharts';

import { CHART_CHROME } from './chart-theme';

/**
 * The hover card, shared by all five Recharts plots.
 *
 * WHY A CUSTOM CONTENT COMPONENT AT ALL. Recharts' default tooltip ships its
 * own inline styles — a white box with a light border — and no amount of
 * `contentStyle` reaches the rows inside it. On the dark palette that is a
 * flashlight in the middle of the chart. This one is a plain HTML fragment
 * using the same tokens as `ui/tooltip` (`bg-surface-raised`, `border-border`,
 * `--shadow-2`), so it belongs to the theme like every other popover in the app
 * and follows a Theme Studio preset for free.
 *
 * IT RENDERS HTML, NOT SVG — Recharts portals the tooltip into a positioned
 * `div` outside the plot, which is also why it may keep the page's direction:
 * the numbers are Latin either way, and the label/value rows read correctly in
 * both. The plot's LTR island (see `ChartFrame`) does not extend to here.
 *
 * The caller supplies the row LABELS, keyed by `dataKey`, rather than letting
 * Recharts fall back to the raw key: `remainingPoints` is not a thing to show a
 * user, and the label has to be translated anyway.
 */
// The DEFAULT generics, not `<number, string>`: Recharts types the `content`
// callback with its own `ValueType`/`NameType` defaults, and narrowing them here
// makes the component unassignable to the very prop it exists for. The numeric
// narrowing happens per row instead, where the value actually is one.
export interface ChartTooltipProps extends TooltipContentProps {
  /** `dataKey` → translated series name. */
  labels: Readonly<Record<string, string>>;
  /** Renders the heading (the x value). Defaults to the raw label. */
  formatHeading?: (label: string) => string;
  /** Renders each row's value. Defaults to `String`. */
  formatValue?: (value: number) => string;
  /** Appended after every value — "points", "tasks", "hours". */
  unit?: string;
}

export function ChartTooltipContent({
  active,
  payload,
  label,
  labels,
  formatHeading,
  formatValue,
  unit,
}: ChartTooltipProps) {
  if (!active || !payload || payload.length === 0) return null;

  const heading = label === undefined ? '' : String(label);

  return (
    <div className="pointer-events-none rounded-[var(--radius)] border border-border bg-surface-raised px-2.5 py-1.5 text-xs shadow-[var(--shadow-2)] [font-variant-numeric:tabular-nums]">
      {heading ? (
        <p className="mb-1 font-medium text-foreground">
          {formatHeading ? formatHeading(heading) : heading}
        </p>
      ) : null}
      <ul className="flex flex-col gap-0.5">
        {payload.map((entry, index) => {
          const key = typeof entry.dataKey === 'string' ? entry.dataKey : String(index);
          const value = typeof entry.value === 'number' ? entry.value : Number(entry.value ?? 0);
          return (
            <li key={key} className="flex items-center gap-2">
              <span
                aria-hidden
                className="inline-block size-2 shrink-0 rounded-[2px]"
                // `entry.color` is whatever the series was drawn with — i.e. one
                // of the `var(--chart-*)` strings from `chart-theme`, echoed
                // back by Recharts. Still a token, never a literal.
                style={{ backgroundColor: entry.color ?? CHART_CHROME.text }}
              />
              <span className="text-muted-foreground">{labels[key] ?? key}</span>
              <span className="ms-auto ps-2 font-medium text-foreground">
                {formatValue ? formatValue(value) : String(value)}
                {unit ? <span className="ms-1 text-muted-foreground">{unit}</span> : null}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export default ChartTooltipContent;
