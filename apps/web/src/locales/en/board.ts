/**
 * `board` — the Kanban view (WP3.1), the product's signature screen.
 *
 * COPY RULE for this namespace: the board is a DIRECT-MANIPULATION surface, so
 * every string here is either a label on something you can grab, or an
 * explanation of why you cannot. Refusals name the RULE and the COLUMN
 * ("Workflow: In Review cannot move to Done"), never the mechanism — a user who
 * is told "transition not allowed" has learned nothing they can act on.
 *
 * NO i18next PLURALS IN THIS NAMESPACE — by CHOICE, not by constraint. Counts
 * render as a bare figure with a labelled accessible name ("Cards: 12"), which
 * reads correctly at any number in both languages and both directions and
 * needs no grammar. A sentence that genuinely inflects may use plurals:
 * `i18n/locales.test.ts` has supported the CLDR asymmetry since WP5.1 —
 * English declares `_one`/`_other`, Arabic declares all six categories, and the
 * parity diff allows exactly that. (This note used to claim a plural pair would
 * BREAK parity, which stopped being true two waves ago.)
 *
 * THE TASK VOCABULARY IS NOT HERE. Issue types and priorities were duplicated
 * across `board`, `backlog`, `table` and `tasks` while seven Wave-3 agents owned
 * disjoint files; WP3.8 folded them into `common:taskType` / `common:priority`,
 * read through `useTaskVocabulary()`. Do not re-add them.
 */
export default {
  title: 'Board',
  description: 'Drag cards between columns to move work through the workflow.',

  /** The three states every page owes the user, plus the two board-specific ones. */
  states: {
    noColumnsTitle: 'This project has no columns',
    noColumnsBody: 'A board needs at least one status. Add them in the project workflow settings.',
    emptyTitle: 'Nothing on the board yet',
    emptyBody: 'Add the first card to a column and it will show up here.',
    noMatchesTitle: 'No cards match these filters',
    noMatchesBody: 'Loosen a filter, or clear them all to see the whole board.',
    loading: 'Loading the board…',
  },

  /** The column header and its drop area. */
  column: {
    /** Accessible name for the bare count chip in the header. */
    count: 'Cards: {{count}}',
    add: 'Add a card to {{status}}',
    empty: 'No cards',
    dropHere: 'Drop here',
    region: '{{status}} column',
  },

  /** The WIP-limit badge. `badge` is figures only and is identical in Arabic. */
  wip: {
    badge: '{{count}}/{{limit}}',
    label: 'Work in progress: {{count}} of a limit of {{limit}}',
    atLimit: 'At the WIP limit',
    over: 'Over the WIP limit',
    none: 'No WIP limit',
  },

  /** The card itself. */
  card: {
    open: 'Open {{key}}',
    points: '{{points}} pts',
    pointsLabel: 'Story points: {{points}}',
    due: 'Due {{date}}',
    overdue: 'Overdue, was due {{date}}',
    moreLabels: '+{{count}}',
    labelsLabel: 'Labels: {{names}}',
    unassigned: 'Nobody is assigned',
    assignedTo: 'Assigned to {{name}}',
    hasDescription: 'Has a description',
    comments: 'Comments: {{count}}',
    attachments: 'Attachments: {{count}}',
  },

  /** The inline composer in each column footer. */
  quickAdd: {
    open: 'Add a card',
    /** The composer FIELD's name — distinct from the buttons that open it. */
    label: 'New card in {{status}}',
    placeholder: 'What needs doing?',
    hint: 'Enter to add, Escape to cancel',
    submit: 'Add card',
    cancel: 'Cancel',
    created: 'Created {{key}}',
    readOnly: 'You need write access on this project to add cards.',
  },

  /** The filter bar above the canvas. */
  filters: {
    label: 'Board filters',
    searchPlaceholder: 'Search cards…',
    searchLabel: 'Search cards by title or key',
    assignee: 'Assignee',
    type: 'Type',
    priority: 'Priority',
    labels: 'Labels',
    unassigned: 'Unassigned',
    optionSearch: 'Search…',
    noOptions: 'Nothing to choose from',
    noMatches: 'No matches',
    clearAll: 'Clear filters',
    activeLabel: 'Active filters: {{count}}',
    remove: 'Remove the {{name}} filter',
    queryChip: 'Search: {{value}}',
    selected: 'Selected: {{count}}',
  },

  /** Horizontal grouping. */
  swimlanes: {
    label: 'Swimlanes',
    none: 'No swimlanes',
    assignee: 'Group by assignee',
    epic: 'Group by epic',
    priority: 'Group by priority',
    noAssignee: 'Unassigned',
    noEpic: 'Not in an epic',
    epicName: 'Epic {{key}}',
    collapse: 'Collapse the {{name}} lane',
    expand: 'Expand the {{name}} lane',
    count: 'Cards in this lane: {{count}}',
    addRow: 'Add a card',
  },

  /** Why a drop is refused. Both name the rule AND the column. */
  drop: {
    blocked: 'That move is not allowed',
    transition: 'The workflow does not allow moving from {{from}} to {{to}}',
    wip: '{{status}} is already at its limit of {{limit}} cards',
  },

  /** Screen-reader announcements for the keyboard drag, read by dnd-kit. */
  dnd: {
    instructions:
      'Press space to pick up a card. Use the arrow keys to move it between cards and columns, then press space to drop it. Press escape to cancel.',
    picked: 'Picked up {{key}} from {{status}}.',
    over: '{{key}} is now over {{status}}.',
    dropped: 'Dropped {{key}} into {{status}}.',
    cancelled: 'Cancelled. {{key}} stayed in {{status}}.',
    blocked: '{{key}} cannot be dropped into {{status}}.',
  },
} as const;
