// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { RouterProvider, createMemoryRouter } from 'react-router-dom';

import '@/i18n';
import ThemePage from '@/pages/ThemePage';
import { THEME_STORAGE_KEY } from '@/components/theme/theme-storage';
import { matchColorPreset } from '@/components/theme/theme-presets';
import { useThemeStore } from '@/stores/useThemeStore';

/**
 * The studio PAGE: the three tabs, the action bar, and the leave guard.
 *
 * Rendered inside a real memory router, because `useBlocker` is a data-router
 * hook — the unsaved-changes dialog IS the router's blocked state, and a test
 * that stubbed the router would be testing a different component.
 *
 * jsdom has no layout engine, so this asserts BEHAVIOUR (what is enabled, what
 * is written, what appears) and leaves the pixels to the design pass.
 */

function renderPage() {
  const router = createMemoryRouter(
    [
      { path: '/theme', element: <ThemePage /> },
      { path: '/other', element: <p>elsewhere</p> },
    ],
    { initialEntries: ['/theme'] },
  );
  return { router, ...render(<RouterProvider router={router} />) };
}

/**
 * The sticky action bar. Scoped rather than global, because the live preview
 * renders its own button set (Save / Edit / Cancel / …) on purpose — that is
 * what it is previewing.
 */
const actionBar = () => within(screen.getByRole('group', { name: 'Theme actions' }));

/** Radix tabs activate on mousedown, not on a synthetic click. */
const selectTab = (name: string) => {
  fireEvent.mouseDown(screen.getByRole('tab', { name }));
};

beforeEach(() => {
  const store = useThemeStore.getState();
  store.resetToDefault();
  store.save();
  store.setDark(true);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('layout', () => {
  it('opens on the Colours tab and offers all three', () => {
    renderPage();

    expect(screen.getByRole('tab', { name: 'Colours', selected: true })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Typography' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Layout' })).toBeInTheDocument();
  });

  it('switches tabs without losing the live preview column', () => {
    renderPage();
    expect(screen.getByRole('region', { name: 'Live preview' })).toBeInTheDocument();

    selectTab('Layout');

    expect(screen.getByRole('radiogroup', { name: 'Corners' })).toBeInTheDocument();
    // The preview is outside the tab panels on purpose — it answers all three.
    expect(screen.getByRole('region', { name: 'Live preview' })).toBeInTheDocument();
  });
});

describe('the action bar', () => {
  it('keeps Save disabled until something changes, then persists on click', () => {
    renderPage();
    const save = actionBar().getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Apply Forest' }));

    expect(screen.getByText('Unsaved changes')).toBeInTheDocument();
    expect(save).toBeEnabled();

    fireEvent.click(save);

    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(matchColorPreset(JSON.parse(raw ?? '{}'))?.name).toBe('Forest');
    expect(screen.queryByText('Unsaved changes')).not.toBeInTheDocument();
  });

  it('resets to the default document without persisting it', () => {
    useThemeStore.getState().applyPreset('Rose');
    useThemeStore.getState().save();
    renderPage();

    fireEvent.click(actionBar().getByRole('button', { name: 'Reset' }));

    expect(matchColorPreset(useThemeStore.getState().theme)?.name).toBe('Default');
    // Still Rose on disk: Reset is an edit like any other until Save.
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    expect(matchColorPreset(JSON.parse(raw ?? '{}'))?.name).toBe('Rose');
  });

  it('exports the live document as a downloaded file', () => {
    const clicked: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click(
      this: HTMLAnchorElement,
    ) {
      clicked.push(this.download);
    });

    renderPage();
    fireEvent.click(actionBar().getByRole('button', { name: 'Export' }));

    expect(clicked).toHaveLength(1);
    expect(clicked[0]).toMatch(/^flowboard-theme-\d{4}-\d{2}-\d{2}\.json$/);
  });

  it('opens the import dialog with both a file picker and a paste box', () => {
    renderPage();
    fireEvent.click(actionBar().getByRole('button', { name: 'Import' }));

    expect(screen.getByRole('dialog', { name: 'Import a theme' })).toBeInTheDocument();
    expect(screen.getByLabelText('Theme JSON file')).toBeInTheDocument();
    expect(screen.getByLabelText('Theme JSON')).toBeInTheDocument();
  });

  it('surfaces an import failure inline and applies a valid document', () => {
    renderPage();
    fireEvent.click(actionBar().getByRole('button', { name: 'Import' }));

    const dialog = within(screen.getByRole('dialog', { name: 'Import a theme' }));
    const paste = dialog.getByLabelText('Theme JSON');

    fireEvent.change(paste, { target: { value: '{ not json' } });
    fireEvent.click(dialog.getByRole('button', { name: 'Import' }));

    // The dialog stays open, with the reason next to the field that caused it.
    expect(dialog.getByRole('alert')).toHaveTextContent('not valid JSON');

    fireEvent.change(paste, { target: { value: JSON.stringify(useThemeStore.getState().theme) } });
    fireEvent.click(dialog.getByRole('button', { name: 'Import' }));

    expect(useThemeStore.getState().theme.themePreset).toBe('Imported');
  });
});

describe('the unsaved-changes guard', () => {
  /**
   * A router navigation updates React state from OUTSIDE React's event system,
   * so it is wrapped in `act` — otherwise the blocked-state re-render is merely
   * scheduled, and whether the dialog exists by the next assertion depends on
   * how busy the machine is. That is the difference between a test and a
   * coin flip.
   */
  const navigate = async (router: ReturnType<typeof renderPage>['router'], to: string) => {
    await act(async () => {
      await router.navigate(to);
    });
  };

  it('blocks a navigation away from a dirty studio', async () => {
    const { router } = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Apply Ocean' }));
    expect(useThemeStore.getState().dirty).toBe(true);

    await navigate(router, '/other');

    expect(screen.getByRole('dialog', { name: 'Leave without saving?' })).toBeInTheDocument();
    expect(router.state.location.pathname).toBe('/theme');
  });

  it('stays put when the guard is dismissed', async () => {
    const { router } = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Apply Ocean' }));
    await navigate(router, '/other');

    // The "stay" side is the shared ConfirmDialog's own Cancel.
    const dialog = screen.getByRole('dialog', { name: 'Leave without saving?' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(router.state.location.pathname).toBe('/theme');
    // The edits are still live — dismissing the guard is not a rollback.
    expect(matchColorPreset(useThemeStore.getState().theme)?.name).toBe('Ocean');
  });

  it('releases the navigation when Leave is chosen', async () => {
    const { router } = renderPage();
    fireEvent.click(screen.getByRole('button', { name: 'Apply Ocean' }));
    await navigate(router, '/other');

    const dialog = screen.getByRole('dialog', { name: 'Leave without saving?' });
    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Leave' }));
    });

    expect(router.state.location.pathname).toBe('/other');
  });

  it('lets a clean studio navigate away untouched', async () => {
    const { router } = renderPage();

    await navigate(router, '/other');

    expect(router.state.location.pathname).toBe('/other');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
