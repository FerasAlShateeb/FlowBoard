import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';
import { isOptionActive, type DimensionGroup } from '@/components/theme/theme-presets';
import { useThemeStore } from '@/stores/useThemeStore';

/**
 * A word-labelled segmented control over one {@link DimensionGroup}.
 *
 * NO NUMBERS ON SCREEN, ANYWHERE. "Corners: Rounded", never "border-radius:
 * 10px". The px values live in `theme-presets.ts`; a reader choosing how their
 * tool looks is not choosing a number, and the moment the control says `10` the
 * next question is why not `11` — which is a slider, which is a way to make
 * every theme slightly wrong.
 *
 * `radiogroup` semantics, matching `common/ColorSwatchPicker`: N mutually
 * exclusive options is exactly what radio describes. Every option stays in the
 * tab order (rather than a roving tabindex) so the keyboard path through the
 * Layout tab is one continuous Tab sweep.
 *
 * Nothing here is directional: `border-e`/`last:border-e-0` mirror themselves
 * under `dir="rtl"`.
 *
 * `compact` DROPS THE TRAILING HINT, and nothing else. It is what the Theme
 * Studio DRAWER renders with: 380px holding eight of these needs the label, the
 * live word and the control — and the sentence explaining what "Elevation"
 * means belongs on `/theme`, the surface built for reading. Every semantic
 * (`radiogroup`, `aria-checked`, the same keys) is identical, so the two
 * surfaces cannot drift into two different controls.
 */
export function SegmentedOptions({
  group,
  compact = false,
}: {
  group: DimensionGroup;
  compact?: boolean;
}) {
  const { t } = useTranslation(['theme']);
  const shared = useThemeStore((state) => state.theme.shared);
  const patchShared = useThemeStore((state) => state.patchShared);

  const label = t(`theme:groups.${group.key}`);
  const active = group.options.find((option) => isOptionActive(option, shared));

  return (
    <div className="grid gap-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs font-medium text-foreground">{label}</span>
        {/* The live half of the description: which word is currently true.
            Absent when an imported document sits between two options. */}
        <span className="text-xs text-muted-foreground">
          {active ? t(`theme:options.${active.labelKey}`) : null}
        </span>
      </div>

      <div
        role="radiogroup"
        aria-label={label}
        className="flex overflow-hidden rounded-[var(--radius)] border border-border"
      >
        {group.options.map((option) => {
          const selected = option === active;
          return (
            <button
              key={option.labelKey}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => {
                patchShared(option.patch);
              }}
              className={cn(
                'h-7 flex-1 border-e border-border px-2 text-xs transition-colors duration-[var(--speed)] last:border-e-0',
                'focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none',
                selected
                  ? 'bg-primary font-medium text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              {t(`theme:options.${option.labelKey}`)}
            </button>
          );
        })}
      </div>

      {compact ? null : (
        <p className="text-xs text-muted-foreground">{t(`theme:hints.${group.key}`)}</p>
      )}
    </div>
  );
}

export default SegmentedOptions;
