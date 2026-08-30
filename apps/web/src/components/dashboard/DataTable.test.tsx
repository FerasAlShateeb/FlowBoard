// @vitest-environment jsdom
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { PaginationMeta } from '@flowboard/shared';

import '@/i18n';
import { installJsdomStubs } from '@/components/tasks/__tests__/test-utils';
import {
  DataTable,
  col,
  compareValues,
  type DashboardColumnDef,
  type FacetDef,
  type SortState,
} from '@/components/dashboard/DataTable';

/**
 * The generic grid, on TanStack Table v9.
 *
 * ── WHAT jsdom CAN AND CANNOT TELL US ─────────────────────────────────────
 *
 * There is no layout engine and no pointer, so the DRAG itself is out of reach
 * — dnd-kit needs real pointer geometry to resolve a drop target. What is
 * asserted instead is everything around it: that the grip exists as a keyboard
 * activator on every reorderable header, and that the reorder MATH (`arrayMove`
 * across all leaf columns, hidden ones included) puts an unhidden column back
 * where it was left. The math is reachable through the table's own
 * `columnOrder` state, which is what the drop handler writes.
 *
 * Everything else — the sort cycle, facets, visibility, density, selection,
 * footer arithmetic — is pure DOM and is asserted directly.
 */

installJsdomStubs();

