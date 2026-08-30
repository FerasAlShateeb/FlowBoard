// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import '@/i18n';
import ThemeStudioDrawer from '@/components/theme/ThemeStudioDrawer';
import ThemeStudioSlot from '@/components/theme/ThemeStudioSlot';
import { COLOR_PRESETS, matchColorPreset } from '@/components/theme/theme-presets';
import { THEME_STORAGE_KEY } from '@/components/theme/theme-storage';
import { DEFAULT_THEME } from '@/components/theme/theme-tokens';
import { TooltipProvider } from '@/components/ui/tooltip';
import { TopbarSlotZone, __resetTopbarSlotsForTests } from '@/components/layout/TopbarSlots';
import { useLayoutStore } from '@/stores/useLayoutStore';
import { useThemeStore } from '@/stores/useThemeStore';

/**
 * The Theme Studio DRAWER, driven the way a person drives it: open it, walk the
 * tabs with the arrow keys, click a preset, save.
 *
 * WHAT THIS SUITE IS REALLY GUARDING is the a11y contract that a hand-rolled
 * dialog has to earn for itself, because no library is providing it — focus on
 * open, Escape, a scrim that dismisses, a roving tablist that respects reading
 * direction, and an UNMOUNT rather than a hidden panel. Those are the four
 * things §G of the checklist names, and every one of them is a behaviour that
 * silently disappears in a refactor unless something asserts it.
 *
 * jsdom has no layout engine and no CSS animation, so the motion assertions are
 * about the CLASSES being applied. Whether they animate is `index.css`'s
 * `data-motion` gate, tested where it lives.
 *
 * Testing Library only auto-registers its cleanup with `globals: true`, and this
 * workspace deliberately does not (see `vitest.config.ts`).
 */

// `ThemeStudioSlot` reaches the real router singleton for its navigation seam.
// The slot test only cares that the button mounts and opens the drawer, so the
// module is stubbed rather than booting `routes/index.tsx` into jsdom.
vi.mock('@/components/palette/app-router', () => ({ navigateApp: vi.fn() }));

const OCEAN = COLOR_PRESETS.find((preset) => preset.name === 'Ocean');
if (!OCEAN) throw new Error('the Ocean preset fixture is missing');

/** Opens the drawer and renders it, with a stub for the router seam. */
function renderDrawer({ open = true }: { open?: boolean } = {}) {
  const navigate = vi.fn();
  useLayoutStore.setState({ themeStudioOpen: open });
  return { navigate, ...render(<ThemeStudioDrawer navigate={navigate} />) };
}

const panel = () => screen.getByRole('dialog', { name: 'Theme Studio' });
const tab = (name: string) => screen.getByRole('tab', { name });
const footer = () => within(panel()).getByRole('button', { name: 'Save' }).closest('footer');

beforeEach(() => {
  const store = useThemeStore.getState();
  store.resetToDefault();
  store.save();
  // Dark is the product default and therefore what the drawer opens on.
  store.setDark(true);
  useLayoutStore.setState({ themeStudioOpen: false });
  document.documentElement.dir = 'ltr';
});

afterEach(() => {
  cleanup();
  __resetTopbarSlotsForTests();
  vi.restoreAllMocks();
  document.documentElement.dir = 'ltr';
  document.body.style.overflow = '';
  useLayoutStore.setState({ themeStudioOpen: false });
});

