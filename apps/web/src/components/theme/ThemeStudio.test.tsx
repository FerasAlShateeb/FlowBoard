// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';

import '@/i18n';
import ColorsPanel from '@/components/theme/ColorsPanel';
import LayoutPanel from '@/components/theme/LayoutPanel';
import TypographyPanel from '@/components/theme/TypographyPanel';
import { COLOR_PRESETS, FONT_PRESETS } from '@/components/theme/theme-presets';
import { DEFAULT_THEME } from '@/components/theme/theme-tokens';
import { useThemeStore } from '@/stores/useThemeStore';

/**
 * The studio's three panels, driven the way a person drives them: click a card,
 * type a colour, pick a word.
 *
 * These are the tests that would have caught a wiring mistake no unit test can
 * see — a card that renders the right preview but applies the wrong preset, a
 * token row bound to the visible mode instead of the edited one, a segmented
 * option whose word and value have drifted apart.
 *
 * Testing Library only auto-registers its cleanup with `globals: true`, and
 * this workspace deliberately does not (see `vitest.config.ts`).
 */

const OCEAN = COLOR_PRESETS.find((preset) => preset.name === 'Ocean');
const PLEX = FONT_PRESETS.find((preset) => preset.name === 'IBM Plex Sans');
if (!OCEAN || !PLEX) throw new Error('preset fixtures are missing');

beforeEach(() => {
  const store = useThemeStore.getState();
  store.resetToDefault();
  store.save();
  // Dark is the product default and therefore what the editor opens on.
  store.setDark(true);
});

afterEach(cleanup);

