/**
 * `workflow` — the per-project workflow editor: the status columns and the
 * transition matrix.
 *
 * Its own namespace rather than a corner of `settings` because it is the single
 * densest editor in the product, and because the board (WP3.1) reuses this
 * vocabulary — category names, WIP wording, the "not allowed" phrasing — for
 * its column headers and forbidden-drop styling.
 */
export default {
  title: 'Workflow',
  subtitle: 'The columns of {{project}}’s board, and the moves allowed between them.',
  readOnly: 'You need project admin rights to change this workflow.',

  /** The status column list. */
  statuses: {
    title: 'Statuses',
    description: 'Every status is a board column. Drag to reorder.',
    empty: 'No statuses yet',
    emptyBody: 'A board needs at least one column before it can hold work.',
    add: 'Add status',
    addTitle: 'Add a status',
    addDescription: 'A new column, appended at the end of the board.',
    editName: 'Rename status',
    name: 'Name',
    namePlaceholder: 'In review',
    category: 'Category',
    color: 'Colour',
    wipLimit: 'WIP limit',
    wipLimitNone: 'No limit',
    wipLimitHint: 'The board warns when a column holds more than this.',
    reorder: 'Reorder status',
    reorderHint: 'Press space to pick a status up, arrow keys to move it, space to drop it.',
    created: 'Status added.',
    updated: 'Status updated.',
    reordered: 'Board order saved.',
    delete: 'Delete status',
    deleteTitle: 'Delete {{name}}?',
    deleteBody: 'The column disappears from the board. Its tasks have to go somewhere first.',
    moveTasksTo: 'Move its tasks to',
    deleted: 'Status deleted.',
    lastOne: 'A project needs at least one status.',
    tasksHere_one: '{{count}} task here',
    tasksHere_other: '{{count}} tasks here',
  },

  /** The three closed status categories. */
  categories: {
    todo: 'To do',
    in_progress: 'In progress',
    done: 'Done',
    todoHint: 'Not started. Where new work lands.',
    in_progressHint: 'Being worked on. Starts the cycle-time clock.',
    doneHint: 'Finished. Stamps the resolution date and closes the burndown.',
  },

  /** The from-status × to-status matrix. */
  transitions: {
    title: 'Transitions',
    description:
      'By default a task can move anywhere. Restrict a row to allow only the moves you tick.',
    empty: 'Add a second status to define transitions.',
    fromHeader: 'From',
    toHeader: 'To',
    restrict: 'Restrict',
    restrictLabel: 'Restrict moves out of {{name}}',
    unrestricted: 'Any status',
    unrestrictedHint: 'No restrictions: a task in this status can move to any other.',
    restrictedHint: 'Only the ticked statuses are reachable from here.',
    allow: 'Allow {{from}} → {{to}}',
    selfCell: 'Same status',
    noTargets: 'Pick at least one target, or turn the restriction off.',
    save: 'Save transitions',
    saved: 'Transitions saved.',
    unsaved: 'You have unsaved transition changes.',
    reset: 'Discard changes',
  },

  /**
   * Screen-reader narration for the status reorder, read by dnd-kit (WP5.1).
   *
   * `statuses.reorderHint` is the VISIBLE hint and doubles as the library's
   * `screenReaderInstructions`; these four are the running commentary. Without
   * them dnd-kit narrates its own English "Draggable item 2 was moved over
   * droppable area 4", which is untranslated on an Arabic page and says nothing
   * about which COLUMN moved where on either.
   */
  dnd: {
    picked: 'Picked up {{name}}, position {{position}} of {{total}}.',
    over: '{{name}} is now at position {{position}} of {{total}}.',
    dropped: 'Dropped {{name}} at position {{position}} of {{total}}.',
    cancelled: 'Cancelled. {{name}} stayed at position {{position}}.',
  },

  /** Shared with the board (WP3.1) for drop feedback. */
  rules: {
    transitionBlocked: '{{from}} → {{to}} is not allowed by this workflow.',
    wipReached: '{{name}} is at its WIP limit of {{limit}}.',
    wipExceeded: '{{name}} is over its WIP limit ({{count}}/{{limit}}).',
    wipBadge: '{{count}}/{{limit}}',
  },
} as const;
