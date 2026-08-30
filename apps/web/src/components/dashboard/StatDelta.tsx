import { ArrowDown, ArrowUp, Minus } from 'lucide-react';

import { cn } from '@/lib/utils';
import { formatDelta } from '@/components/dashboard/format';

/**
 * The trend badge: a signed percent with a direction arrow.
 *
 * ═══ THE COLOUR IS A TOKEN, AND THE TINT IS THE HOUSE RECIPE ═════════════
 *
 * Up is `--success`, down is `--danger`, flat is `--text-muted`, and each sits
 * on `color-mix(in oklab, <token> 12%, transparent)` — the same 12% tint the
 * label chips, the Gantt bars and the diagnostics chrome use (design-system
 * §6). `oklab` rather than `srgb` keeps the green from going grey and the red
 * from going brown; mixing toward `transparent` rather than toward a page
 * colour keeps the badge correct on `--surface`, inside a card and inside a
 * dialog alike, and lets it follow the Theme Studio and the light/dark switch
 * with no second definition anywhere.
 *
 * The `style` prop is how a token reaches `color-mix()` at all: Tailwind can
 * only emit the arbitrary value if the whole expression is a literal, and a
 * literal per direction is three near-identical strings. One recipe, three
 * variable names, is the version that cannot drift.
 *
 * ═══ POLARITY: THE ARROW IS THE NUMBER, THE COLOUR IS THE JUDGEMENT ══════
 *
 * Some metrics improve as they FALL — error rate, error count, p95 latency,
 * cycle time — so a green "+18%" on those tiles says the opposite of what
 * happened. `goodDirection` is how a caller says which way is good; it defaults
 * to `'up'`, which is right for every count, rate and total in the product.
 *
 * The split is what makes this safe, and it is the whole design (R2 W3.5, the
 * fix for the "no lower-is-better mode" note this header used to carry):
 *
 *  - **the ARROW and `data-direction` follow the SIGN.** A number that fell
 *    always draws a down arrow, in every context. They are a statement of fact
 *    and never change meaning.
 *  - **the COLOUR and `data-tone` follow the JUDGEMENT** — `good`, `bad` or
 *    `flat` — which is `sign === goodDirection`.
 *
 * So a falling error rate is a DOWN arrow in GREEN, which reads correctly at a
 * glance and is unambiguous on inspection. The objection the old header raised —
 * "the same +18% would get two colours depending on which card it landed on" —
 * is real, and this is the answer to it: the two cards also draw two different
 * arrows and expose two different `data-tone`s, so nothing is silently
 * re-coloured; the badge is saying something different because the metric means
 * something different.
 *
 * WHERE THE FACT LIVES IS STILL NOT HERE. `goodDirection` is a prop, and the
 * analytics console fills it from `MetricDefinition.deltaDirection` in the
 * metric registry (see `MetricTile`), so polarity is declared once per metric,
 * next to that metric's title and columns, and the KPI tile and its drill-down
 * can never disagree about it.
 *
 * ═══ THE PILL IS AN LTR ISLAND ═══════════════════════════════════════════
 *
 * `dir="ltr"`, like the chart plots and the endpoint paths. Its whole content is
 * a Latin numeric run — an arrow glyph, a sign, digits, a percent — and the
 * BiDi algorithm treats a LEADING `+` or `-` as neutral, so in an Arabic session
 * it reordered to the other end of the number: `+12.5%` was rendering as
 * `12.5%+`, which reads as a footnote marker rather than as a rise. (Observed on
 * every analytics KPI in the RTL pass, W3.1.)
 *
 * Pinning the pill rather than wrapping the string keeps the arrow on the
 * number's leading side in both languages, which is the same convention every
 * chart axis in the product already follows (`lib/lang-policy`: numerals are
 * Latin in every language, so their runs read left to right).
 *
 * ═══ A11Y ═══════════════════════════════════════════════════════════════
 *
 * The arrow is `aria-hidden`: the sign is already in the text, and "up arrow,
 * plus twelve point five percent" is one word of noise per tile. Screen-reader
 * users get exactly what sighted ones do.
 */
/** Which way this metric has to move to be good. See the header. */
export type GoodDirection = 'up' | 'down';

export interface StatDeltaProps {
  /** Signed percent change — `-12.5` for a 12.5% drop. */
  value: number;
  /**
   * The direction that counts as an improvement. `'up'` (the default) is right
   * for counts, rates and totals; `'down'` is for the metrics that improve as
   * they fall — errors, error rate, latency, cycle time.
   */
  goodDirection?: GoodDirection;
  className?: string;
}

export function StatDelta({ value, goodDirection = 'up', className }: StatDeltaProps) {
  // The SIGN — what the number did. Drives the arrow and `data-direction`.
  const direction = value > 0 ? 'up' : value < 0 ? 'down' : 'flat';
  // The JUDGEMENT — whether that was an improvement. Drives the colour.
  const tone = direction === 'flat' ? 'flat' : direction === goodDirection ? 'good' : 'bad';
  const token = tone === 'good' ? '--success' : tone === 'bad' ? '--danger' : '--text-muted';
  const Icon = direction === 'up' ? ArrowUp : direction === 'down' ? ArrowDown : Minus;

  return (
    <span
      dir="ltr"
      data-slot="stat-delta"
      data-direction={direction}
      data-tone={tone}
      data-testid="stat-delta"
      className={cn(
        'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium tabular-nums',
        className,
      )}
      style={{
        color: `var(${token})`,
        background: `color-mix(in oklab, var(${token}) 12%, transparent)`,
      }}
    >
      <Icon className="size-3" aria-hidden />
      {formatDelta(value)}
    </span>
  );
}
