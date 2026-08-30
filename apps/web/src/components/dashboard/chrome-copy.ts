import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

/**
 * THE ONE PLACE THE DASHBOARD KIT READS THE CATALOG.
 *
 * ═══ THE PROBLEM THIS SOLVES ═════════════════════════════════════════════
 *
 * `components/dashboard/**` is shared chrome: the admin console renders it, and
 * so will every future reporting surface. Its copy — "Columns", "Rows per
 * page", "Clear", the sort hints, the reorder announcements — belongs to no one
 * page. No component in the kit calls `t()` itself, on purpose: the returned
 * SHAPES below are the contract, and the keys behind them are an implementation
 * detail that can move without touching a component.
 *
 * ═══ WHERE EACH STRING COMES FROM, AND WHY ═══════════════════════════════
 *
 * W1.4 wrote this file while `common` had a single writer and the locale index
 * files were frozen, so every string was BORROWED from a key that already
 * existed. W3.1 reviewed the whole table with the catalogs writable again and
 * split it in two: a borrow stays where it is a fair reading of the same idea,
 * and was minted where it was not.
 *
 * KEPT — the `table` namespace's `grid`/`config`/`footer`/`filters` blocks are
 * generic grid chrome that merely happens to live next to the task table's own
 * copy, and `common:*` is generic by construction:
 *
 * | what the kit needs      | key it reads                  | why it is a fair reading               |
 * |-------------------------|-------------------------------|----------------------------------------|
 * | sort hint (3 states)    | `table:grid.sortTo.*`         | names the ACTION, not the task table   |
 * | "Columns" button        | `table:toolbar.columns`       | same control, same word                |
 * | columns menu heading    | `table:config.title`          | same popover, generalized              |
 * | reorder grip name       | `table:config.reorder`        | `{{name}}` interpolated                |
 * | drag announcements      | `table:config.dnd.*`          | column-shaped already                  |
 * | footer range / paging   | `table:footer.*`              | `{{from}}–{{to}} of {{total}}`         |
 * | facet clear             | `table:filters.clearOne`      | "Clear the {{name}} filter"            |
 * | empty body              | `common:states.noResults`     | generic by construction                |
 * | clear / search verbs    | `common:actions.*`            | the shared verb list                   |
 * | panel info button       | `reports:card.infoLabel`      | same control, same sentence (R2 W3.5)  |
 * | panel empty title       | `common:states.empty`         | generic by construction (R2 W3.5)      |
 *
 * The last two rows are `PanelCard`'s, and they arrived late: W1.4 built the
 * panel with its own `useTranslation(['reports','common'])`, which made it the
 * ONE component in the kit that read the catalog directly and quietly broke this
 * file's opening claim. `reports:card.infoLabel` is a fair borrow for the same
 * reason `table:toolbar.columns` is — it is literally the same affordance ("What
 * this chart shows") on the same kind of card, which is why `ReportCard` and
 * `PanelCard` should never be able to word it differently. `common:states.empty`
 * is generic by construction, like its `noResults` neighbour; the two are
 * deliberately NOT merged, because "nothing here yet" (a panel with no data) and
 * "nothing matched" (a grid whose filters excluded everything) are different
 * sentences that happen to appear in the same kit.
 *
 * MINTED (W3.1) as `common:grid.*` — these three borrows were semantically
 * wrong, not merely indirect. `theme:groups.density` names a *Theme Studio
 * setting*, and a per-grid density toggle is not one: changing the Studio's
 * wording for its own control would silently reword every admin table.
 * `admin:range.label` put the shared range picker's accessible name inside the
 * ADMIN namespace even though the control is the dashboard kit's, and
 * `reports:toolbar.rangePreset.custom` read one word out of a DIFFERENT range
 * picker's preset list (`components/reports/ReportRangePicker`, which W3.1
 * deliberately did not migrate — see its header), so the two would have had to
 * be reworded together forever.
 *
 * | density toggle          | `common:grid.density.*`       | minted W3.1                            |
 * | range group name        | `common:grid.range.label`     | minted W3.1                            |
 * | custom range word       | `common:grid.range.custom`    | minted W3.1                            |
 *
 * Nothing is invented at a call site and nothing is hard-coded English: every
 * string above ships with an Arabic twin.
 */

