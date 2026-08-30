import type * as React from 'react';
import { Progress as ProgressPrimitive } from 'radix-ui';

import { cn } from '@/lib/utils';

/**
 * shadcn Progress on the unified `radix-ui` package, FlowBoard tokens.
 *
 * ── WHY THE INDICATOR IS SIZED, NOT TRANSLATED ─────────────────────────────
 *
 * Upstream shadcn draws a full-width indicator and slides it out of frame with
 * `transform: translateX(-(100 - value)%)`. Transforms are NOT mirrored by
 * `direction`, so under `dir="rtl"` that bar empties from the wrong end: the
 * fill grows leftward out of a track the eye reads right-to-left. FlowBoard
 * ships Arabic with full RTL, so the indicator sets its own `inline-size`
 * instead — an inline-axis length, which resolves from the reading START in
 * either direction and needs no `rtl:` variant.
 *
 * ── THE VALUE IS CLAMPED HERE ──────────────────────────────────────────────
 *
 * `value` is usually a ratio computed from live data (`done / total`), and the
 * two degenerate inputs are real: a `total` of zero yields `NaN`, and a count
 * that overshoots yields >100. Both would paint a nonsense bar and put a
 * nonsense number in `aria-valuenow`, so they are folded to 0 and 100 before
 * they reach Radix. `value={null}` still means INDETERMINATE and is passed
 * through untouched — Radix drops `aria-valuenow` for it, which is the correct
 * "I do not know how far along this is".
 *
 * The bar is not self-describing: pass `aria-label` (or `aria-labelledby`) from
 * the caller, already translated.
 */
function Progress({
  className,
  value,
  ...props
}: React.ComponentProps<typeof ProgressPrimitive.Root>) {
  const percent =
    value == null || !Number.isFinite(value) ? null : Math.min(100, Math.max(0, value));

  return (
    <ProgressPrimitive.Root
      data-slot="progress"
      value={percent}
      className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-secondary', className)}
      {...props}
    >
      <ProgressPrimitive.Indicator
        data-slot="progress-indicator"
        className="h-full rounded-full bg-primary transition-[inline-size] duration-[var(--speed)]"
        style={{ inlineSize: `${String(percent ?? 0)}%` }}
      />
    </ProgressPrimitive.Root>
  );
}

export { Progress };
