import { useTranslation } from 'react-i18next';
import { Check } from 'lucide-react';

import { cn } from '@/lib/utils';
import {
  FONT_PRESETS,
  TYPOGRAPHY_GROUPS,
  matchFontPreset,
  type FontPresetDef,
} from '@/components/theme/theme-presets';
import SegmentedOptions from '@/components/theme/SegmentedOptions';
import { useThemeStore } from '@/stores/useThemeStore';

/**
 * The Typography tab: eight font cards, then the size / leading / tracking
 * controls.
 *
 * THE SPECIMEN IS BILINGUAL ("Ag أب") ON PURPOSE. Every stack interposes IBM
 * Plex Sans Arabic after its Latin family, so what a card actually previews is
 * a PAIRING — the Latin face the preset is named for, next to the Arabic face
 * that will render every Arabic string in it. Showing only "Ag" would hide half
 * of the decision from half of the product's users.
 */
function FontCard({
  preset,
  active,
  onApply,
}: {
  preset: FontPresetDef;
  active: boolean;
  onApply: () => void;
}) {
  const { t } = useTranslation(['theme']);

  return (
    <button
      type="button"
      aria-pressed={active}
      aria-label={t('theme:actions.apply', { name: preset.name })}
      onClick={onApply}
      className={cn(
        'grid gap-1.5 rounded-[var(--card-radius)] border bg-surface p-2.5 text-start transition-colors duration-[var(--speed)]',
        'focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none',
        active
          ? 'border-primary ring-2 ring-primary/40'
          : 'border-border hover:border-muted-foreground',
      )}
    >
      <span
        aria-hidden
        // The specimen must be drawn in the CANDIDATE family, which no token
        // holds — the only honest source is the preset's own stack.
        style={{ fontFamily: preset.patch.fontHead, fontWeight: preset.patch.hWeight }}
        className="text-2xl leading-none text-primary"
      >
        {t('theme:typography.specimen')}
      </span>

      <span className="flex items-center justify-between gap-1.5">
        {/* A family name is a BRAND: never translated, in any locale. */}
        <span className="truncate text-xs font-medium text-foreground">{preset.name}</span>
        {active ? <Check aria-hidden className="size-3.5 shrink-0 text-primary" /> : null}
      </span>

      <span className="line-clamp-2 text-xs text-muted-foreground">
        {t(`theme:fonts.${preset.labelKey}`)}
      </span>

      {/* `index.html` requests three families; the rest render from the reader's
          own device or fall through the stack. Saying so beats a card that
          silently previews a font the app cannot load. */}
      {!preset.bundled ? (
        <span className="text-xs text-muted-foreground/80">{t('theme:typography.notLoaded')}</span>
      ) : null}
    </button>
  );
}

export function TypographyPanel() {
  const { t } = useTranslation(['theme']);
  const shared = useThemeStore((state) => state.theme.shared);
  const applyFontPreset = useThemeStore((state) => state.applyFontPreset);

  const active = matchFontPreset(shared);

  return (
    <div className="grid gap-6">
      <section className="grid gap-3" aria-label={t('theme:typography.title')}>
        <div>
          <h2 className="text-sm font-medium text-foreground">{t('theme:typography.title')}</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('theme:typography.description')}
          </p>
        </div>

        <div className="grid gap-[var(--gap)] sm:grid-cols-2 xl:grid-cols-3">
          {FONT_PRESETS.map((preset) => (
            <FontCard
              key={preset.name}
              preset={preset}
              active={active?.name === preset.name}
              onApply={() => {
                applyFontPreset(preset.name);
              }}
            />
          ))}
        </div>

        <p className="text-xs text-muted-foreground">{t('theme:typography.notLoadedHint')}</p>
      </section>

      <section className="grid gap-4" aria-label={t('theme:typography.scale')}>
        <h2 className="text-sm font-medium text-foreground">{t('theme:typography.scale')}</h2>
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {TYPOGRAPHY_GROUPS.map((group) => (
            <SegmentedOptions key={group.key} group={group} />
          ))}
        </div>
      </section>
    </div>
  );
}

export default TypographyPanel;