/** Every string the generic `DataTable` and its `table/*` parts render. */
export interface TableChromeCopy {
  /** Sort-button hint: the direction a click would move this header TO. */
  sortTo: { asc: string; desc: string; none: string };
  /** Columns menu: trigger face and popover heading. */
  columns: { button: string; heading: string };
  /** Accessible name for a header's drag grip. `name` is the column label. */
  reorderColumn: (name: string) => string;
  /** Visible hint + dnd-kit's screen-reader instructions. */
  reorderHint: string;
  /** dnd-kit announcements, so a reorder narrates the COLUMN, not an index. */
  reorderAnnouncements: {
    picked: (args: DragAnnouncementArgs) => string;
    over: (args: DragAnnouncementArgs) => string;
    dropped: (args: DragAnnouncementArgs) => string;
    cancelled: (args: Omit<DragAnnouncementArgs, 'total'>) => string;
  };
  /** Density toggle: its accessible name and the two state words. */
  density: { label: string; comfortable: string; compact: string };
  /** Facets: the clear row's face and its per-facet accessible name. */
  facet: { clear: string; clearAria: (name: string) => string; searchPlaceholder: string };
  /** Body copy when a page has no rows and nothing is loading. */
  empty: string;
  /** The actions column's `sr-only` header. */
  actionsHeader: string;
  /** Footer: `1–25 of 312`, the page counter, and the three control names. */
  footer: {
    range: (args: { from: number; to: number; total: number }) => string;
    page: (args: { page: number; pages: number }) => string;
    rowsPerPage: string;
    previous: string;
    next: string;
  };
}

/** What a drag announcement interpolates. `position` is 1-based. */
export interface DragAnnouncementArgs {
  name: string;
  position: number;
  total: number;
}

/**
 * Resolves {@link TableChromeCopy} for the active language.
 *
 * `t` changes identity exactly once per language switch, so the memo rebuilds
 * precisely when the copy must change and no more often — which matters because
 * the announcement callbacks below are handed to dnd-kit, and a fresh object
 * per render would re-register its accessibility layer on every keystroke.
 */
export function useTableChromeCopy(): TableChromeCopy {
  const { t } = useTranslation(['table', 'common']);

  return useMemo<TableChromeCopy>(
    () => ({
      sortTo: {
        asc: t('table:grid.sortTo.asc'),
        desc: t('table:grid.sortTo.desc'),
        none: t('table:grid.sortTo.none'),
      },
      columns: {
        button: t('table:toolbar.columns'),
        heading: t('table:config.title'),
      },
      reorderColumn: (name) => t('table:config.reorder', { name }),
      reorderHint: t('table:config.reorderHint'),
      // The interpolation bags are spread into fresh literals rather than
      // forwarded: i18next types `options` as an indexable `$Dictionary`, and a
      // named interface (however matching) has no index signature.
      reorderAnnouncements: {
        picked: ({ name, position, total }) =>
          t('table:config.dnd.picked', { name, position, total }),
        over: ({ name, position, total }) => t('table:config.dnd.over', { name, position, total }),
        dropped: ({ name, position, total }) =>
          t('table:config.dnd.dropped', { name, position, total }),
        cancelled: ({ name, position }) => t('table:config.dnd.cancelled', { name, position }),
      },
      density: {
        label: t('common:grid.density.label'),
        comfortable: t('common:grid.density.comfortable'),
        compact: t('common:grid.density.compact'),
      },
      facet: {
        clear: t('common:actions.clear'),
        clearAria: (name) => t('table:filters.clearOne', { name }),
        searchPlaceholder: t('common:actions.search'),
      },
      empty: t('common:states.noResults'),
      actionsHeader: t('common:actions.more'),
      footer: {
        range: ({ from, to, total }) => t('table:footer.range', { from, to, total }),
        page: ({ page, pages }) => t('table:footer.page', { page, pages }),
        rowsPerPage: t('table:footer.rowsPerPage'),
        previous: t('table:footer.previous'),
        next: t('table:footer.next'),
      },
    }),
    [t],
  );
}

/** Every string {@link PanelCard} resolves for itself. */
export interface PanelChromeCopy {
  /** Accessible name for the info button: "What this chart shows". */
  infoLabel: string;
  /** Fallback heading for the empty branch, when the caller supplies none. */
  emptyTitle: string;
}

/** Resolves {@link PanelChromeCopy} for the active language. */
export function usePanelChromeCopy(): PanelChromeCopy {
  const { t } = useTranslation(['reports', 'common']);

  return useMemo<PanelChromeCopy>(
    () => ({
      infoLabel: t('reports:card.infoLabel'),
      emptyTitle: t('common:states.empty'),
    }),
    [t],
  );
}

/** Every string the range picker renders that is not a Latin preset token. */
export interface RangeChromeCopy {
  /** Names the pill group for assistive tech. */
  groupLabel: string;
  /** The custom-window trigger's face while no day is picked. */
  custom: string;
}

/** Resolves {@link RangeChromeCopy} for the active language. */
export function useRangeChromeCopy(): RangeChromeCopy {
  const { t } = useTranslation(['common']);

  return useMemo<RangeChromeCopy>(
    () => ({
      groupLabel: t('common:grid.range.label'),
      custom: t('common:grid.range.custom'),
    }),
    [t],
  );
}
