import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import type { ThemeMode } from '@flowboard/shared';

import { cn } from '@/lib/utils';
import { trackThemeChanged } from '@/lib/telemetry-client';
import { COLOR_PRESETS, matchColorPreset } from '@/components/theme/theme-presets';
import PresetCard from '@/components/theme/PresetCard';
import TokenEditor from '@/components/theme/TokenEditor';
import { useThemeStore } from '@/stores/useThemeStore';

/**
 * The Colours tab: the preset gallery on top, the 22-token editor under it.
 *
 * THE ACTIVE CARD IS RESOLVED STRUCTURALLY, not from `theme.themePreset`.
 * `matchColorPreset` compares all 44 colours, so the ring means what it looks
 * like it means, and an edited palette correctly shows "Custom".
 *
 * Not because the enum is too narrow to hold the answer — WP4.7 widened
 * `themePresetSchema` to all eight names, and a document does record
 * `'Ocean'` — but because a stored LABEL stops being true the moment someone
 * nudges one token, while a structural comparison cannot.
 */
export function ColorsPanel() {
  const { t } = useTranslation(['theme']);
  const theme = useThemeStore((state) => state.theme);
  const dark = useThemeStore((state) => state.dark);
  const applyPreset = useThemeStore((state) => state.applyPreset);

  /**
   * WHICH PALETTE THE EDITOR EDITS — independent of which one is on screen.
   * A document carries both, and a preset is only finished when both are, so
   * the editor must be able to reach the palette you are not looking at.
   * It STARTS on the visible one, because that is what people expect.
   */
  const [mode, setMode] = useState<ThemeMode>(dark ? 'dark' : 'light');

  const activePreset = matchColorPreset(theme);
  const viewing: ThemeMode = dark ? 'dark' : 'light';

  return (
    <div className="grid gap-6">
      <section className="grid gap-3" aria-label={t('theme:gallery.title')}>
        <div>
          <h2 className="text-sm font-medium text-foreground">{t('theme:gallery.title')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {activePreset ? t('theme:gallery.description') : t('theme:gallery.customHint')}
          </p>
        </div>

        <div className="grid gap-[var(--gap)] sm:grid-cols-2 xl:grid-cols-3">
          {COLOR_PRESETS.map((preset) => (
            <PresetCard
              key={preset.name}
              preset={preset}
              active={activePreset?.name === preset.name}
              onApply={() => {
                applyPreset(preset.name);
                // The event carries the preset IDENTITY (`'Ocean'`), never the
                // localized card label — an analytics stream that changes shape
                // with the reader's language cannot be grouped.
                trackThemeChanged(preset.name);
                toast.success(
                  t('theme:toasts.presetApplied', {
                    name: t(`theme:presets.${preset.labelKey}`),
                  }),
                );
              }}
            />
          ))}
        </div>
      </section>

      <section className="grid gap-3">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-medium text-foreground">{t('theme:editor.title')}</h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('theme:editor.description', { mode: t(`theme:mode.${mode}`) })}
            </p>
          </div>

          {/* Light | Dark — a radiogroup, like every other segmented control
              in the studio. */}
          <div
            role="radiogroup"
            aria-label={t('theme:mode.label')}
            className="flex overflow-hidden rounded-[var(--radius)] border border-border"
          >
            {(['light', 'dark'] as const).map((option) => (
              <button
                key={option}
                type="button"
                role="radio"
                aria-checked={mode === option}
                onClick={() => {
                  setMode(option);
                }}
                className={cn(
                  'h-7 border-e border-border px-3 text-xs transition-colors duration-[var(--speed)] last:border-e-0',
                  'focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none',
                  mode === option
                    ? 'bg-primary font-medium text-primary-foreground'
                    : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
                )}
              >
                {t(`theme:mode.${option}`)}
              </button>
            ))}
          </div>
        </div>

        {/* Editing the palette you cannot see is legitimate and confusing in
            equal measure, so it says so. */}
        {mode !== viewing ? (
          <p className="rounded-[var(--radius)] border border-border bg-secondary px-2 py-1.5 text-xs text-muted-foreground">
            {t('theme:mode.hint', { viewing: t(`theme:mode.${viewing}`) })}
          </p>
        ) : null}

        <TokenEditor mode={mode} />
      </section>
    </div>
  );
}

export default ColorsPanel;
