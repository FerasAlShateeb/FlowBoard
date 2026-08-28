// @vitest-environment jsdom
import type { ReactElement, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom/vitest';
import type { SearchResult, User } from '@flowboard/shared';

import '@/i18n';
import { clearShortcutsForTest } from '@/lib/shortcuts';
import type { RouteScope } from '@/hooks/useRouteScope';
import type { OrgSearchState } from '@/hooks/useSearch';
import { useAuthStore } from '@/stores/useAuthStore';
import { useLayoutStore } from '@/stores/useLayoutStore';
import { usePaletteStore, __resetPaletteStoreForTests } from '@/stores/usePaletteStore';
import { TooltipProvider } from '@/components/ui/tooltip';
import { installJsdomStubs } from '@/components/tasks/__tests__/test-utils';
import CommandPalette from '@/components/palette/CommandPalette';
import GlobalShortcuts from '@/components/palette/GlobalShortcuts';

/**
 * The palette, rendered.
 *
 * WHAT IS MOCKED AND WHY. Two data hooks: `useOrgBySlug` (a slug→id lookup that
 * would otherwise drag `GET /orgs` and its zod parse into a UI suite) and
 * `useOrgSearch` (which has its own suite next door, and whose four states —
 * shut, searching, empty, answered — are far easier to drive as a return value
 * than as a fetch timeline). Everything else is real: the store, the frozen
 * registry and listener, `ui/command`'s keyboard model, and the catalog.
 */

const ORG = '11111111-1111-4111-8111-111111111111';

vi.mock('@/hooks/useOrgs', () => ({
  useOrgBySlug: (slug: string | null) => ({
    org: slug === null ? null : { id: ORG, slug, name: 'Acme', role: 'admin' },
    isPending: false,
    error: null,
  }),
}));

const searchState = vi.hoisted(() => ({
  current: {
    results: [],
    isSearching: false,
    isActive: false,
    isError: false,
    error: null,
    needle: '',
  } as OrgSearchState,
}));

vi.mock('@/hooks/useSearch', () => ({
  useOrgSearch: () => searchState.current,
}));

installJsdomStubs();

const HIT: SearchResult = {
  taskId: '33333333-3333-4333-8333-333333333333',
  key: 'FLOW-142',
  title: 'Refresh token rotation',
  type: 'bug',
  statusId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  projectId: '22222222-2222-4222-8222-222222222222',
  projectKey: 'FLOW',
  projectName: 'FlowBoard',
};

const IN_PROJECT = { orgSlug: 'acme', projectKey: 'FLOW' };
const IN_ORG = { orgSlug: 'acme', projectKey: null };

function admin(isGlobalAdmin: boolean): User {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    email: 'ada@flowboard.test',
    name: 'Ada Lovelace',
    avatarUrl: null,
    isGlobalAdmin,
    locale: 'en',
    isActive: true,
    createdAt: '2026-01-01T00:00:00.000Z',
  };
}

function wrap(ui: ReactElement): ReactElement {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={client}>
        <TooltipProvider>{children}</TooltipProvider>
      </QueryClientProvider>
    );
  }
  return <Wrapper>{ui}</Wrapper>;
}

/** Mounts the palette (already open unless told otherwise) plus the chords. */
function setup(
  scope: RouteScope = IN_PROJECT,
  options: { open?: boolean; isGlobalAdmin?: boolean } = {},
) {
  const { open = true, isGlobalAdmin = false } = options;
  const navigate = vi.fn();
  useAuthStore.setState({ user: admin(isGlobalAdmin), accessToken: 'token' });
  if (open) usePaletteStore.getState().openPalette();

  const view = render(
    wrap(
      <>
        <GlobalShortcuts scope={scope} signedIn />
        <CommandPalette scope={scope} navigate={navigate} />
      </>,
    ),
  );

  return { ...view, navigate };
}

/** The palette's own listbox, so a query cannot stray into the footer. */
function list(): HTMLElement {
  return screen.getByRole('listbox');
}

