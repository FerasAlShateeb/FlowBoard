import { cn } from '@/lib/utils';
import {
  RANGE_PRESETS,
  type RangePreset,
  type RangePresetToken,
} from '@/components/dashboard/range';

/**
 * The preset pill row: `7d · 30d · 90d · 12m`, rendered as ONE control.
 *
 * ═══ WHY PLAIN BUTTONS AND NOT `ui/toggle-group` ═════════════════════════
 *
 * These pills are a FILTER: pressing one fires a request and rewrites the URL.
 * That is button semantics, not form-field semantics — a radio group would
 * claim the choice is part of a form being submitted, and Radix's ToggleGroup
 * would add a roving-tabindex model (arrow keys move the selection, Tab leaves
 * the group) for no behavioural gain on four chips that sit next to a fifth
 * control the same Tab has to reach anyway.
 *
 * Plain `<button type="button">` also keeps each segment's ACCESSIBLE NAME
 * equal to its visible face, which is how the e2e suite addresses these pills.
 * The `role="group"` + `aria-label` wrapper is what tells a screen reader the
 * four buttons are one control; `aria-pressed` is what tells it which is on.
 *
 * ═══ THE LABELS STAY LATIN IN EVERY LANGUAGE ═════════════════════════════
 *
 * `7d` / `30d` / `90d` / `12m` are the visible faces in Arabic too. Three
 * reasons, all of them concrete: FlowBoard's digits are Western by policy
 * (i18n.md — `ar-u-nu-latn`), a four-character chip has no room for a spelled
 * out phrase without reflowing the strip, and `rangeLabel()` echoes the preset
 * verbatim onto the sibling custom-range trigger, so a translated pill would
 * disagree with the label beside it.
 *
 * (GameDash additionally hangs a spelled-out `title` hint on each pill. It is
 * omitted here rather than half-done: the catalog has phrases for `7d` and
 * `30d` only, and hints on two of four pills is worse than none.)
 *
 * ═══ `custom` IS ACCEPTED, NEVER EMITTED ═════════════════════════════════
 *
 * {@link RangePicker} composes these pills beside its own custom-window
 * trigger. Passing `'custom'` leaves NO pill pressed, which is how one control
 * stays one control instead of two that disagree about what is selected.
 */
export interface RangePillsProps {
  /** The active preset. `'custom'` renders with nothing pressed. */
  value: RangePreset;
  onChange: (preset: RangePresetToken) => void;
  /** Names the group for assistive tech. Required — an unnamed group is noise. */
  ariaLabel: string;
  /** `data-testid` on the group element. */
  testId?: string;
  className?: string;
}

export function RangePills({ value, onChange, ariaLabel, testId, className }: RangePillsProps) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      data-slot="range-pills"
      data-testid={testId}
      className={cn(
        'inline-flex rounded-[var(--btn-radius)] border border-border bg-surface p-0.5',
        className,
      )}
    >
      {RANGE_PRESETS.map((preset) => {
        const active = preset === value;
        return (
          <button
            key={preset}
            type="button"
            aria-pressed={active}
            data-slot="range-pill"
            data-testid={`range-pill-${preset}`}
            className={cn(
              'cursor-default rounded-[calc(var(--btn-radius)-2px)] px-2.5 py-1 text-xs font-medium tabular-nums transition-colors duration-[var(--speed)] outline-none focus-visible:ring-2 focus-visible:ring-ring/60',
              active ? 'bg-accent text-primary' : 'text-muted-foreground hover:text-foreground',
            )}
            onClick={() => {
              onChange(preset);
            }}
          >
            {preset}
          </button>
        );
      })}
    </div>
  );
}