describe('opening and dismissing', () => {
  it('renders NOTHING while closed — the panel is unmounted, not hidden', () => {
    const { container } = renderDrawer({ open: false });

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('unmounts the panel and the scrim when the close button is used', () => {
    renderDrawer();
    expect(panel()).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Close Theme Studio' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByTestId('theme-studio-scrim')).not.toBeInTheDocument();
    expect(useLayoutStore.getState().themeStudioOpen).toBe(false);
  });

  it('closes on a click on the scrim', () => {
    renderDrawer();

    fireEvent.click(screen.getByTestId('theme-studio-scrim'));

    expect(useLayoutStore.getState().themeStudioOpen).toBe(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes on Escape, without the shell listening', () => {
    renderDrawer();

    fireEvent.keyDown(panel(), { key: 'Escape' });

    expect(useLayoutStore.getState().themeStudioOpen).toBe(false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('closes with the app-wide `closeAllOverlays` — the global Escape path', () => {
    renderDrawer();

    act(() => {
      useLayoutStore.getState().closeAllOverlays();
    });

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('locks the document scroll while it is up, and gives it back', () => {
    renderDrawer();
    expect(document.body.style.overflow).toBe('hidden');

    fireEvent.click(screen.getByTestId('theme-studio-scrim'));

    expect(document.body.style.overflow).toBe('');
  });
});

describe('the dialog contract', () => {
  it('is a labelled modal dialog', () => {
    renderDrawer();

    const dialog = panel();
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog.tagName).toBe('ASIDE');
  });

  it('puts focus on the close button when it opens — the way out first', () => {
    renderDrawer();

    expect(screen.getByRole('button', { name: 'Close Theme Studio' })).toHaveFocus();
  });

  it('cycles Tab inside the panel instead of escaping into the app behind it', () => {
    renderDrawer();
    const close = screen.getByRole('button', { name: 'Close Theme Studio' });

    // Shift+Tab from the first focusable wraps to the last — the Import button.
    fireEvent.keyDown(panel(), { key: 'Tab', shiftKey: true });

    expect(close).not.toHaveFocus();
    expect(within(panel()).getByRole('button', { name: 'Import' })).toHaveFocus();
  });

  it('reopens with the import panel collapsed, but on the tab you left', () => {
    renderDrawer();
    fireEvent.click(within(panel()).getByRole('button', { name: 'Import' }));
    fireEvent.click(tab('Layout'));
    fireEvent.click(screen.getByRole('button', { name: 'Close Theme Studio' }));

    act(() => {
      useLayoutStore.getState().setThemeStudioOpen(true);
    });

    // A half-typed import is never resurrected…
    expect(screen.queryByLabelText('Theme JSON')).not.toBeInTheDocument();
    // …but the section someone was working in is where they come back to.
    expect(tab('Layout')).toHaveAttribute('aria-selected', 'true');
  });

  /**
   * THE KEYBOARD IS TRAPPED; THE POINTER IS NOT (R2 W3.5).
   *
   * The on-panel Tab handler only fires for keystrokes that reach the panel, so
   * focus parked outside it — on `document.body`, or in a portalled subtree —
   * walked straight into the app on the next Tab, while `aria-modal="true"` went
   * on claiming otherwise. The document-level backstop closes that, and it is
   * gated on the gesture SOURCE so the live-preview contract survives: this
   * drawer exists to be looked through, and `e2e/tests/theme-drawer.spec.ts`
   * drives the board behind it.
   *
   * `outside` stands in for that app: a real focusable element that is a sibling
   * of the panel, which is exactly what a stray Tab would land on.
   */
  describe('the focus backstop', () => {
    function withOutsideButton(): HTMLButtonElement {
      const outside = document.createElement('button');
      outside.textContent = 'a control in the app behind the scrim';
      document.body.append(outside);
      return outside;
    }

    it('pulls a KEYBOARD-driven focus escape back to the first focusable', () => {
      renderDrawer();
      const outside = withOutsideButton();

      // A Tab that the panel's own handler never saw — focus was not in it.
      fireEvent.keyDown(document, { key: 'Tab' });
      act(() => {
        outside.focus();
      });

      expect(outside).not.toHaveFocus();
      expect(screen.getByRole('button', { name: 'Close Theme Studio' })).toHaveFocus();
      outside.remove();
    });

    it('respects DIRECTION — Shift+Tab lands on the last focusable, not the first', () => {
      renderDrawer();
      const outside = withOutsideButton();

      fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
      act(() => {
        outside.focus();
      });

      expect(within(panel()).getByRole('button', { name: 'Import' })).toHaveFocus();
      outside.remove();
    });

    it('leaves a POINTER-driven focus move alone — the app behind it is the preview', () => {
      renderDrawer();
      const outside = withOutsideButton();

      fireEvent.pointerDown(outside);
      act(() => {
        outside.focus();
      });

      expect(outside).toHaveFocus();
      outside.remove();
    });

    it('brings focus back on the NEXT Tab after a pointer interaction', () => {
      renderDrawer();
      const clicked = withOutsideButton();
      const nextInTabOrder = withOutsideButton();

      fireEvent.pointerDown(clicked);
      act(() => {
        clicked.focus();
      });
      expect(clicked).toHaveFocus();

      // The pointer put focus out there and it was allowed to stay. A KEY is
      // what puts it back — the Tab that would have walked further into the app.
      fireEvent.keyDown(document, { key: 'Tab' });
      act(() => {
        nextInTabOrder.focus();
      });

      expect(nextInTabOrder).not.toHaveFocus();
      expect(screen.getByRole('button', { name: 'Close Theme Studio' })).toHaveFocus();
      clicked.remove();
      nextInTabOrder.remove();
    });

    it('never fights focus moving WITHIN the panel', () => {
      renderDrawer();
      const importButton = within(panel()).getByRole('button', { name: 'Import' });

      fireEvent.keyDown(document, { key: 'Tab' });
      act(() => {
        importButton.focus();
      });

      expect(importButton).toHaveFocus();
    });

    it('stops listening once the drawer closes', () => {
      renderDrawer();
      const outside = withOutsideButton();

      act(() => {
        useLayoutStore.getState().setThemeStudioOpen(false);
      });
      fireEvent.keyDown(document, { key: 'Tab' });
      act(() => {
        outside.focus();
      });

      expect(outside).toHaveFocus();
      outside.remove();
    });

    /**
     * THE BACKSTOP MUST NOT FIGHT ANOTHER MODAL.
     *
     * `mod+k` is registered with `allowInInputs` and no overlay gate, so the
     * command palette — a Radix `Dialog`, portalled to `body` — can be opened
     * over this drawer. Its input taking focus is a surface claiming what it is
     * entitled to, not focus wandering into the app, and a backstop that could
     * not tell the two apart would make the palette unusable while the drawer
     * was open. The same exemption is what will let this panel grow a `Select`
     * or a `Tooltip` later: those portal out too.
     */
    it.each([
      ['a dialog', 'dialog-content'],
      ['a popover', 'popover-content'],
      ['a select', 'select-content'],
      ['a dropdown menu', 'dropdown-menu-content'],
    ])('leaves focus alone when %s claims it, even from the keyboard', (_name, slot) => {
      renderDrawer();
      const surface = document.createElement('div');
      surface.setAttribute('data-slot', slot);
      const input = document.createElement('input');
      surface.append(input);
      document.body.append(surface);

      fireEvent.keyDown(document, { key: 'Tab' });
      act(() => {
        input.focus();
      });

      expect(input).toHaveFocus();
      surface.remove();
    });
  });

  /**
   * THE DRAWER OWNS `z-[120]` (R2 W3.5) — see the z-scale table in the
   * component header. It shipped on the shared modal tier (`z-[100]`), which
   * put it BELOW the popover family's `z-[110]`, so a tooltip or dropdown
   * belonging to the app behind the scrim painted through both the scrim and the
   * panel.
   *
   * The second assertion is the guard for the price of that decision: nothing in
   * the panel may be a popover-family primitive, because one would portal to
   * `body` at `z-[110]` and paint behind the panel that owns it. The day someone
   * adds one, this fails and the header says what to do (`z-[130]` on its
   * content).
   */
  describe('the z tier', () => {
    it('puts the panel and the scrim above the popover family', () => {
      renderDrawer();

      expect(panel()).toHaveClass('z-[120]');
      expect(screen.getByTestId('theme-studio-scrim')).toHaveClass('z-[120]');
    });

    it('renders no portalled popover-family primitive inside the panel', () => {
      renderDrawer();
      fireEvent.click(within(panel()).getByRole('button', { name: 'Import' }));

      for (const tabName of ['Colours', 'Typography', 'Layout']) {
        fireEvent.click(tab(tabName));
        expect(
          panel().querySelector(
            '[data-slot="tooltip-trigger"],[data-slot="popover-trigger"],[data-slot="select-trigger"],[data-slot="dropdown-menu-trigger"]',
          ),
        ).toBeNull();
      }
    });
  });

  it('carries the enter-only motion classes whatever the motion policy says', () => {
    document.documentElement.setAttribute('data-motion', 'reduced');
    renderDrawer();

    // The CLASS is unconditional; `index.css` declares the animation only under
    // `data-motion="full"`, so a reduced session simply never starts one.
    expect(panel()).toHaveClass('fb-drawer-in');
    expect(screen.getByTestId('theme-studio-scrim')).toHaveClass('fb-scrim-in');

    document.documentElement.removeAttribute('data-motion');
  });
});

describe('the tablist', () => {
  it('offers three tabs and opens on Colours, with one stop in the tab order', () => {
    renderDrawer();

    expect(tab('Colours')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Colours')).toHaveAttribute('tabindex', '0');
    expect(tab('Typography')).toHaveAttribute('tabindex', '-1');
    expect(tab('Layout')).toHaveAttribute('tabindex', '-1');
  });

  it('swaps the panel on a click, and the panel says which tab named it', () => {
    renderDrawer();

    fireEvent.click(tab('Layout'));

    const tabpanel = screen.getByRole('tabpanel');
    expect(tabpanel).toHaveAttribute('aria-labelledby', tab('Layout').id);
    expect(within(tabpanel).getByRole('radiogroup', { name: 'Corners' })).toBeInTheDocument();
  });

  it('moves forward with ArrowRight and takes focus with it (LTR)', () => {
    renderDrawer();

    fireEvent.keyDown(tab('Colours'), { key: 'ArrowRight' });

    expect(tab('Typography')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Typography')).toHaveFocus();
  });

  it('wraps backwards from the first tab to the last (LTR)', () => {
    renderDrawer();

    fireEvent.keyDown(tab('Colours'), { key: 'ArrowLeft' });

    expect(tab('Layout')).toHaveAttribute('aria-selected', 'true');
    expect(tab('Layout')).toHaveFocus();
  });

  /**
   * The one place this port deliberately diverges from GameDash's original,
   * which maps ArrowRight to "next" unconditionally. The APG defines the arrows
   * by PHYSICAL direction, and an RTL tablist runs end-to-start — so pressing
   * the right arrow in Arabic must walk towards the tab drawn to the right,
   * which is the PREVIOUS one.
   */
  it('reverses the arrows under RTL', () => {
    document.documentElement.dir = 'rtl';
    renderDrawer();

    fireEvent.keyDown(tab('Colours'), { key: 'ArrowRight' });
    expect(tab('Layout')).toHaveAttribute('aria-selected', 'true');

    fireEvent.keyDown(tab('Layout'), { key: 'ArrowLeft' });
    expect(tab('Colours')).toHaveAttribute('aria-selected', 'true');
  });
});

describe('the Colours tab', () => {
  it('renders a card per preset, each with a decorative mock', () => {
    renderDrawer();

    const cards = screen.getAllByRole('button', { name: /^Apply / });
    expect(cards).toHaveLength(COLOR_PRESETS.length);
    for (const card of cards) {
      // One mini mock plus five swatches, all `aria-hidden`.
      expect(card.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThanOrEqual(6);
    }
  });

  it('applies BOTH palettes live, leaving the shared tokens alone', () => {
    renderDrawer();

    fireEvent.click(screen.getByRole('button', { name: 'Apply Ocean' }));

    const { theme } = useThemeStore.getState();
    expect(theme.light).toEqual(OCEAN.light);
    expect(theme.dark).toEqual(OCEAN.dark);
    expect(theme.shared).toEqual(DEFAULT_THEME.shared);
    // Live, not saved: the disk still holds the document Save last wrote.
    expect(
      matchColorPreset(JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) ?? '{}'))?.name,
    ).toBe('Default');
  });

  it('resolves the active card STRUCTURALLY, so an edited palette matches none', () => {
    renderDrawer();
    expect(screen.getByRole('button', { name: 'Apply Default' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Apply Ocean' }));
    expect(screen.getByRole('button', { name: 'Apply Ocean' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    act(() => {
      useThemeStore.getState().patchColors('dark', { primary: '#123456' });
    });

    for (const card of screen.getAllByRole('button', { name: /^Apply / })) {
      expect(card).toHaveAttribute('aria-pressed', 'false');
    }
  });

  it('switches the mode the cards are painted in', () => {
    renderDrawer();
    const light = screen.getByRole('radio', { name: 'Light' });
    expect(screen.getByRole('radio', { name: 'Dark' })).toHaveAttribute('aria-checked', 'true');

    fireEvent.click(light);

    expect(useThemeStore.getState().dark).toBe(false);
    expect(light).toHaveAttribute('aria-checked', 'true');
  });

  it('hands off to the advanced editor and closes on the way out', () => {
    const { navigate } = renderDrawer();

    fireEvent.click(screen.getByRole('button', { name: /Advanced editor/ }));

    expect(navigate).toHaveBeenCalledWith('/theme');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('the Typography tab', () => {
  it('applies a font preset with the Arabic fallback interposed', () => {
    renderDrawer();
    fireEvent.click(tab('Typography'));

    fireEvent.click(screen.getByRole('button', { name: 'Apply IBM Plex Sans' }));

    const { shared } = useThemeStore.getState().theme;
    expect(shared.fontBody).toContain("'IBM Plex Sans'");
    expect(shared.fontBody).toContain("'IBM Plex Sans Arabic'");
    // The scale is a separate decision and a face must not reset it.
    expect(shared.fsBase).toBe(DEFAULT_THEME.shared.fsBase);
  });

  it('carries the scale groups as compact segmented rows — no explanatory hints', () => {
    renderDrawer();
    fireEvent.click(tab('Typography'));

    const tabpanel = screen.getByRole('tabpanel');
    expect(within(tabpanel).getByRole('radiogroup', { name: 'Text size' })).toBeInTheDocument();
    expect(within(tabpanel).getByRole('radiogroup', { name: 'Line height' })).toBeInTheDocument();
    expect(
      within(tabpanel).getByRole('radiogroup', { name: 'Letter spacing' }),
    ).toBeInTheDocument();
    // The sentence belongs to `/theme`; 380px gets the control alone.
    expect(within(tabpanel).queryByText(/Arabic keeps a floor/)).not.toBeInTheDocument();
  });
});

describe('the Layout tab', () => {
  it('exposes every shared dimension, including the two enums', () => {
    renderDrawer();
    fireEvent.click(tab('Layout'));

    const tabpanel = screen.getByRole('tabpanel');
    expect(within(tabpanel).getAllByRole('radiogroup')).toHaveLength(8);
    expect(within(tabpanel).getByRole('radiogroup', { name: 'Density' })).toBeInTheDocument();
    expect(within(tabpanel).getByRole('radiogroup', { name: 'Chart style' })).toBeInTheDocument();
  });

  it('patches every token a word stands for', () => {
    renderDrawer();
    fireEvent.click(tab('Layout'));

    fireEvent.click(screen.getByRole('radio', { name: 'Square' }));

    const { shared } = useThemeStore.getState().theme;
    expect([shared.radius, shared.cardRadius, shared.btnRadius, shared.inputRadius]).toEqual([
      0, 0, 0, 0,
    ]);
  });
});

describe('the footer actions', () => {
  it('keeps Save disabled until the document is dirty, then persists it', () => {
    renderDrawer();
    const save = within(panel()).getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'Apply Ocean' }));
    expect(save).toBeEnabled();

    fireEvent.click(save);

    expect(
      matchColorPreset(JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) ?? '{}'))?.name,
    ).toBe('Ocean');
    expect(useThemeStore.getState().dirty).toBe(false);
    // Saving is not leaving: the panel stays open on the tab you were using.
    expect(panel()).toBeInTheDocument();
  });

  it('resets to the default document without writing it', () => {
    act(() => {
      useThemeStore.getState().applyPreset('Rose');
      useThemeStore.getState().save();
    });
    renderDrawer();

    fireEvent.click(within(panel()).getByRole('button', { name: 'Reset' }));

    expect(matchColorPreset(useThemeStore.getState().theme)?.name).toBe('Default');
    // Still Rose on disk — Reset is an edit like any other until Save.
    expect(
      matchColorPreset(JSON.parse(localStorage.getItem(THEME_STORAGE_KEY) ?? '{}'))?.name,
    ).toBe('Rose');
  });

  it('exports the live document as a dated download', () => {
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(
      this: HTMLAnchorElement,
    ) {
      clicked.push(this.download);
    });
    renderDrawer();

    fireEvent.click(within(panel()).getByRole('button', { name: 'Export' }));

    expect(clicked).toEqual([expect.stringMatching(/^flowboard-theme-\d{4}-\d{2}-\d{2}\.json$/)]);
  });

  /**
   * Two rows of two, not one row of four — see the footer's own comment. A
   * 380px drawer split four ways truncated `theme:actions.reset` in Arabic
   * («إعادة …»), and the column count is asserted here because it is the whole
   * fix: a future tidy-up back to `grid-cols-4` must fail this test rather than
   * silently re-break the Arabic bar.
   */
  it('lays the four actions out two per row', () => {
    renderDrawer();

    const bar = footer();
    expect(bar).toHaveClass('grid-cols-2');
    expect(bar).not.toHaveClass('grid-cols-4');
    expect(within(bar as HTMLElement).getAllByRole('button')).toHaveLength(4);
  });
});

describe('the inline import panel', () => {
  const openImport = () => {
    const toggle = within(panel()).getByRole('button', { name: 'Import' });
    fireEvent.click(toggle);
    return toggle;
  };

  it('toggles from the footer and says so', () => {
    renderDrawer();
    const toggle = within(panel()).getByRole('button', { name: 'Import' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(toggle);

    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Theme JSON file')).toBeInTheDocument();
    expect(screen.getByLabelText('Theme JSON')).toBeInTheDocument();
  });

  it('reports a parse failure inline and changes nothing', () => {
    renderDrawer();
    openImport();

    fireEvent.change(screen.getByLabelText('Theme JSON'), { target: { value: '{ not json' } });
    fireEvent.click(within(panel()).getByRole('button', { name: 'Import theme' }));

    expect(within(panel()).getByRole('alert')).toHaveTextContent('not valid JSON');
    // The panel stays open, next to the typo it is complaining about.
    expect(screen.getByLabelText('Theme JSON')).toBeInTheDocument();
    expect(useThemeStore.getState().theme.themePreset).toBe(DEFAULT_THEME.themePreset);
  });

  it('rejects JSON that parses but is not a theme document', () => {
    renderDrawer();
    openImport();

    fireEvent.change(screen.getByLabelText('Theme JSON'), { target: { value: '{"light":{}}' } });
    fireEvent.click(within(panel()).getByRole('button', { name: 'Import theme' }));

    expect(within(panel()).getByRole('alert')).toHaveTextContent('not a theme document');
  });

  it('applies a valid document and closes the panel', () => {
    renderDrawer();
    openImport();
    const payload = JSON.stringify({
      ...useThemeStore.getState().theme,
      light: OCEAN.light,
      dark: OCEAN.dark,
    });

    fireEvent.change(screen.getByLabelText('Theme JSON'), { target: { value: payload } });
    fireEvent.click(within(panel()).getByRole('button', { name: 'Import theme' }));

    expect(useThemeStore.getState().theme.themePreset).toBe('Imported');
    expect(matchColorPreset(useThemeStore.getState().theme)?.name).toBe('Ocean');
    expect(screen.queryByLabelText('Theme JSON')).not.toBeInTheDocument();
  });
});

describe('the topbar mount', () => {
  it('registers the trigger, which opens the drawer', () => {
    render(
      <TooltipProvider>
        <ThemeStudioSlot />
        <TopbarSlotZone zone="end" />
      </TooltipProvider>,
    );

    const trigger = screen.getByTestId('theme-studio-trigger');
    expect(trigger).toHaveAccessibleName('Theme Studio');
    expect(trigger.closest('[data-topbar-slot="theme-studio"]')).not.toBeNull();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    fireEvent.click(trigger);

    expect(useLayoutStore.getState().themeStudioOpen).toBe(true);
    expect(panel()).toBeInTheDocument();
  });

  it('takes the registration back down with the mount', () => {
    const view = render(
      <TooltipProvider>
        <ThemeStudioSlot />
        <TopbarSlotZone zone="end" />
      </TooltipProvider>,
    );
    expect(screen.getByTestId('theme-studio-trigger')).toBeInTheDocument();

    view.unmount();
    render(<TopbarSlotZone zone="end" />);

    expect(screen.queryByTestId('theme-studio-trigger')).not.toBeInTheDocument();
  });
});