function rows(): string[] {
  return within(list())
    .getAllByRole('option')
    .map((option) => option.textContent ?? '');
}

beforeEach(() => {
  __resetPaletteStoreForTests();
  clearShortcutsForTest();
  useLayoutStore.setState({ diagOpen: false });
  searchState.current = {
    results: [],
    isSearching: false,
    isActive: false,
    isError: false,
    error: null,
    needle: '',
  };
});

afterEach(() => {
  cleanup();
  clearShortcutsForTest();
  __resetPaletteStoreForTests();
  useAuthStore.setState({ user: null, accessToken: null });
});

describe('opening', () => {
  it('is closed until something opens it', () => {
    setup(IN_PROJECT, { open: false });
    expect(screen.queryByTestId('command-palette')).not.toBeInTheDocument();
  });

  it('opens on the registered Ctrl+K handler', () => {
    setup(IN_PROJECT, { open: false });

    act(() => {
      window.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true, cancelable: true }),
      );
    });

    expect(screen.getByTestId('command-palette')).toBeInTheDocument();
    expect(screen.getByRole('combobox')).toHaveFocus();
  });
});

describe('the navigation lane', () => {
  it('lists the project views first, by their shared nav names', () => {
    setup();
    expect(
      rows()
        .slice(0, 6)
        .map((row) => row.replace('Project', '')),
    ).toEqual(['Board', 'Backlog', 'Roadmap', 'Table', 'Calendar', 'Dashboard']);
  });

  it('drops the project views outside a project, and keeps the org pages', () => {
    setup(IN_ORG);
    const text = rows().join('|');
    expect(text).not.toContain('Backlog');
    expect(text).toContain('Members');
    expect(text).toContain('Notifications');
  });

  it('hides the admin rows from a non-admin and shows them to an admin', () => {
    const { unmount } = setup(IN_PROJECT, { isGlobalAdmin: false });
    expect(rows().join('|')).not.toContain('Open diagnostics');
    unmount();

    setup(IN_PROJECT, { isGlobalAdmin: true });
    expect(rows().join('|')).toContain('Open diagnostics');
  });

  it('mirrors the typed needle into the store, and filters on it', async () => {
    const user = userEvent.setup();
    setup();

    await user.type(screen.getByRole('combobox'), 'backl');

    // The mirror is what the tasks lane reads — see CommandPalette's header.
    expect(usePaletteStore.getState().query).toBe('backl');
    expect(rows().some((row) => row.includes('Backlog'))).toBe(true);
    expect(rows().some((row) => row.includes('Calendar'))).toBe(false);
  });

  it('highlights the characters that matched', async () => {
    const user = userEvent.setup();
    setup();

    await user.type(screen.getByRole('combobox'), 'back');
    const marks = within(list()).getAllByText('Back', { selector: 'mark' });
    expect(marks.length).toBeGreaterThan(0);
  });

  it('shows the empty state when nothing matches', async () => {
    const user = userEvent.setup();
    setup();

    await user.type(screen.getByRole('combobox'), 'zzzz');
    expect(screen.getByText('No matches for “zzzz”')).toBeInTheDocument();
    expect(within(list()).queryAllByRole('option')).toHaveLength(0);
  });

  it('navigates and closes when a row is chosen', async () => {
    const user = userEvent.setup();
    const { navigate } = setup();

    await user.click(within(list()).getByText('Backlog'));

    expect(navigate).toHaveBeenCalledWith('/o/acme/p/FLOW/backlog');
    expect(usePaletteStore.getState().open).toBe(false);
  });

  it('Enter takes the first row — the keyboard path through the primitive', async () => {
    const user = userEvent.setup();
    const { navigate } = setup();

    await user.keyboard('{Enter}');
    expect(navigate).toHaveBeenCalledWith('/o/acme/p/FLOW/board');
  });

  it('ArrowDown walks the list before Enter fires', async () => {
    const user = userEvent.setup();
    const { navigate } = setup();

    await user.keyboard('{ArrowDown}{Enter}');
    expect(navigate).toHaveBeenCalledWith('/o/acme/p/FLOW/backlog');
  });
});

