import type { Label as TaskLabel } from '@flowboard/shared';

import { cn } from '@/lib/utils';

/**
 * A label's colour swatch, and the label as a chip.
 *
 * THE INLINE STYLE IS NOT A TOKEN VIOLATION. Checklist §B bans hex literals in
 * SOURCE; this colour is DATA — a per-project value a user picked, stored in
 * `labels.color`, and unknowable at build time. It can only arrive as an inline
 * style. The presets a user picks FROM are in `lib/label-colors.ts`, which is
 * the "presets" exemption the same rule names.
 *
 * `color-mix` for the chip background rather than an alpha hex: it keeps the
 * tint in the same colour space as the rest of the palette (oklab), so a very
 * light label does not turn into an invisible wash the way an `rgba()` on a
 * dark surface would.
 */

export function LabelDot({ color, className }: { color: string; className?: string }) {
  return (
    <span
      aria-hidden
      data-slot="label-dot"
      className={cn('inline-block size-2 shrink-0 rounded-full', className)}
      style={{ backgroundColor: color }}
    />
  );
}

/** The dot plus the name — what a board card and the labels editor render. */
export function LabelChip({ label, className }: { label: TaskLabel; className?: string }) {
  return (
    <span
      data-slot="label-chip"
      className={cn(
        'inline-flex w-fit items-center gap-1.5 rounded-[var(--radius)] border px-1.5 py-0.5 text-xs font-medium',
        className,
      )}
      style={{
        backgroundColor: `color-mix(in oklab, ${label.color} 14%, transparent)`,
        borderColor: `color-mix(in oklab, ${label.color} 30%, transparent)`,
      }}
    >
      <LabelDot color={label.color} />
      <span className="truncate">{label.name}</span>
    </span>
  );
}

export default LabelDot;
