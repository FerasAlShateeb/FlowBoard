import { useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { themeColorSchema, type ThemeColorTokens, type ThemeMode } from '@flowboard/shared';

import { cn } from '@/lib/utils';
import { colorToHex, hexToOklchString } from '@/components/theme/color';
import { TOKEN_GROUPS } from '@/components/theme/theme-presets';
import { useThemeStore } from '@/stores/useThemeStore';

/**
 * The 22-token colour editor for ONE of the document's two palettes.
 *
 * TWO INPUTS PER TOKEN, because they answer different questions.
 *
 *   - `<input type="color">` is the browser's picker: fast, visual, and the
 *     only way most people want to nudge a hue. It speaks `#rrggbb` and
 *     NOTHING else, which is the entire reason `components/theme/color.ts`
 *     exists — the value is converted OKLCH → hex on the way in and hex →
 *     OKLCH on the way out, so the document stays in the perceptual space the
 *     presets are authored in instead of silently degrading to sRGB.
 *   - The text field is the escape hatch: it takes whatever the schema takes
 *     (`oklch(…)`, `hex`, `color(…)`) verbatim, so a value pasted from a design
 *     tool survives round-trip unmodified and a colour the picker cannot
 *     represent is still editable.
 *
 * EVERY VALID KEYSTROKE APPLIES. There is no per-row commit: the whole app
 * repaints as you type, and Save is the only thing that persists.
 */

/** One token: swatch, name, picker, raw value. */
function TokenRow({
  mode,
  token,
  value,
}: {
  mode: ThemeMode;
  token: keyof ThemeColorTokens;
  value: string;
}) {
  const { t } = useTranslation(['theme']);
  const patchColors = useThemeStore((state) => state.patchColors);
  const fieldId = useId();

  // The text field is uncontrolled-ish: it holds what was TYPED, which may be a
  // half-finished colour ("#4f4"). Syncing from `value` keeps it honest when
  // the token changes from somewhere else — applying a preset, say.
  const [draft, setDraft] = useState(value);
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setDraft(value);
    setInvalid(false);
  }, [value]);

  const name = t(`theme:tokens.${token}`);
  const hex = colorToHex(value);

  return (
    <div className="flex items-center gap-2">
      {/* The swatch is the token's own value — data, so an inline style. */}
      <span
        aria-hidden
        className="size-5 shrink-0 rounded-[var(--radius)] border border-border"
        style={{ backgroundColor: value }}
      />
      <label htmlFor={fieldId} className="min-w-0 flex-1 truncate text-xs text-foreground">
        {name}
      </label>

      <input
        type="color"
        aria-label={t('theme:editor.pick', { token: name })}
        // A colour the picker cannot represent (an imported `lab()`) still has
        // to give the control SOME value; the swatch above shows the truth.
        value={hex ?? '#000000'}
        onChange={(event) => {
          const next = hexToOklchString(event.target.value);
          if (next) patchColors(mode, { [token]: next });
        }}
        className="size-7 shrink-0 cursor-pointer rounded-[var(--radius)] border border-border bg-surface p-0.5 focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
      />

      <input
        id={fieldId}
        type="text"
        dir="ltr"
        spellCheck={false}
        autoComplete="off"
        aria-label={t('theme:editor.value', { token: name })}
        aria-invalid={invalid}
        value={draft}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          const parsed = themeColorSchema.safeParse(next.trim());
          setInvalid(!parsed.success);
          if (parsed.success) patchColors(mode, { [token]: parsed.data });
        }}
        className={cn(
          'h-7 w-44 shrink-0 rounded-[var(--input-radius)] border bg-surface px-2 font-mono text-xs text-foreground',
          'focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none',
          invalid ? 'border-destructive' : 'border-border',
        )}
      />
    </div>
  );
}

export function TokenEditor({ mode }: { mode: ThemeMode }) {
  const { t } = useTranslation(['theme']);
  const colors = useThemeStore((state) => state.theme[mode]);

  return (
    <section className="grid gap-4" aria-label={t('theme:editor.title')}>
      {TOKEN_GROUPS.map((group) => (
        <div key={group.key} className="grid gap-2">
          <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t(`theme:tokenGroups.${group.key}`)}
          </h3>
          <div className="grid gap-1.5">
            {group.tokens.map((token) => (
              <TokenRow key={token} mode={mode} token={token} value={colors[token]} />
            ))}
          </div>
        </div>
      ))}
      <p className="text-xs text-muted-foreground">{t('theme:editor.hint')}</p>
    </section>
  );
}

export default TokenEditor;