describe('preset gallery', () => {
  it('renders a card per preset, each previewing both palettes', () => {
    render(<ColorsPanel />);

    const cards = screen.getAllByRole('button', { name: /^Apply / });
    expect(cards).toHaveLength(COLOR_PRESETS.length);

    for (const card of cards) {
      // Two mini mocks (light + dark) and five swatches, all decorative.
      expect(card.querySelectorAll('[aria-hidden="true"]').length).toBeGreaterThanOrEqual(7);
    }
  });

  it('applies BOTH palettes when a card is clicked', () => {
    render(<ColorsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Apply Ocean' }));

    const { theme } = useThemeStore.getState();
    expect(theme.light).toEqual(OCEAN.light);
    expect(theme.dark).toEqual(OCEAN.dark);
    // Shared tokens are a separate decision and must survive a colour change.
    expect(theme.shared).toEqual(DEFAULT_THEME.shared);
  });

  it('moves the active state onto the applied card', () => {
    render(<ColorsPanel />);
    expect(screen.getByRole('button', { name: 'Apply Default' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    fireEvent.click(screen.getByRole('button', { name: 'Apply Ocean' }));

    expect(screen.getByRole('button', { name: 'Apply Ocean' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(screen.getByRole('button', { name: 'Apply Default' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  it('marks the palette as Custom once a token is edited', () => {
    render(<ColorsPanel />);
    expect(screen.queryByText(/match no preset/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Primary value'), { target: { value: '#123456' } });

    expect(screen.getByText(/match no preset/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply Default' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });
});

describe('token editor', () => {
  it('patches the store from the raw value field', () => {
    render(<ColorsPanel />);
    fireEvent.change(screen.getByLabelText('Primary value'), { target: { value: '#123456' } });

    const { theme } = useThemeStore.getState();
    expect(theme.dark.primary).toBe('#123456');
    // The other palette is untouched — a document carries two independent sets.
    expect(theme.light.primary).toBe(DEFAULT_THEME.light.primary);
  });

  it('rejects an invalid value inline instead of writing it', () => {
    render(<ColorsPanel />);
    const field = screen.getByLabelText('Primary value');
    fireEvent.change(field, { target: { value: 'not-a-colour' } });

    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(useThemeStore.getState().theme.dark.primary).toBe(DEFAULT_THEME.dark.primary);
  });

  it('offers the token as hex to the colour picker and stores OKLCH back', () => {
    render(<ColorsPanel />);
    const picker = screen.getByLabelText('Pick Primary');

    // OKLCH in, hex out — the browser control speaks nothing else.
    expect(picker).toHaveValue('#7d85f6');

    fireEvent.change(picker, { target: { value: '#ff0000' } });
    // …and hex in, OKLCH back, so the document stays in the authored space.
    expect(useThemeStore.getState().theme.dark.primary).toMatch(/^oklch\(/);
  });

  it('edits the palette selected by the Light/Dark switch, not the visible one', () => {
    render(<ColorsPanel />);
    fireEvent.click(screen.getByRole('radio', { name: 'Light' }));
    fireEvent.change(screen.getByLabelText('Primary value'), { target: { value: '#abcdef' } });

    const { theme } = useThemeStore.getState();
    expect(theme.light.primary).toBe('#abcdef');
    expect(theme.dark.primary).toBe(DEFAULT_THEME.dark.primary);
    // And it says so, because you are editing what you cannot see.
    expect(screen.getByText(/You are viewing the Dark palette/i)).toBeInTheDocument();
  });

  it('lists all 22 tokens', () => {
    render(<ColorsPanel />);
    expect(screen.getAllByRole('textbox')).toHaveLength(22);
  });
});

describe('dimension controls', () => {
  it('maps a word to the numeric tokens behind it', () => {
    render(<LayoutPanel />);
    fireEvent.click(screen.getByRole('radio', { name: 'Square' }));

    const { shared } = useThemeStore.getState().theme;
    expect(shared.radius).toBe(0);
    expect(shared.cardRadius).toBe(0);
    expect(shared.btnRadius).toBe(0);
    expect(shared.inputRadius).toBe(0);
  });

  it('maps Instant to a zero-millisecond transition', () => {
    render(<LayoutPanel />);
    fireEvent.click(screen.getByRole('radio', { name: 'Instant' }));
    expect(useThemeStore.getState().theme.shared.speed).toBe(0);
  });

  it('maps the density enum', () => {
    render(<LayoutPanel />);
    fireEvent.click(screen.getByRole('radio', { name: 'Compact' }));
    expect(useThemeStore.getState().theme.shared.density).toBe('compact');
  });

  it('shows no raw numbers, only words', () => {
    const { container } = render(<LayoutPanel />);
    const groups = container.querySelectorAll('[role="radiogroup"]');
    expect(groups.length).toBeGreaterThanOrEqual(8);
    for (const group of groups) {
      expect(group.textContent ?? '').not.toMatch(/\d/);
    }
  });

  it('moves the checked state with the selection', () => {
    render(<LayoutPanel />);
    const square = screen.getByRole('radio', { name: 'Square' });
    expect(square).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(square);
    expect(square).toHaveAttribute('aria-checked', 'true');
  });
});

describe('typography panel', () => {
  it('applies a font stack with the Arabic fallback interposed', () => {
    render(<TypographyPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Apply IBM Plex Sans' }));

    const { shared } = useThemeStore.getState().theme;
    expect(shared.fontBody).toBe(PLEX.patch.fontBody);
    expect(shared.fontBody).toContain("'IBM Plex Sans Arabic'");
  });

  it('leaves the scale controls alone when a face is applied', () => {
    render(<TypographyPanel />);
    // "Relaxed" is a word two groups share (text size and line height) — one
    // catalog entry translating both is the point, so index into the first.
    const [relaxedSize] = screen.getAllByRole('radio', { name: 'Relaxed' });
    if (!relaxedSize) throw new Error('the text-size group is missing its Relaxed option');
    fireEvent.click(relaxedSize);
    const relaxed = useThemeStore.getState().theme.shared.fsBase;

    fireEvent.click(screen.getByRole('button', { name: 'Apply Manrope' }));
    expect(useThemeStore.getState().theme.shared.fsBase).toBe(relaxed);
  });

  /**
   * WP4.7 added the five missing families to `index.html`, so every preset is
   * now `bundled` and the warning renders nowhere. The test keeps its shape
   * anyway — derived from the data, never a hard-coded count — so it starts
   * asserting again the moment somebody adds a preset without extending the
   * font request, which is precisely the mistake the flag exists to catch.
   */
  it('flags exactly the families the app does not ship — currently none', () => {
    render(<TypographyPanel />);
    const unbundled = FONT_PRESETS.filter((preset) => !preset.bundled).length;

    expect(screen.queryAllByText('Uses your installed copy')).toHaveLength(unbundled);
    expect(unbundled).toBe(0);
  });
});