describe('the verbs', () => {
  it('opens the create dialog from "Create task…" inside a project', async () => {
    const user = userEvent.setup();
    setup();

    await user.click(within(list()).getByText('Create task…'));

    expect(usePaletteStore.getState().createTaskOpen).toBe(true);
    expect(usePaletteStore.getState().open).toBe(false);
  });

  it('shows "Create task…" outside a project, but disabled and unreachable', () => {
    setup(IN_ORG);

    const create = within(list()).getByText('Create task…').closest('[role="option"]');
    expect(create).toHaveAttribute('aria-disabled', 'true');
    // A disabled row carries no `data-command-item`, so the arrow keys skip it.
    expect(create).not.toHaveAttribute('data-command-item');
  });

  it('does nothing when a disabled verb is clicked', async () => {
    const user = userEvent.setup();
    setup(IN_ORG);

    await user.click(within(list()).getByText('Create task…'));
    expect(usePaletteStore.getState().createTaskOpen).toBe(false);
  });

  it('flips the diagnostics drawer for an admin', async () => {
    const user = userEvent.setup();
    setup(IN_PROJECT, { isGlobalAdmin: true });

    await user.click(within(list()).getByText('Open diagnostics'));
    expect(useLayoutStore.getState().diagOpen).toBe(true);
  });
});

describe('the tasks lane', () => {
  it('is absent while the needle is below the search floor', () => {
    setup();
    expect(screen.queryByTestId('palette-tasks-lane')).not.toBeInTheDocument();
  });

  it('shows a spinner while the search is in flight', () => {
    searchState.current = { ...searchState.current, isActive: true, isSearching: true };
    setup();

    expect(screen.getByTestId('palette-tasks-loading')).toBeInTheDocument();
    expect(screen.getByText('Searching…')).toBeInTheDocument();
  });

  it('renders a hit with its key, its type and its project', () => {
    searchState.current = { ...searchState.current, isActive: true, results: [HIT] };
    setup();

    const lane = screen.getByTestId('palette-tasks-lane');
    expect(within(lane).getByText('FLOW-142')).toBeInTheDocument();
    expect(within(lane).getByText('Refresh token rotation')).toBeInTheDocument();
    expect(within(lane).getByText('FlowBoard')).toBeInTheDocument();
    expect(within(lane).getByRole('img', { name: 'Type: Bug' })).toBeInTheDocument();
  });

  it('deep-links a hit to its own project board with the sheet open', async () => {
    const user = userEvent.setup();
    searchState.current = { ...searchState.current, isActive: true, results: [HIT] };
    const { navigate } = setup();

    await user.click(screen.getByText('Refresh token rotation'));
    expect(navigate).toHaveBeenCalledWith('/o/acme/p/FLOW/board/t/FLOW-142');
  });

  it('says so when the search came back empty', () => {
    searchState.current = { ...searchState.current, isActive: true, needle: 'zzz' };
    setup();

    // AFTER `setup`: opening the palette resets the needle by design, so a
    // reopened palette never shows the previous session's "no matches for…".
    act(() => {
      usePaletteStore.getState().setQuery('zzz');
    });

    expect(screen.getByText('No tasks match “zzz”')).toBeInTheDocument();
  });

  it('is ONE keyboard list with the navigation lane above it', async () => {
    const user = userEvent.setup();
    searchState.current = { ...searchState.current, isActive: true, results: [HIT] };
    const { navigate } = setup(IN_ORG);

    // Six navigation rows outside a project (4 org + 3 personal + the disabled
    // verb, which is skipped): walk to the very end and the next stop is the
    // task hit, with no second focus model in between.
    await user.keyboard('{End}{Enter}');
    expect(navigate).toHaveBeenCalledWith('/o/acme/p/FLOW/board/t/FLOW-142');
  });
});
