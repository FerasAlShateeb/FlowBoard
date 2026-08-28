/**
 * `table` — the spreadsheet view: an editable grid over one page of tasks, with
 * server-side sort, filters, configurable columns and a CSV export.
 *
 * SCOPE NOTE. The task TYPE and PRIORITY names are NOT here — they live in
 * `common:taskType` / `common:priority` and are read through
 * `useTaskVocabulary()`. Wave 3 built seven views in parallel with one namespace
 * file each, which duplicated that vocabulary four times; WP3.8 consolidated it.
 *
 * `as const` is load-bearing — `i18n/i18next.d.ts` types `t()` against
 * `typeof en`, so widening these to `string` would lose key checking.
 */
export default {
  title: 'Table',
  subtitle: 'Every task in {{project}}, editable in place.',

  /** Column headers. Also the CSV header row and the column-config list. */
  columns: {
    key: 'Key',
    title: 'Title',
    type: 'Type',
    status: 'Status',
    priority: 'Priority',
    assignee: 'Assignee',
    points: 'Points',
    sprint: 'Sprint',
    labels: 'Labels',
    startDate: 'Start date',
    dueDate: 'Due date',
    updatedAt: 'Updated',
  },

  /**
   * The grid itself — the strings a screen reader relies on. `sortTo.*` names
   * the ACTION a header button performs, because `aria-sort` already announces
   * the state and a button whose name never changes says nothing about what
   * pressing it does.
   */
  grid: {
    label: 'Tasks',
    openTask: 'Open {{key}}',
    saving: 'Saving',
    sortTo: {
      asc: 'Sort ascending',
      desc: 'Sort descending',
      none: 'Clear sort',
    },
    empty: 'No tasks yet',
    emptyBody: 'Create the first task and it will show up here.',
    noMatches: 'No tasks match these filters',
    noMatchesBody: 'Clear a filter or widen the search to see more.',
    readOnly: 'You have read-only access to this project, so cells are not editable.',
  },

  /** Accessible names for the inline editors, and their two extra actions. */
  editors: {
    title: 'Edit title',
    type: 'Edit type',
    status: 'Edit status',
    priority: 'Edit priority',
    assignee: 'Edit assignee',
    points: 'Edit story points',
    sprint: 'Edit sprint',
    labels: 'Edit labels',
    noLabels: 'This project has no labels yet.',
    pickDate: 'Pick a date',
    clearDate: 'Clear date',
  },

  /** The toolbar above the grid. */
  toolbar: {
    searchLabel: 'Search tasks',
    searchPlaceholder: 'Search by title or key…',
    filters: 'Filters',
    clearFilters: 'Clear filters',
    columns: 'Columns',
    columnsCount: '{{shown}} of {{total}}',
    export: 'Export CSV',
    exporting: 'Preparing…',
    /** The tooltip on the export button — the cap is a real, visible limit. */
    exportHint:
      'Downloads every task matching the current filters, in the visible columns, up to {{cap}} rows.',
    exported_one: 'Exported 1 task.',
    exported_other: 'Exported {{count}} tasks.',
    exportEmpty: 'Nothing to export with these filters.',
    exportCapped: 'Exported the first {{cap}} tasks — narrow the filters for the rest.',
    exportFailed: 'The export could not be completed.',
  },

  /** The filter popovers and the chip row underneath them. */
  filters: {
    status: 'Status',
    type: 'Type',
    priority: 'Priority',
    assignee: 'Assignee',
    label: 'Label',
    sprint: 'Sprint',
    unassigned: 'Unassigned',
    backlog: 'Backlog',
    active: 'Active filters',
    searchChip: 'Search: {{value}}',
    clearOne: 'Clear the {{name}} filter',
    clearSearch: 'Clear the search',
    empty: 'Nothing to choose from yet.',
    countBadge: '{{count}}',
  },

  /** The column-configuration popover. */
  config: {
    title: 'Columns',
    description: 'Choose what to show, and drag to reorder.',
    reset: 'Reset to default',
    toggle: 'Show the {{name}} column',
    locked: 'The key column is always shown.',
    reorder: 'Reorder {{name}}',
    reorderHint: 'Press space to pick up, arrow keys to move, space to drop.',

    /**
     * Screen-reader narration for the column drag, read by dnd-kit (WP5.1).
     *
     * `reorderHint` above doubles as the library's `screenReaderInstructions`;
     * these four replace its built-in English commentary, which announces the
     * opaque droppable INDEX rather than the column that moved.
     */
    dnd: {
      picked: 'Picked up {{name}}, column {{position}} of {{total}}.',
      over: '{{name}} is now column {{position}} of {{total}}.',
      dropped: 'Dropped {{name}} as column {{position}} of {{total}}.',
      cancelled: 'Cancelled. {{name}} stayed at column {{position}}.',
    },
  },

  /** The pagination footer. */
  footer: {
    /** `1–25 of 312`. Digits stay Western in every language. */
    range: '{{from}}–{{to}} of {{total}}',
    empty: 'No tasks',
    rowsPerPage: 'Rows per page',
    previous: 'Previous page',
    next: 'Next page',
    page: 'Page {{page}} of {{pages}}',
  },
} as const;
