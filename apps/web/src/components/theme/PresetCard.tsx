import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';
import type { ThemeColorTokens } from '@flowboard/shared';

import { cn } from '@/lib/utils';
import type { ColorPreset } from '@/components/theme/theme-presets';

/**
 * A miniature FlowBoard, painted with ONE preset's raw palette.
 *
 * INLINE STYLES ARE THE POINT HERE, and they are not a token violation. Every
 * other surface in the app reads `var(--surface)` and therefore shows the
 * ACTIVE theme — which is exactly what a gallery of eight alternatives must not
 * do. The card has to render colours the running document does not contain, so
 * the values come straight from the preset object. (Checklist §6 forbids colour
 * LITERALS in components; these are data read from `theme-presets.ts`, the same
 * exemption `common/LabelDot` documents for a label's stored hex.)
 *
 * The mock is a sidebar rail, a topbar, two cards and a five-bar chart —
 * because that is what a FlowBoard page is, and because the chart row is the
 * only honest way to preview `chart1`-`chart5`, which WP3.8 also rides the
 * task-type glyphs on.
 */
function PresetMock({ colors }: { colors: ThemeColorTokens }) {
  return (
    <div
      aria-hidden
      className="h-20 overflow-hidden rounded-[var(--radius)] border"
      style={{ backgroundColor: colors.bg, borderColor: colors.border }}
    >
      <div className="flex h-full">
        {/* Sidebar rail: brand dot, the active row, two idle rows. */}
        <div
          className="flex w-5 shrink-0 flex-col gap-1 border-e p-1"
          style={{ backgroundColor: colors.sidebarBg, borderColor: colors.border }}
        >
          <div className="h-1.5 rounded-[1px]" style={{ backgroundColor: colors.primary }} />
          <div className="h-1 rounded-[1px]" style={{ backgroundColor: colors.sidebarActive }} />
          <div className="h-1 rounded-[1px]" style={{ backgroundColor: colors.border }} />
          <div className="h-1 rounded-[1px]" style={{ backgroundColor: colors.border }} />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          {/* Topbar, with the accent and primary chips pinned to the end. */}
          <div
            className="flex h-3 shrink-0 items-center justify-end gap-0.5 border-b px-1"
            style={{ backgroundColor: colors.topbar, borderColor: colors.border }}
          >
            <span className="size-1 rounded-full" style={{ backgroundColor: colors.accent }} />
            <span className="size-1 rounded-full" style={{ backgroundColor: colors.primary }} />
          </div>

          {/* Two board cards: a title line in `text`, a meta line in `textMuted`. */}
          <div className="grid shrink-0 grid-cols-2 gap-1 p-1">
            {[colors.primary, colors.accent].map((tint, index) => (
              <div
                key={index}
                className="rounded-[2px] border p-0.5"
                style={{ backgroundColor: colors.surface, borderColor: colors.border }}
              >
                <div
                  className="mb-0.5 h-0.5 w-2/3 rounded-[1px]"
                  style={{ backgroundColor: colors.text }}
                />
                <div
                  className="mb-0.5 h-0.5 w-1/2 rounded-[1px]"
                  style={{ backgroundColor: colors.textMuted }}
                />
                <div className="h-1 w-1/3 rounded-[1px]" style={{ backgroundColor: tint }} />
              </div>
            ))}
          </div>

          {/* The chart ramp, as the bars it will actually become. */}
          <div className="flex flex-1 items-end gap-0.5 px-1 pb-1">
            {(
              [
                [colors.chart1, 'h-4'],
                [colors.chart2, 'h-3'],
                [colors.chart3, 'h-5'],
                [colors.chart4, 'h-2'],
                [colors.chart5, 'h-3.5'],
              ] as const
            ).map(([color, height], index) => (
              <span
                key={index}
                className={cn('flex-1 rounded-[1px]', height)}
                style={{ backgroundColor: color }}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * One card in the preset gallery: both palettes, the swatch row, the name and
 * a one-line rationale.
 *
 * BOTH MODES ARE SHOWN because the document carries both and applying the
 * preset replaces both — a card that previewed only the mode you happen to be
 * in would be hiding half of what the click does.
 */
export function PresetCard({
  preset,
  active,
  onApply,
}: {
  preset: ColorPreset;
  active: boolean;
  onApply: () => void;
}) {
  const { t } = useTranslation(['theme']);
  const name = t(`theme:presets.${preset.labelKey}`);

  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={t('theme:actions.apply', { name })}
      onClick={onApply}
      className={cn(
        'group grid gap-2 rounded-[var(--card-radius)] border bg-surface p-2 text-start transition-colors duration-[var(--speed)]',
        'focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none',
        active
          ? 'border-primary ring-2 ring-primary/40'
          : 'border-border hover:border-muted-foreground',
      )}
    >
      <div className="grid grid-cols-2 gap-1.5">
        <PresetMock colors={preset.light} />
        <PresetMock colors={preset.dark} />
      </div>

      <div className="flex items-center justify-between gap-1.5">
        <span className="truncate text-xs font-medium text-foreground">{name}</span>
        {active ? <Check aria-hidden className="size-3.5 shrink-0 text-primary" /> : null}
      </div>

      <p className="line-clamp-2 text-xs text-muted-foreground">
        {t(`theme:presetHints.${preset.labelKey}`)}
      </p>

      <div className="flex gap-1">
        {preset.swatches.map((color, index) => (
          <span
            key={index}
            aria-hidden
            className="size-3 rounded-full border border-border"
            style={{ backgroundColor: color }}
          />
        ))}
      </div>
    </button>
  );
}

export default PresetCard;