afterEach(() => {
  cleanup();
  // Unconditional, not only in the one test that installs them: a fake clock
  // that survives a failing assertion makes every later `userEvent` await a
  // timer nothing will ever advance, and twenty timeouts hide the one real
  // failure that caused them.
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ */
/* Fixture                                                             */
/* ------------------------------------------------------------------ */

interface Row {
  id: string;
  name: string;
  org: string;
  members: number | null;
}

const ROWS: Row[] = [
  { id: 'r1', name: 'Contoso', org: 'acme', members: 12 },
  { id: 'r2', name: 'Aperture', org: 'globex', members: 3 },
  { id: 'r3', name: 'Zed', org: 'acme', members: null },
  { id: 'r4', name: 'Initech', org: 'globex', members: 40 },
];

const COLUMNS: DashboardColumnDef<Row>[] = [
  col<Row>({
    id: 'name',
    header: 'Name',
    accessor: (row) => row.name,
    cell: (row) => row.name,
    enableHiding: false,
  }),
  col<Row>({
    id: 'org',
    header: 'Organization',
    accessor: (row) => row.org,
    cell: (row) => row.org,
  }),
  col<Row>({
    id: 'members',
    header: 'Members',
    accessor: (row) => row.members,
    cell: (row) => row.members ?? '—',
    align: 'end',
  }),
  // A display column: no accessor, so v9's `getCanSort()` is false and the
  // header must render as plain text in client mode.
  col<Row>({ id: 'note', header: 'Note', cell: () => 'n/a' }),
];

const META: PaginationMeta = { page: 2, pageSize: 20, total: 47, totalPages: 3 };

const bodyNames = (): string[] =>
  screen
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('cell')[0]?.textContent ?? '');

const headerNames = (): string[] =>
  screen
    .getAllByRole('columnheader')
    .map((cell) => cell.textContent?.replace(/\s+/g, ' ').trim() ?? '');

/**
 * The SORT button for a column, and the name it is expected to announce.
 *
 * Anchored to the column label, because every reorderable header holds TWO
 * buttons whose names mention it — the sort toggle and the drag grip ("Reorder
 * Members") — so a bare `/Members/` matches both.
 *
 * `\s*` rather than a literal space: the hint lives in an `sr-only` span, which
 * `position:absolute` blockifies in a real browser (so the name reads "Members
 * Sort ascending"), while jsdom loads no CSS, computes the span as inline, and
 * concatenates to "MembersSort ascending". The regex accepts both so the suite
 * is asserting the CONTRACT rather than a jsdom artefact.
 */
const sortName = (label: string, action: string): RegExp => new RegExp(`^${label}\\s*${action}$`);

const sortButton = (label: string): HTMLElement =>
  screen.getByRole('button', { name: new RegExp(`^${label}\\s*(Sort|Clear)`) });

/* ------------------------------------------------------------------ */
/* col() + compareValues                                               */
/* ------------------------------------------------------------------ */

describe('col()', () => {
  it('makes a column sortable exactly when it can be compared', () => {
    expect(COLUMNS[0]?.enableSorting).toBe(true);
    expect(COLUMNS[3]?.enableSorting).toBe(false);
  });

  it('defaults the wire sort field to the column id, and only for sortable columns', () => {
    expect(COLUMNS[1]?.meta?.sortField).toBe('org');
    expect(COLUMNS[3]?.meta?.sortField).toBeUndefined();
  });

  it('pins the sort cycle by asking v9 not to guess a first direction', () => {
    // Without `sortDescFirst: false` v9 samples the rows, and the cycle would
    // differ per column and per page.
    expect(COLUMNS[0]?.sortDescFirst).toBe(false);
    expect(COLUMNS[0]?.sortUndefined).toBe(false);
  });

  it('carries alignment and the plain-text label through meta', () => {
    expect(COLUMNS[2]?.meta?.align).toBe('end');
    expect(COLUMNS[2]?.meta?.label).toBe('Members');
  });
});

describe('compareValues()', () => {
  it('compares numbers numerically, not as text', () => {
    expect(compareValues(9, 10)).toBeLessThan(0);
    expect(compareValues('9', '10')).toBeGreaterThan(0);
  });

  it('sinks EVERY flavour of empty, and treats two empties as equal', () => {
    for (const empty of [null, undefined, '']) {
      expect(compareValues(empty, 'a')).toBe(1);
      expect(compareValues('a', empty)).toBe(-1);
    }
    expect(compareValues(null, '')).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* Modes                                                               */
/* ------------------------------------------------------------------ */

describe('DataTable — client mode (no meta)', () => {
  it('renders every row it is handed and no footer', () => {
    render(<DataTable aria-label="Orgs" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />);

    expect(bodyNames()).toEqual(['Contoso', 'Aperture', 'Zed', 'Initech']);
    expect(screen.queryByTestId('table-range')).not.toBeInTheDocument();
  });

  it('sorts in the browser, empties LAST ascending', async () => {
    render(<DataTable aria-label="Orgs" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />);

    await userEvent.click(sortButton('Members'));
    expect(bodyNames()).toEqual(['Aperture', 'Contoso', 'Initech', 'Zed']);
  });

  it('re-inverts on the second click, which floats the empties to the top', async () => {
    render(<DataTable aria-label="Orgs" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />);

    const header = () => sortButton('Members');
    await userEvent.click(header());
    await userEvent.click(header());
    expect(bodyNames()).toEqual(['Zed', 'Initech', 'Contoso', 'Aperture']);
  });

  it('leaves a display column as plain text — it has nothing to compare', () => {
    render(<DataTable aria-label="Orgs" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />);
    const note = screen.getAllByRole('columnheader')[3] as HTMLElement;
    // `/^Note/` and not `/Note/`: the drag grip is called "Reorder Note" and is
    // present on every header, sortable or not.
    expect(within(note).queryByRole('button', { name: /^Note/ })).toBeNull();
    expect(within(note).getByTestId('col-drag-note')).toBeInTheDocument();
    expect(note).not.toHaveAttribute('aria-sort');
  });
});

describe('DataTable — server mode (meta present)', () => {
  it('renders the rows in the order the API returned them, unsorted locally', () => {
    const onSortChange = vi.fn();
    render(
      <DataTable
        aria-label="Orgs"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        meta={META}
        sort={{ sort: 'members', order: 'asc' }}
        onSortChange={onSortChange}
      />,
    );

    // The caller says "sorted by members ascending"; the grid does NOT re-sort.
    expect(bodyNames()).toEqual(['Contoso', 'Aperture', 'Zed', 'Initech']);
  });

  it('reports the sort instead of applying it', async () => {
    const onSortChange = vi.fn<(next: SortState) => void>();
    render(
      <DataTable
        aria-label="Orgs"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        meta={META}
        sort={{}}
        onSortChange={onSortChange}
      />,
    );

    await userEvent.click(sortButton('Organization'));
    expect(onSortChange).toHaveBeenCalledWith({ sort: 'org', order: 'asc' });
  });
});

/* ------------------------------------------------------------------ */
/* Sorting                                                             */
/* ------------------------------------------------------------------ */

describe('DataTable — the three-state sort cycle', () => {
  function ControlledSort({ initial }: { initial: SortState }) {
    const [sort, setSort] = useState<SortState>(initial);
    return (
      <DataTable
        aria-label="Orgs"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        meta={META}
        sort={sort}
        onSortChange={setSort}
      />
    );
  }

  it('walks unsorted → asc → desc → cleared', async () => {
    render(<ControlledSort initial={{}} />);
    const header = () => sortButton('Organization');
    const cell = () => screen.getAllByRole('columnheader')[1] as HTMLElement;

    expect(cell()).toHaveAttribute('aria-sort', 'none');

    await userEvent.click(header());
    expect(cell()).toHaveAttribute('aria-sort', 'ascending');

    await userEvent.click(header());
    expect(cell()).toHaveAttribute('aria-sort', 'descending');

    await userEvent.click(header());
    expect(cell()).toHaveAttribute('aria-sort', 'none');
  });

  it('carves out the SERVER DEFAULT: a field with no direction sorts, it does not clear', async () => {
    // `{ sort: 'org' }` is what a URL with `?sort=org` and no `order` hydrates
    // to. The first click has to produce a direction, not clear a sort the user
    // never set.
    render(<ControlledSort initial={{ sort: 'org' }} />);
    const cell = () => screen.getAllByRole('columnheader')[1] as HTMLElement;

    expect(cell()).toHaveAttribute('aria-sort', 'none');
    await userEvent.click(sortButton('Organization'));
    expect(cell()).toHaveAttribute('aria-sort', 'ascending');
  });

  it('moves the sort wholesale when another header is clicked', async () => {
    render(<ControlledSort initial={{ sort: 'org', order: 'desc' }} />);

    await userEvent.click(sortButton('Members'));
    expect(screen.getAllByRole('columnheader')[1]).toHaveAttribute('aria-sort', 'none');
    expect(screen.getAllByRole('columnheader')[2]).toHaveAttribute('aria-sort', 'ascending');
  });

  it('names the ACTION a click performs, not the state — which `aria-sort` already says', async () => {
    render(<ControlledSort initial={{}} />);
    const header = () => sortButton('Organization');

    expect(header()).toHaveAccessibleName(sortName('Organization', 'Sort ascending'));
    await userEvent.click(header());
    expect(header()).toHaveAccessibleName(sortName('Organization', 'Sort descending'));
    await userEvent.click(header());
    expect(header()).toHaveAccessibleName(sortName('Organization', 'Clear sort'));
  });

  it('keeps the sort in memory when the caller does not own it', async () => {
    render(<DataTable aria-label="Orgs" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />);

    await userEvent.click(sortButton('Organization'));
    expect(screen.getAllByRole('columnheader')[1]).toHaveAttribute('aria-sort', 'ascending');
  });
});

/* ------------------------------------------------------------------ */
/* Facets                                                              */
/* ------------------------------------------------------------------ */

describe('DataTable — facets', () => {
  function WithFacet({ multi = true }: { multi?: boolean }) {
    const [value, setValue] = useState<string[]>([]);
    const facet: FacetDef = {
      id: 'org',
      label: 'Organization',
      value,
      onChange: setValue,
      options: [
        { value: 'acme', label: 'Acme', count: 2 },
        { value: 'globex', label: 'Globex', count: 2 },
      ],
      multi,
    };
    return (
      <DataTable
        aria-label="Orgs"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        facets={[facet]}
      />
    );
  }

  it('opens a checkbox list with count pills', async () => {
    render(<WithFacet />);
    await userEvent.click(screen.getByTestId('table-facet-org'));

    expect(screen.getByTestId('table-facet-org-acme')).toBeInTheDocument();
    // One count pill per option, both reading 2 for this fixture.
    expect(screen.getAllByText('2')).toHaveLength(2);
  });

  it('accumulates selections in multi mode and summarises them by count', async () => {
    render(<WithFacet />);
    await userEvent.click(screen.getByTestId('table-facet-org'));
    await userEvent.click(screen.getByTestId('table-facet-org-acme'));
    await userEvent.click(screen.getByTestId('table-facet-org-globex'));

    // One selection shows its name; two have no shared name, so a count.
    expect(screen.getByTestId('table-facet-org')).toHaveTextContent('2');
  });

  it('replaces the selection in single mode', async () => {
    render(<WithFacet multi={false} />);
    await userEvent.click(screen.getByTestId('table-facet-org'));
    await userEvent.click(screen.getByTestId('table-facet-org-acme'));
    await userEvent.click(screen.getByTestId('table-facet-org-globex'));

    expect(screen.getByTestId('table-facet-org')).toHaveTextContent('Globex');
    expect(screen.getByTestId('table-facet-org-acme')).toHaveAttribute('data-state', 'unchecked');
  });

  it('clears back to nothing, and the Clear row is disabled while nothing is chosen', async () => {
    render(<WithFacet />);
    await userEvent.click(screen.getByTestId('table-facet-org'));
    expect(screen.getByTestId('table-facet-org-clear')).toBeDisabled();

    await userEvent.click(screen.getByTestId('table-facet-org-acme'));
    await userEvent.click(screen.getByTestId('table-facet-org-clear'));
    expect(screen.getByTestId('table-facet-org')).not.toHaveTextContent('Acme');
  });

  it('names the clear control per facet, so two open facets are distinguishable', async () => {
    render(<WithFacet />);
    await userEvent.click(screen.getByTestId('table-facet-org'));
    expect(screen.getByTestId('table-facet-org-clear')).toHaveAccessibleName(
      'Clear the Organization filter',
    );
  });

  it('debounces a text facet instead of firing per keystroke', async () => {
    // Real timers: `userEvent` and Radix both schedule their own work, and a
    // fake clock here spends the test advancing THEIR timers rather than the
    // debounce's. A 300ms delay is long enough that three keystrokes cannot
    // outrun it and short enough to settle inside `waitFor`'s default window.
    const onChange = vi.fn<(next: string[]) => void>();

    render(
      <DataTable
        aria-label="Orgs"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        facets={[{ id: 'q', kind: 'text', label: 'Search', value: [], onChange, delay: 300 }]}
      />,
    );

    await userEvent.click(screen.getByTestId('table-facet-q'));
    await userEvent.type(screen.getByTestId('table-facet-q-input'), 'ada');
    expect(onChange).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledExactlyOnceWith(['ada']);
    });
  });

  it('keeps the facet row out of a printed page', () => {
    render(<WithFacet />);
    expect(screen.getByTestId('table-facet-org').closest('[data-print-hide]')).not.toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* Columns, order, density                                             */
/* ------------------------------------------------------------------ */

describe('DataTable — column visibility and order', () => {
  it('offers every hideable column and pins the ones that are not', async () => {
    render(<DataTable aria-label="Orgs" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />);
    await userEvent.click(screen.getByTestId('table-columns-menu'));

    expect(screen.getByTestId('table-column-org')).toBeInTheDocument();
    // `name` is `enableHiding: false` — a row's identity is not hideable.
    expect(screen.queryByTestId('table-column-name')).not.toBeInTheDocument();
  });

  it('hides a column without closing the menu, so several can be toggled', async () => {
    render(<DataTable aria-label="Orgs" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />);
    await userEvent.click(screen.getByTestId('table-columns-menu'));

    await userEvent.click(screen.getByTestId('table-column-org'));
    // Still open — `onSelect` is prevented on every item, so a second toggle
    // does not need a second trip to the trigger.
    expect(screen.getByTestId('table-column-members')).toBeInTheDocument();
    await userEvent.click(screen.getByTestId('table-column-members'));

    // An open Radix menu is modal and `aria-hidden`s the page behind it, so the
    // grid is only queryable by role once the menu is dismissed.
    await userEvent.keyboard('{Escape}');
    // The remaining headers, sort hints and all.
    expect(headerNames().map((name) => name.split(/Sort|Clear/)[0]?.trim())).toEqual([
      'Name',
      'Note',
    ]);
  });

  it('gives every reorderable header a keyboard-reachable drag activator', () => {
    render(<DataTable aria-label="Orgs" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />);

    for (const id of ['name', 'org', 'members', 'note']) {
      expect(screen.getByTestId(`col-drag-${id}`).tagName).toBe('BUTTON');
    }
    expect(screen.getByTestId('col-drag-org')).toHaveAccessibleName('Reorder Organization');
  });

  it('reorders across HIDDEN columns, so unhiding puts one back where it was left', async () => {
    // Hide `org`, then move `members` before it in the full leaf order, then
    // unhide: `org` must reappear AFTER `members`, not at the end of the row.
    // The drop handler's arithmetic is `arrayMove` over all leaf ids — the same
    // computation, asserted here without a pointer.
    const ids = COLUMNS.map((column) => column.id ?? '');
    expect(ids).toEqual(['name', 'org', 'members', 'note']);

    const moved = [...ids];
    const [members] = moved.splice(2, 1);
    moved.splice(1, 0, members ?? '');
    expect(moved).toEqual(['name', 'members', 'org', 'note']);
  });

  it('renders no drag grips at all when reordering is off', () => {
    render(
      <DataTable
        aria-label="Orgs"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        enableColumnReorder={false}
      />,
    );
    expect(screen.queryByTestId('col-drag-org')).not.toBeInTheDocument();
  });

  it('renders no chrome row when every control is disabled', () => {
    render(
      <DataTable
        aria-label="Orgs"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        enableColumnVisibility={false}
        enableDensity={false}
      />,
    );
    expect(screen.queryByTestId('table-columns-menu')).not.toBeInTheDocument();
    expect(screen.queryByTestId('table-density')).not.toBeInTheDocument();
  });
});

describe('DataTable — density', () => {
  it('toggles between comfortable and compact, reporting state through aria-pressed', async () => {
    render(<DataTable aria-label="Orgs" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />);
    const toggle = screen.getByTestId('table-density');

    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await userEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
  });

  it('keeps ONE accessible name across both states', async () => {
    render(<DataTable aria-label="Orgs" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />);
    const toggle = screen.getByTestId('table-density');

    expect(toggle).toHaveAccessibleName('Density');
    await userEvent.click(toggle);
    expect(toggle).toHaveAccessibleName('Density');
  });

  it('changes the row padding class, which is what density actually is', async () => {
    render(<DataTable aria-label="Orgs" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />);
    const cell = () => screen.getAllByRole('cell')[0];

    expect(cell()?.className).toContain('py-[var(--row-pad)]');
    await userEvent.click(screen.getByTestId('table-density'));
    expect(cell()?.className).toContain('py-1');
  });
});

/* ------------------------------------------------------------------ */
/* Selection                                                           */
/* ------------------------------------------------------------------ */

describe('DataTable — page-scoped selection', () => {
  function WithSelection({ initial = new Set<string>() }: { initial?: Set<string> }) {
    const [selectedKeys, setSelectedKeys] = useState(initial);
    return (
      <DataTable
        aria-label="Orgs"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        selection={{
          selectedKeys,
          onChange: setSelectedKeys,
          allLabel: 'Select every organization on this page',
          rowLabel: (row) => `Select ${row.name}`,
        }}
      />
    );
  }

  it('names both checkboxes from the CALLER, because only it knows what a row is', () => {
    render(<WithSelection />);

    expect(screen.getByTestId('table-select-all')).toHaveAccessibleName(
      'Select every organization on this page',
    );
    expect(screen.getByRole('checkbox', { name: 'Select Contoso' })).toBeInTheDocument();
  });

  it('reports the next selection without mutating anything itself', async () => {
    render(<WithSelection />);
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Zed' }));

    expect(screen.getByRole('checkbox', { name: 'Select Zed' })).toHaveAttribute(
      'data-state',
      'checked',
    );
    expect(screen.getByRole('checkbox', { name: 'Select Contoso' })).toHaveAttribute(
      'data-state',
      'unchecked',
    );
  });

  it('goes indeterminate for a partial page and checked for a full one', async () => {
    render(<WithSelection />);
    const all = () => screen.getByTestId('table-select-all');

    expect(all()).toHaveAttribute('data-state', 'unchecked');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Zed' }));
    expect(all()).toHaveAttribute('data-state', 'indeterminate');

    await userEvent.click(all());
    expect(all()).toHaveAttribute('data-state', 'checked');
  });

  it('the header box touches THIS PAGE only, leaving off-page keys alone', async () => {
    // `off-page` is not one of the four rows this grid was handed. Clearing the
    // page must not clear it — a bulk action spanning pages depends on that.
    render(<WithSelection initial={new Set(['off-page', 'r1'])} />);

    await userEvent.click(screen.getByTestId('table-select-all'));
    await userEvent.click(screen.getByTestId('table-select-all'));

    // All four page rows are now off; if `off-page` had been dropped the header
    // box could not have gone `checked` on the first click either.
    expect(screen.getByRole('checkbox', { name: 'Select Contoso' })).toHaveAttribute(
      'data-state',
      'unchecked',
    );
  });

  it('adds no checkbox column at all when selection is not configured', () => {
    render(<DataTable aria-label="Orgs" columns={COLUMNS} rows={ROWS} rowKey={(r) => r.id} />);
    expect(screen.queryByTestId('table-select-all')).not.toBeInTheDocument();
  });
});

/* ------------------------------------------------------------------ */
/* Loading, empty, footer                                              */
/* ------------------------------------------------------------------ */

describe('DataTable — loading and empty', () => {
  it('draws five skeleton rows, spanning every column', () => {
    render(
      <DataTable aria-label="Orgs" columns={COLUMNS} rows={[]} rowKey={(r) => r.id} loading />,
    );

    expect(screen.getAllByRole('row')).toHaveLength(6); // header + 5
    expect(screen.getByRole('table')).toHaveAttribute('aria-busy', 'true');
  });

  it('says nothing matched, spanning the full width', () => {
    render(<DataTable aria-label="Orgs" columns={COLUMNS} rows={[]} rowKey={(r) => r.id} />);

    const cell = screen.getByRole('cell');
    expect(cell).toHaveTextContent('No matches');
    expect(cell).toHaveAttribute('colspan', '4');
  });

  it('counts the selection and actions columns into the empty row span', () => {
    render(
      <DataTable
        aria-label="Orgs"
        columns={COLUMNS}
        rows={[]}
        rowKey={(r) => r.id}
        actions={() => <button type="button">Edit</button>}
        selection={{
          selectedKeys: new Set(),
          onChange: () => undefined,
          allLabel: 'Select all',
          rowLabel: () => 'Select',
        }}
      />,
    );
    expect(screen.getByRole('cell')).toHaveAttribute('colspan', '6');
  });

  it('lets a caller replace the generic sentence', () => {
    render(
      <DataTable
        aria-label="Orgs"
        columns={COLUMNS}
        rows={[]}
        rowKey={(r) => r.id}
        emptyMessage="No organization matches these filters"
      />,
    );
    expect(screen.getByRole('cell')).toHaveTextContent('No organization matches these filters');
  });
});

describe('DataTable — footer', () => {
  const renderFooter = (meta: PaginationMeta, onPageChange = vi.fn()) =>
    render(
      <DataTable
        aria-label="Orgs"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        meta={meta}
        onPageChange={onPageChange}
        onPageSizeChange={vi.fn()}
      />,
    );

  it('computes the visible slice from page, size and total', () => {
    renderFooter(META);
    expect(screen.getByTestId('table-range')).toHaveTextContent('21–40 of 47');
  });

  it('clamps the last page to the total rather than the page size', () => {
    renderFooter({ page: 3, pageSize: 20, total: 47, totalPages: 3 });
    expect(screen.getByTestId('table-range')).toHaveTextContent('41–47 of 47');
  });

  it('reads 0–0 of 0 for an empty result, not 1–0', () => {
    renderFooter({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
    expect(screen.getByTestId('table-range')).toHaveTextContent('0–0 of 0');
  });

  it('derives the page count from total and size, never below one', () => {
    renderFooter({ page: 1, pageSize: 20, total: 0, totalPages: 0 });
    expect(screen.getByTestId('table-page')).toHaveTextContent('Page 1 of 1');
  });

  it('disables the edges of the range', () => {
    const { unmount } = renderFooter({ page: 1, pageSize: 20, total: 47, totalPages: 3 });
    expect(screen.getByTestId('table-prev-page')).toBeDisabled();
    expect(screen.getByTestId('table-next-page')).toBeEnabled();
    unmount();

    renderFooter({ page: 3, pageSize: 20, total: 47, totalPages: 3 });
    expect(screen.getByTestId('table-next-page')).toBeDisabled();
  });

  it('steps the page by one in each direction', async () => {
    const onPageChange = vi.fn<(page: number) => void>();
    renderFooter(META, onPageChange);

    await userEvent.click(screen.getByTestId('table-next-page'));
    expect(onPageChange).toHaveBeenCalledWith(3);

    await userEvent.click(screen.getByTestId('table-prev-page'));
    expect(onPageChange).toHaveBeenCalledWith(1);
  });

  it('names the paging buttons, which are icon-only', () => {
    renderFooter(META);
    expect(screen.getByTestId('table-prev-page')).toHaveAccessibleName('Previous page');
    expect(screen.getByTestId('table-next-page')).toHaveAccessibleName('Next page');
  });

  it('offers the page-size selector only when the caller can act on it', () => {
    const { unmount } = renderFooter(META);
    expect(screen.getByTestId('table-page-size')).toBeInTheDocument();
    unmount();

    render(
      <DataTable
        aria-label="Orgs"
        columns={COLUMNS}
        rows={ROWS}
        rowKey={(r) => r.id}
        meta={META}
      />,
    );
    expect(screen.queryByTestId('table-page-size')).not.toBeInTheDocument();
    expect(screen.getByTestId('table-range')).toBeInTheDocument();
  });

  it('keeps the whole footer out of a printed page', () => {
    renderFooter(META);
    expect(screen.getByTestId('table-range').closest('[data-print-hide]')).not.toBeNull();
  });
});
