import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Check, Download, RotateCcw, Save, SlidersHorizontal, Upload, X } from 'lucide-react';

import { cn } from '@/lib/utils';
import { trackThemeChanged } from '@/lib/telemetry-client';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import PresetPreviewMini from '@/components/theme/PresetPreviewMini';
import SegmentedOptions from '@/components/theme/SegmentedOptions';
import { downloadJson } from '@/components/theme/theme-file';
import {
  COLOR_PRESETS,
  FONT_PRESETS,
  LAYOUT_GROUPS,
  TYPOGRAPHY_GROUPS,
  matchColorPreset,
  matchFontPreset,
} from '@/components/theme/theme-presets';
import { useLayoutStore } from '@/stores/useLayoutStore';
import { useThemeStore, type ThemeImportError } from '@/stores/useThemeStore';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * The Theme Studio DRAWER — the quick surface (Round 2 §Theme D5).
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A 380px end-docked slide-over over a scrim, opened from the topbar's palette
 * icon. It is a faithful port of GameDash's `components/theme/ThemeStudio.tsx`,
 * adapted to FlowBoard's stores, tokens and data modules.
 *
 * ═══ WHY A DRAWER **AND** `/theme` ═════════════════════════════════════════
 *
 * They answer two different questions. "Make the app blue" is a two-click job
 * that should not cost a navigation away from the board you are looking at —
 * and the whole point of a live-applying theme is watching the REAL app change,
 * which a full-page editor covers up. "Which of these 22 tokens is making my
 * charts muddy" is the opposite: it needs a token list, a preview pane and a
 * leave guard, and none of that fits in 380px. So the drawer carries the
 * presets, the font faces and the word-labelled dimension groups; `/theme`
 * keeps the token editor and links back from here ("Advanced editor").
 *
 * ═══ WHY THE DIALOG IS HAND-ROLLED AND NOT `ui/sheet` ══════════════════════
 *
 * `ui/sheet` is a Radix Dialog, and a Radix modal does three things this
 * surface must not: it `aria-hidden`s the rest of the application, it disables
 * pointer events outside itself, and it restores focus by unmounting through a
 * presence animation. The first two fight the drawer's entire reason for
 * existing — the app behind the scrim is the PREVIEW, and a screen-reader user
 * must still be able to hear what the theme they just applied did to the page
 * they were on. So the panel is a plain `<aside role="dialog" aria-modal>` that
 * owns exactly the behaviours it needs: focus on open, a Tab cycle inside the
 * panel, Escape, a scrim click, and unmount-on-close.
 *
 * ═══ THE FOCUS CONTRACT, IN ONE SENTENCE (R2 W3.5) ═════════════════════════
 *
 * **The KEYBOARD is trapped; the POINTER is not.**
 *
 * `aria-modal="true"` is a promise to assistive technology that focus cannot
 * wander out, and the on-panel Tab handler below only keeps that promise for
 * keystrokes that REACH the panel. Focus can be somewhere the handler never
 * sees — on `document.body` after the element holding it unmounted (collapse the
 * import panel while its Cancel button is focused), or inside a portalled
 * subtree that is a DOM sibling of the panel rather than a descendant. From
 * there, one Tab walks straight into the app behind the scrim, and the drawer
 * silently stops being modal while still claiming to be.
 *
 * So a document-level `focusin` puts it back — but ONLY when the focus move came
 * from a key. That exception is the whole design: this drawer exists to be a
 * live preview of the app underneath it, its own e2e spec asserts that the board
 * behind the scrim is still mounted and interactive, and a blanket redirect
 * would turn a preview surface into the pointer-events cage the file opens by
 * rejecting. A pointer gesture may therefore leave focus outside the panel; the
 * NEXT Tab brings it back, because that Tab is keyboard-origin.
 *
 * The redirect also honours DIRECTION — Shift+Tab lands on the panel's last
 * focusable, plain Tab on its first — so the cycle reads the same whether the
 * on-panel handler or this backstop caught it.
 *
 * ═══ THE Z TIER: `z-[120]`, ABOVE THE POPOVER FAMILY (R2 W3.5) ═════════════
 *
 * The app's scale, as it stands:
 *
 * | tier      | who                                                      |
 * |-----------|----------------------------------------------------------|
 * | `z-30`    | the topbar                                               |
 * | `z-50`    | the sidebar                                              |
 * | `z-[100]` | the modal tier — `ui/dialog`, `ui/sheet`, `ui/drawer`, `ui/alert-dialog` and their scrims |
 * | `z-[110]` | the popover family — `ui/tooltip`, `ui/popover`, `ui/select`, `ui/dropdown-menu`, the mention list |
 * | `z-[120]` | **this drawer and its scrim**                            |
 *
 * The popover family sits ABOVE the modal tier on purpose: a `Select` opened
 * inside a `Dialog` has to paint over it. This drawer shipped on the modal tier
 * and inherited that ordering, which is wrong for it — the popover family is
 * PORTALLED TO `document.body`, so a tooltip or dropdown belonging to the app
 * BEHIND the scrim (the topbar's own buttons, a menu left open when the chord
 * fired) painted straight through both the scrim and the panel. A scrim you can
 * see a live dropdown through is not a scrim.
 *
 * Its own tier fixes that, and DOM order is not a workaround for it: a portal
 * appended to `body` after the drawer is later in the document, but z-index
 * beats document order between positioned siblings in the same stacking
 * context, so `z-[110]` loses to `z-[120]` however late it mounts.
 *
 * THE PRICE, STATED SO IT CANNOT BE STUMBLED INTO: a popover-family primitive
 * rendered FROM INSIDE this panel would portal to `body` at `z-[110]` and paint
 * BEHIND the panel that owns it. The drawer renders none today — every control
 * in it is a plain `<button>`, `<input>` or `<textarea>`, and
 * `ThemeStudioDrawer.test.tsx` asserts that as a guard — and one added later
 * must be given `className="z-[130]"` on its content. (`/theme`, which uses the
 * real `Dialog` and `Select`, is unaffected: it is on the ordinary modal tier
 * where the family's `z-[110]` is exactly right.)
 *
 * ═══ WHAT IS LIVE AND WHAT IS SAVED ════════════════════════════════════════
 *
 * Identical to the page, because it is the same store: every click applies
 * immediately and app-wide (`useThemeStore` funnels each mutation through
 * `applyTheme()`), and only **Save** writes `fb-theme-v1`. The drawer has no
 * leave guard of its own — closing it changes nothing, and a reload is what
 * discards an unsaved experiment. That is why Save is disabled until something
 * is actually dirty: an enabled Save on an unchanged document is a button that
 * teaches nothing.
 *
 * ═══ MOTION ═══════════════════════════════════════════════════════════════
 *
 * `fb-drawer-in` on the panel and `fb-scrim-in` on the scrim (W1.5's block at
 * the end of `index.css`). Enter-only, paced by `--speed`, direction-flipped by
 * `<html dir>` through `--fb-drawer-from`, and declared ONLY under
 * `html[data-motion='full']` — so a reduced-motion session runs no animation
 * and there is nothing to switch off here. The classes are therefore applied
 * unconditionally: the gate is CSS's job, not this component's.
 */

type StudioTab = 'colors' | 'typography' | 'layout';

/** Tab order; the id doubles as the `theme:tabs.<id>` key suffix. */
const TABS: readonly StudioTab[] = ['colors', 'typography', 'layout'];

/**
 * Everything the browser puts in the tab order, minus the roving tablist's
 * inactive tabs (they are `tabindex="-1"`, and the `.tabIndex >= 0` filter
 * below is what removes them without naming them).
 */
const FOCUSABLE =
  'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]';

/** Everything in the panel the browser would stop on, in DOM order. */
function focusablesIn(panel: HTMLElement): HTMLElement[] {
  return [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.tabIndex >= 0,
  );
}

/**
 * How focus last moved. See the focus contract in the header: `pointer` is the
 * one source allowed to take focus out of the panel.
 */
interface FocusGesture {
  source: 'pointer' | 'keyboard';
  /** The Shift state of the keystroke — what makes the redirect directional. */
  shiftKey: boolean;
}

/**
 * Surfaces the focus backstop must NEVER pull focus away from.
 *
 * The backstop exists to stop focus WANDERING into the app behind the scrim. A
 * dialog, a sheet or a popover taking focus is not wandering — it is another
 * surface deliberately claiming it, and every one of these portals to `body`, so
 * it is outside the panel by construction and would otherwise look identical to
 * an escape.
 *
 * The case that makes this load-bearing rather than theoretical: `mod+k` is
 * registered with `allowInInputs` and NO overlay gate (`GlobalShortcuts` — a
 * user half-way through typing is exactly who wants to jump somewhere), so the
 * command palette can be opened over this drawer. Without this list the backstop
 * would yank focus straight back out of the palette's input, and the palette
 * would be unusable while the drawer was open.
 *
 * It is also what makes the drawer safe to grow a `Select` or a `Tooltip` later:
 * such a primitive portals out at `z-[110]` (see the z-scale note in the header)
 * and its focus would be left alone by this.
 */
const FOCUS_CLAIMING_SURFACES = [
  '[role="dialog"]',
  '[role="alertdialog"]',
  '[data-slot="dialog-content"]',
  '[data-slot="sheet-content"]',
  '[data-slot="alert-dialog-content"]',
  '[data-slot="drawer-content"]',
  '[data-slot="popover-content"]',
  '[data-slot="select-content"]',
  '[data-slot="dropdown-menu-content"]',
].join(',');

/**
 * Reading direction, from the same `<html dir>` that `lib/lang-policy` stamps
 * before first paint and that the slide keyframe reads through
 * `:where(html[dir='rtl'])`.
 *
 * READ AT KEYDOWN TIME, not subscribed to. Direction only matters at the
 * instant an arrow key is pressed, so a `useLang()` subscription would buy a
 * re-render the panel has no use for — and taking the answer from the DOM
 * guarantees the arrows and the animation can never disagree about which way
 * this session runs.
 */
function isRtlDocument(element: HTMLElement | null): boolean {
  return (element?.ownerDocument ?? document).documentElement.dir === 'rtl';
}

/* -------------------------------------------------------------------------- */
/* Colours                                                                     */
/* -------------------------------------------------------------------------- */

function ColorsTab({ onOpenAdvanced }: { onOpenAdvanced: () => void }) {
  const { t } = useTranslation(['theme']);
  const theme = useThemeStore((state) => state.theme);
  const dark = useThemeStore((state) => state.dark);
  const setDark = useThemeStore((state) => state.setDark);
  const applyPreset = useThemeStore((state) => state.applyPreset);

  // STRUCTURAL, never `theme.themePreset`: the stored label stops being true
  // the moment one token is nudged, and `matchColorPreset` compares all 44
  // colours. Same authority the page's gallery uses, so the two surfaces can
  // never highlight different cards for the same document.
  const active = matchColorPreset(theme);

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-2.5">
        {COLOR_PRESETS.map((preset) => {
          const selected = active?.name === preset.name;
          const name = t(`theme:presets.${preset.labelKey}`);
          return (
            <button
              key={preset.name}
              type="button"
              aria-pressed={selected}
              aria-label={t('theme:actions.apply', { name })}
              onClick={() => {
                applyPreset(preset.name);
                // The IDENTITY (`'Ocean'`), never the localized label — an
                // analytics stream that changes shape with the reader's
                // language cannot be grouped. Same rule as `ColorsPanel`.
                trackThemeChanged(preset.name);
              }}
              className={cn(
                'grid gap-1.5 rounded-[var(--card-radius)] border bg-surface p-2 text-start transition-colors duration-[var(--speed)]',
                'focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none',
                selected
                  ? 'border-primary ring-2 ring-primary/40'
                  : 'border-border hover:border-muted-foreground',
              )}
            >
              <PresetPreviewMini preset={preset} dark={dark} />

              <span className="flex items-center justify-between gap-1">
                <span className="truncate text-xs font-medium text-foreground">{name}</span>
                {selected ? <Check aria-hidden className="size-3.5 shrink-0 text-primary" /> : null}
              </span>

              <span className="flex gap-1">
                {preset.swatches.map((color, index) => (
                  <span
                    key={index}
                    aria-hidden
                    className="size-3 rounded-full border border-border"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </span>
            </button>
          );
        })}
      </div>

      {/* Light / Dark. It belongs in the drawer even though the topbar has the
          same toggle: the cards above are painted in the CURRENT mode, so the
          switch is what shows the other half of every preset. */}
      <div className="grid gap-1.5">
        <span className="text-xs font-medium text-foreground">{t('theme:studio.appearance')}</span>
        <div
          role="radiogroup"
          aria-label={t('theme:studio.appearance')}
          className="flex overflow-hidden rounded-[var(--radius)] border border-border"
        >
          {([false, true] as const).map((option) => (
            <button
              key={option ? 'dark' : 'light'}
              type="button"
              role="radio"
              aria-checked={dark === option}
              onClick={() => {
                setDark(option);
                // `'light'` / `'dark'` — the same two stable identities the
                // topbar's toggle emits, so both entry points answer one
                // question ("what appearance did people choose") in one stream.
                trackThemeChanged(option ? 'dark' : 'light');
              }}
              className={cn(
                'h-7 flex-1 border-e border-border px-2 text-xs transition-colors duration-[var(--speed)] last:border-e-0',
                'focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none',
                dark === option
                  ? 'bg-primary font-medium text-primary-foreground'
                  : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
              )}
            >
              {t(option ? 'theme:mode.dark' : 'theme:mode.light')}
            </button>
          ))}
        </div>
      </div>

      {/* The way out to the 22-token editor. A BUTTON, not an anchor: the
          drawer is mounted outside router context (see `ThemeStudioSlot`), so
          the navigation is pushed into the router object rather than rendered
          as a `<Link>` — the same seam the command palette uses. */}
      <button
        type="button"
        onClick={onOpenAdvanced}
        className={cn(
          'flex items-center gap-2 rounded-[var(--radius)] border border-border px-2 py-2 text-start text-xs transition-colors duration-[var(--speed)]',
          'hover:bg-accent hover:text-accent-foreground',
          'focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none',
        )}
      >
        <SlidersHorizontal aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0">
          <span className="block font-medium text-foreground">{t('theme:studio.advanced')}</span>
          <span className="block text-muted-foreground">{t('theme:studio.advancedHint')}</span>
        </span>
      </button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Typography                                                                  */
/* -------------------------------------------------------------------------- */

function TypographyTab() {
  const { t } = useTranslation(['theme']);
  const shared = useThemeStore((state) => state.theme.shared);
  const applyFontPreset = useThemeStore((state) => state.applyFontPreset);

  const active = matchFontPreset(shared);

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-2">
        {FONT_PRESETS.map((preset) => {
          const selected = active?.name === preset.name;
          return (
            <button
              key={preset.name}
              type="button"
              aria-pressed={selected}
              // A family name is a BRAND: never translated, in any locale.
              aria-label={t('theme:actions.apply', { name: preset.name })}
              onClick={() => {
                applyFontPreset(preset.name);
              }}
              className={cn(
                'grid gap-1 rounded-[var(--card-radius)] border bg-surface p-2 text-start transition-colors duration-[var(--speed)]',
                'focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none',
                selected
                  ? 'border-primary ring-2 ring-primary/40'
                  : 'border-border hover:border-muted-foreground',
              )}
            >
              {/* Bilingual specimen: every stack interposes IBM Plex Sans
                  Arabic after its Latin family, so a card previews a PAIRING.
                  Drawn in the candidate family, which no token holds — the
                  preset's own stack is the only honest source. */}
              <span
                aria-hidden
                style={{ fontFamily: preset.patch.fontHead, fontWeight: preset.patch.hWeight }}
                className="text-xl leading-none text-primary"
              >
                {t('theme:typography.specimen')}
              </span>

              <span className="flex items-center justify-between gap-1">
                <span className="truncate text-xs font-medium text-foreground">{preset.name}</span>
                {selected ? <Check aria-hidden className="size-3.5 shrink-0 text-primary" /> : null}
              </span>
            </button>
          );
        })}
      </div>

      <div className="grid gap-3.5">
        {TYPOGRAPHY_GROUPS.map((group) => (
          <SegmentedOptions key={group.key} group={group} compact />
        ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Layout                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Every shared dimension the studio exposes — corners, density, spacing,
 * sidebar and content width, elevation, motion speed and chart style.
 *
 * GameDash renders density and chart style through a separate `EnumGroup`
 * because its data module keeps them outside `LAYOUT_GROUPS`. FlowBoard's does
 * not: `theme-presets.ts` models both as ordinary `DimensionGroup`s whose
 * `patch` happens to carry an enum, so one loop covers all eight and there is
 * no second control to keep in sync.
 */
function LayoutTab() {
  return (
    <div className="grid gap-3.5">
      {LAYOUT_GROUPS.map((group) => (
        <SegmentedOptions key={group.key} group={group} compact />
      ))}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Import                                                                      */
/* -------------------------------------------------------------------------- */

/**
 * The inline import panel — a file picker AND a paste box, between the tab
 * panel and the footer.
 *
 * INLINE RATHER THAN A DIALOG (which is what `/theme` uses): a modal on top of
 * a modal would have to steal focus back from the drawer and hand it back on
 * close, and the drawer has the room. The VALIDATION is the store's
 * (`importTheme` → `themeDocumentSchema.safeParse`), which returns a CODE, and
 * the message is chosen here — the store is not the place that knows which
 * language the reader speaks. The error lands INLINE, next to the input that
 * produced it, not in a toast that vanishes while you hunt for the typo.
 */
function ImportPanel({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation(['theme', 'common']);
  const importTheme = useThemeStore((state) => state.importTheme);

  const [text, setText] = useState('');
  const [error, setError] = useState<ThemeImportError | 'file' | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const submit = (json: string) => {
    const result = importTheme(json);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    toast.success(t('theme:toasts.imported'));
    onClose();
  };

  const readFile = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      submit(String(reader.result ?? ''));
    };
    reader.onerror = () => {
      setError('file');
    };
    reader.readAsText(file);
  };

  return (
    <div className="grid shrink-0 gap-2 border-t border-border p-4 pb-0">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-medium text-foreground">{t('theme:import.title')}</span>
        <button
          type="button"
          className="text-xs text-muted-foreground hover:text-foreground"
          onClick={onClose}
        >
          {t('common:actions.cancel')}
        </button>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".json,application/json"
        className="sr-only"
        aria-label={t('theme:import.fileInput')}
        onChange={(event) => {
          readFile(event.target.files?.[0]);
          // Reset, or choosing the SAME file twice fires no change event —
          // which reads as "the button stopped working" after a failed import.
          event.target.value = '';
        }}
      />

      <Button
        type="button"
        variant="outline"
        size="sm"
        className="w-full"
        onClick={() => fileRef.current?.click()}
      >
        <Upload aria-hidden />
        {t('theme:import.chooseFile')}
      </Button>

      <Textarea
        // A theme document is JSON: Latin, and read left-to-right even in an
        // Arabic session, exactly as `/theme`'s dialog does it.
        dir="ltr"
        rows={4}
        spellCheck={false}
        aria-invalid={error !== null}
        aria-label={t('theme:import.pasteLabel')}
        placeholder={t('theme:import.pastePlaceholder')}
        value={text}
        onChange={(event) => {
          setText(event.target.value);
          setError(null);
        }}
        // `field-sizing-fixed` overrides the primitive's grow-with-content
        // default: a textarea that expands while you paste a 4KB theme would
        // push the footer off the bottom of the drawer.
        className="field-sizing-fixed h-24 resize-none font-mono text-xs"
      />

      {error ? (
        <p role="alert" className="text-xs text-destructive">
          {t(`theme:import.errors.${error}`)}
        </p>
      ) : null}

      <Button
        type="button"
        size="sm"
        className="w-full"
        disabled={text.trim().length === 0}
        onClick={() => {
          submit(text);
        }}
      >
        {/* "Import theme", not `import.submit` ("Import") — the footer toggle
            two rows below already owns that word. */}
        {t('theme:studio.applyImport')}
      </Button>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* The drawer                                                                  */
/* -------------------------------------------------------------------------- */

export function ThemeStudioDrawer({ navigate }: { navigate: (to: string) => void }) {
  /**
   * Subscribing to `useTranslation` HERE is what repaints the whole panel on a
   * language switch — every label below resolves through a key, and the panels
   * are children of this component rather than of the topbar.
   */
  const { t } = useTranslation(['theme', 'common']);

  const open = useLayoutStore((state) => state.themeStudioOpen);
  const setOpen = useLayoutStore((state) => state.setThemeStudioOpen);

  const dirty = useThemeStore((state) => state.dirty);
  const save = useThemeStore((state) => state.save);
  const resetToDefault = useThemeStore((state) => state.resetToDefault);
  const exportTheme = useThemeStore((state) => state.exportTheme);

  const [tab, setTab] = useState<StudioTab>('colors');
  const [importOpen, setImportOpen] = useState(false);

  const asideRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);
  /**
   * Seeded as `keyboard`, so the very first focus move after an open is trapped
   * even if nothing has been pressed yet. A pointer gesture downgrades it, and
   * the next key upgrades it back.
   */
  const gestureRef = useRef<FocusGesture>({ source: 'keyboard', shiftKey: false });

  /**
   * Focus the close button when the panel opens.
   *
   * THE CLOSE BUTTON AND NOT THE FIRST TAB, deliberately: it is the way OUT,
   * and a keyboard user who opened a modal by accident should not have to hunt
   * for the exit. It is also the first element in the panel, so a single Tab
   * lands on the tablist — nothing is skipped by starting there.
   *
   * THE IMPORT PANEL IS COLLAPSED ON EVERY OPEN, so the drawer never reopens
   * mid-flow with a stale textarea from a previous session. The selected TAB is
   * deliberately NOT reset the same way: the panel component itself stays
   * mounted (only its DOM unmounts), and someone who was working through the
   * Layout groups a minute ago is almost certainly coming back to them.
   */
  useEffect(() => {
    if (!open) return;
    setImportOpen(false);
    closeRef.current?.focus();
  }, [open]);

  /**
   * Lock the document scroll while the panel is up — the same thing `AppShell`
   * does for the mobile nav drawer, and for the same reason: a wheel or a
   * touch-drag over a scrim must not scroll the page underneath it. Restored on
   * close by the cleanup, which always runs because the panel UNMOUNTS.
   */
  useEffect(() => {
    if (!open) return undefined;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = '';
    };
  }, [open]);

  /**
   * THE FOCUS BACKSTOP — the document-level half of the contract in the header.
   *
   * Three listeners, all on the document because all three describe things that
   * happen OUTSIDE the panel:
   *
   *  - `pointerdown` / `keydown` (CAPTURE, so they run before any handler can
   *    stop propagation) record only how the last gesture arrived. They are
   *    deliberately not state: nothing renders from this, and a `setState` per
   *    keystroke on a panel with eight live theme controls would be a re-render
   *    per keystroke.
   *  - `focusin` acts. It bubbles (unlike `focus`), so it is the one event that
   *    sees focus landing anywhere in the document.
   *
   * The three early returns are the whole policy:
   *
   *  1. Focus that landed INSIDE the panel is the normal case and the one this
   *     must never touch — including the open effect's own `closeRef.focus()`
   *     and every internal Tab.
   *  2. Focus claimed by ANOTHER modal or popover
   *     ({@link FOCUS_CLAIMING_SURFACES}) is not wandering, it is a surface
   *     taking what it is entitled to. The palette is the live case: `mod+k` has
   *     no overlay gate, so it can open over this drawer.
   *  3. Focus that landed outside after a POINTER gesture is the deliberate
   *     exception: the app behind the scrim is the preview, and its own e2e spec
   *     drives it.
   *
   * Everything else is a keyboard escape, and it is wrapped in the same
   * direction the on-panel handler would have wrapped it.
   */
  useEffect(() => {
    if (!open) return undefined;
    const panel = asideRef.current;
    if (!panel) return undefined;
    const doc = panel.ownerDocument;

    const onPointerDown = (): void => {
      gestureRef.current = { source: 'pointer', shiftKey: false };
    };
    const onKeyDownCapture = (event: KeyboardEvent): void => {
      gestureRef.current = { source: 'keyboard', shiftKey: event.shiftKey };
    };
    const onFocusIn = (event: FocusEvent): void => {
      const target = event.target;
      if (target instanceof Node && panel.contains(target)) return;
      if (target instanceof Element && target.closest(FOCUS_CLAIMING_SURFACES) !== null) return;
      if (gestureRef.current.source !== 'keyboard') return;

      const items = focusablesIn(panel);
      const landing = gestureRef.current.shiftKey ? items[items.length - 1] : items[0];
      // `closeRef` is the fallback for the impossible case of a panel with
      // nothing focusable in it — never a silent no-op, which would leave focus
      // outside an `aria-modal` surface.
      (landing ?? closeRef.current)?.focus();
    };

    doc.addEventListener('pointerdown', onPointerDown, true);
    doc.addEventListener('keydown', onKeyDownCapture, true);
    doc.addEventListener('focusin', onFocusIn);
    return () => {
      doc.removeEventListener('pointerdown', onPointerDown, true);
      doc.removeEventListener('keydown', onKeyDownCapture, true);
      doc.removeEventListener('focusin', onFocusIn);
    };
  }, [open]);

  // UNMOUNT-ON-CLOSE, after the hooks (rules of hooks) and before any DOM is
  // built. A closed drawer is not a hidden drawer: no scrim, no panel, no
  // focusable element and nothing for a screen reader to walk into — which is
  // what makes a `display:none` panel the wrong shape for a modal.
  if (!open) return null;

  const close = () => {
    setOpen(false);
  };

  /**
   * The roving tablist's arrow keys — WAI-ARIA's tabs pattern, wrapping at
   * both ends.
   *
   * DIRECTION-AWARE, WHICH THE GAMEDASH ORIGINAL IS NOT. The APG defines the
   * keys by their PHYSICAL direction: in a right-to-left interface the tabs are
   * laid out end-to-start, so ArrowRight moves to the PREVIOUS tab and
   * ArrowLeft to the next. Porting the LTR-only mapping would have given an
   * Arabic reader a tablist whose arrows walk the wrong way — the exact class
   * of bug the RTL sweep exists to catch.
   */
  const onTabKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>, index: number) => {
    if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
    event.preventDefault();
    const forward = event.key === (isRtlDocument(asideRef.current) ? 'ArrowLeft' : 'ArrowRight');
    const next = (index + (forward ? 1 : -1) + TABS.length) % TABS.length;
    const id = TABS[next];
    if (!id) return;
    setTab(id);
    tabRefs.current[next]?.focus();
  };

  /**
   * The panel's own key handling: Escape closes, Tab cycles INSIDE the drawer.
   *
   * Escape is handled here as well as in `closeAllOverlays` (which `AppShell`'s
   * global listener calls) so the drawer answers the key even when it is
   * rendered on its own — and so the behaviour is testable without booting the
   * shell. The event is deliberately NOT stopped: a global Escape closing every
   * modal at once is the app's contract, and this panel is one of them.
   *
   * The Tab cycle is what makes `aria-modal="true"` honest. It is a WRAP, not a
   * cage: nothing is disabled outside the panel, and the app behind the scrim
   * stays fully readable to a screen reader — which is the point of a live
   * theme preview.
   */
  const onKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      close();
      return;
    }
    if (event.key !== 'Tab') return;

    const panel = asideRef.current;
    if (!panel) return;

    const items = focusablesIn(panel);
    const first = items[0];
    const last = items[items.length - 1];
    if (!first || !last) return;

    const active = panel.ownerDocument.activeElement;
    if (event.shiftKey && (active === first || !panel.contains(active))) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && active === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      {/* The drawer's OWN tier (z-120 — above the popover family's z-110; see
          the z-scale table in the header). The scrim and the panel share it and
          the panel wins by DOM order.
          `aria-hidden` + a real button: it is a dismiss surface, not content. */}
      <button
        type="button"
        tabIndex={-1}
        aria-hidden
        data-testid="theme-studio-scrim"
        className="fb-scrim-in fixed inset-0 z-[120] bg-black/40"
        onClick={close}
      />

      <aside
        ref={asideRef}
        role="dialog"
        aria-modal="true"
        aria-label={t('theme:title')}
        data-testid="theme-studio"
        onKeyDown={onKeyDown}
        className="fb-drawer-in fixed inset-y-0 end-0 z-[120] flex w-[380px] max-w-full flex-col border-s border-border bg-surface text-foreground shadow-[var(--shadow-2)]"
      >
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-4">
          <h2 className="truncate text-sm font-semibold">{t('theme:title')}</h2>
          <button
            ref={closeRef}
            type="button"
            aria-label={t('theme:studio.close')}
            onClick={close}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-[var(--btn-radius)] text-muted-foreground transition-colors duration-[var(--speed)] hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none"
          >
            <X aria-hidden className="size-4" />
          </button>
        </header>

        <div
          role="tablist"
          aria-label={t('theme:studio.tabsLabel')}
          className="flex shrink-0 gap-1 border-b border-border px-3 pt-2"
        >
          {TABS.map((id, index) => {
            const selected = tab === id;
            return (
              <button
                key={id}
                ref={(element) => {
                  tabRefs.current[index] = element;
                }}
                type="button"
                role="tab"
                id={`theme-studio-tab-${id}`}
                aria-selected={selected}
                aria-controls={`theme-studio-panel-${id}`}
                // ONE stop in the tab order for the whole tablist; the arrows
                // move between the tabs. That is the APG's roving tabindex.
                tabIndex={selected ? 0 : -1}
                onClick={() => {
                  setTab(id);
                }}
                onKeyDown={(event) => {
                  onTabKeyDown(event, index);
                }}
                className={cn(
                  'rounded-t-[var(--radius)] border-b-2 px-3 py-2 text-xs font-medium transition-colors duration-[var(--speed)]',
                  'focus-visible:ring-2 focus-visible:ring-ring/60 focus-visible:outline-none',
                  selected
                    ? 'border-primary text-primary'
                    : 'border-transparent text-muted-foreground hover:text-foreground',
                )}
              >
                {t(`theme:tabs.${id}`)}
              </button>
            );
          })}
        </div>

        <div
          role="tabpanel"
          id={`theme-studio-panel-${tab}`}
          aria-labelledby={`theme-studio-tab-${tab}`}
          className="min-h-0 flex-1 overflow-y-auto p-4"
        >
          {tab === 'colors' ? (
            <ColorsTab
              onOpenAdvanced={() => {
                navigate('/theme');
                close();
              }}
            />
          ) : null}
          {tab === 'typography' ? <TypographyTab /> : null}
          {tab === 'layout' ? <LayoutTab /> : null}
        </div>

        {importOpen ? (
          <ImportPanel
            onClose={() => {
              setImportOpen(false);
            }}
          />
        ) : null}

        {/* ═══ WHY 2×2 AND NOT ONE ROW OF FOUR (W3.2) ═══════════════════════
            The bar shipped as `grid-cols-4`, which gave each of the four
            actions ~108px inside a 380px drawer. English fits that; Arabic does
            not — `theme:actions.reset` is «إعادة تعيين», and the RTL pass
            caught it rendering as «إعادة …», a button whose label no longer
            says what it does.

            THE THREE FIXES, AND WHY THIS ONE. (a) Shortening the Arabic is
            translating to fit a box rather than to say the thing, and it only
            buys headroom until the next locale — German's "Zurücksetzen" is
            longer still. (b) Icon-only buttons with tooltips lose the label for
            touch and for anyone who does not hover, on a bar where two of the
            four actions (Reset, Import) are destructive-ish enough to deserve
            a word. (c) A locale-conditional column count makes the layout a
            function of the language, so a bug can only be seen in one of them.

            Two rows of two is the layout that needs no locale to be correct:
            each button gets ~166px, every label survives in both catalogs, and
            GameDash's footer anatomy — one bordered action bar, primary first,
            reading order Save → Reset → Export → Import — is untouched. The
            grid flows in the writing direction, so RTL mirrors it for free.
            `truncate` stays on every label as the last line of defence. */}
        <footer className="grid shrink-0 grid-cols-2 gap-2 border-t border-border p-4">
          <Button
            type="button"
            size="sm"
            className="min-w-0"
            disabled={!dirty}
            onClick={() => {
              save();
              // Reports the preset the SAVED document matches — `Custom` when
              // it matches none, which is itself the interesting answer. Same
              // event and same shape as `/theme`'s Save.
              trackThemeChanged(matchColorPreset(useThemeStore.getState().theme)?.name ?? 'Custom');
              toast.success(t('theme:toasts.saved'));
            }}
          >
            <Save aria-hidden />
            <span className="truncate">{t('theme:actions.save')}</span>
          </Button>

          <Button
            type="button"
            size="sm"
            variant="outline"
            className="min-w-0"
            onClick={() => {
              resetToDefault();
              toast.success(t('theme:toasts.reset'));
            }}
          >
            <RotateCcw aria-hidden />
            <span className="truncate">{t('theme:actions.reset')}</span>
          </Button>

          <Button
            type="button"
            size="sm"
            variant="outline"
            className="min-w-0"
            onClick={() => {
              // `downloadJson` answers `false` where the environment cannot
              // download (jsdom, an ancient browser) instead of throwing.
              if (downloadJson(exportTheme())) toast.success(t('theme:toasts.exported'));
            }}
          >
            <Download aria-hidden />
            <span className="truncate">{t('theme:actions.export')}</span>
          </Button>

          <Button
            type="button"
            size="sm"
            variant="outline"
            className="min-w-0"
            aria-expanded={importOpen}
            onClick={() => {
              setImportOpen((value) => !value);
            }}
          >
            <Upload aria-hidden />
            <span className="truncate">{t('theme:actions.import')}</span>
          </Button>
        </footer>
      </aside>
    </>
  );
}

export default ThemeStudioDrawer;
