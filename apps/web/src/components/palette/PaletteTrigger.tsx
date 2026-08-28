import { useTranslation } from 'react-i18next';
import { Search } from 'lucide-react';

import { usePaletteStore } from '@/stores/usePaletteStore';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { chordKeys, currentPlatformIsApple } from '@/components/palette/chords';

/**
 * The topbar's palette button — the pointer path to a keyboard feature.
 *
 * A palette reachable only by Ctrl+K is invisible to everyone who has not been
 * told it exists, which is most people on their first day. The tooltip carries
 * the chord, so the button is also how the shortcut gets learned.
 *
 * Registered into `TopbarSlots` (zone `end`, order 10 — the palette's slot in
 * that file's documented ordering) by `PaletteMount`, never by editing
 * `Topbar.tsx`, which belongs to WP1.4.
 *
 * `size-7` matches the dense 48px bar's other icon buttons, per the slot
 * registry's contract.
 */
export default function PaletteTrigger() {
  const { t } = useTranslation(['palette']);
  const openPalette = usePaletteStore((state) => state.openPalette);
  const chord = chordKeys('mod+k', currentPlatformIsApple()).join(' ');

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          data-testid="palette-trigger"
          aria-label={t('palette:trigger')}
          onClick={openPalette}
          className="inline-flex size-7 items-center justify-center rounded-[var(--btn-radius)] text-muted-foreground transition-colors duration-[var(--speed)] hover:bg-accent hover:text-foreground"
        >
          <Search className="size-4" aria-hidden />
        </button>
      </TooltipTrigger>
      <TooltipContent>
        <span className="flex items-center gap-2">
          {t('palette:trigger')}
          {/* Latin keyboard glyphs, never translated — see `chords.ts`. */}
          <span className="font-mono text-[10px] tracking-widest opacity-80">{chord}</span>
        </span>
      </TooltipContent>
    </Tooltip>
  );
}
