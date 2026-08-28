/**
 * `backlog` — the sprint-planning view (WP3.3).
 *
 * COPY RULE for this namespace: scrum vocabulary is the user's vocabulary, so
 * "sprint", "backlog", "story points" stay as they are; everything AROUND them
 * says plainly what an action will do, because two of them (start, complete)
 * stamp numbers that cannot be edited afterwards.
 *
 * NO i18next PLURALS IN THIS NAMESPACE — but by CHOICE, not by constraint.
 * Every count here is a chip or a header figure ("Tasks: 12"), which reads
 * correctly at any number in both languages and both directions and needs no
 * grammar at all. A sentence that genuinely inflects may use plurals: WP5.1
 * taught `i18n/locales.test.ts` the CLDR asymmetry — English declares `_one`
 * and `_other`, Arabic declares all six categories, and the parity diff allows
 * exactly that. (This note used to claim a plural pair would BREAK parity. It
 * would have, once; asserting it after the rule changed only discouraged
 * people from writing the correct Arabic.)
 *
 * THE TASK VOCABULARY IS NOT HERE. Issue types and priorities live in
 * `common:taskType` / `common:priority` and are read through
 * `useTaskVocabulary()` — WP3.8 folded four copies into one. Do not re-add them.
 */
export default {
  title: 'Backlog',
  description: 'Plan sprints and order what comes next. Drag work between the sections.',

  /** Buttons, menu items and the accessible names of icon-only controls. */
  actions: {
    newSprint: 'New sprint',
    editSprint: 'Edit sprint',
    startSprint: 'Start sprint',
    completeSprint: 'Complete sprint',
    deleteSprint: 'Delete sprint',
    renameSprint: 'Rename sprint',
    sprintMenu: 'Sprint actions',
    rowMenu: 'Task actions',
    collapse: 'Collapse section',
    expand: 'Expand section',
    reorder: 'Reorder task',
    moveTo: 'Move to',
    openTask: 'Open task',
  },

  /** The sprint lifecycle, as the header badge spells it. */
  states: {
    planned: 'Planned',
    active: 'Active',
    completed: 'Completed',
  },

  /** Section shells and the states their bodies can be in. */
  sections: {
    backlog: 'Backlog',
    sprintLabel: 'Sprint',
    emptySprint: 'Nothing planned yet — drag work in from the backlog.',
    emptyBacklog: 'The backlog is empty.',
    emptyBacklogHint: 'Add a task below, or move one out of a sprint.',
    noMatches: 'No tasks match that filter.',
    loadFailed: 'Could not load this section.',
  },

  /** The three header chips. The `label` keys are their accessible names. */
  summary: {
    tasksLabel: 'Tasks in this section',
    pointsLabel: 'Story points in this section',
    donePointsLabel: 'Completed story points',
    points: '{{points}} pts',
    donePoints: '{{points}} done',
    tasks: 'Tasks',
    storyPoints: 'Story points',
  },

  /** The planned date range beside a sprint name. */
  dates: {
    none: 'No dates set',
    range: '{{start}} – {{end}}',
    startOnly: 'From {{start}}',
    endOnly: 'Until {{end}}',
  },

  /** The create / edit sprint dialog. */
  form: {
    createTitle: 'New sprint',
    createDescription:
      'A new sprint starts out planned and empty. You can drag work into it straight away.',
    editTitle: 'Edit sprint',
    editDescription: 'Rename the sprint, restate its goal, or adjust the planned dates.',
    name: 'Name',
    namePlaceholder: 'Sprint 4',
    goal: 'Goal',
    goalPlaceholder: 'What should this sprint achieve?',
    startDate: 'Start date',
    endDate: 'End date',
    datesHint: 'Planned dates are optional — starting the sprint asks for the real ones.',
    created: 'Sprint created',
    updated: 'Sprint updated',
  },

  /** The start dialog: the commitment stamp. */
  start: {
    title: 'Start {{name}}',
    description:
      'The scope below is stamped as this sprint’s commitment. Velocity is measured against that number, so it does not change afterwards.',
    scope: 'Committed scope',
    empty: 'This sprint has no work in it yet. You can start it and drag work in afterwards.',
    confirm: 'Start sprint',
    started: '{{name}} is now running',
  },

  /** The complete dialog: what finished, and where the rest goes. */
  complete: {
    title: 'Complete {{name}}',
    description:
      'Finished work stays with the sprint and is stamped as its result. Everything unfinished has to move somewhere.',
    done: 'Done',
    notDone: 'Not done',
    moveIncompleteTo: 'Move unfinished work to',
    toBacklog: 'Backlog',
    allDone: 'Everything in this sprint is done.',
    confirm: 'Complete sprint',
    completed: '{{name}} completed',
  },

  /** The delete confirmation. */
  remove: {
    title: 'Delete {{name}}?',
    body: 'The sprint is removed and everything in it returns to the backlog. This cannot be undone.',
    deleted: 'Sprint deleted',
  },

  /** The inline create at the top of the backlog section. */
  quickAdd: {
    label: 'Add a task to the backlog',
    placeholder: 'What needs doing?',
    submit: 'Add',
    created: '{{key}} created',
  },

  /** The text box that narrows the backlog rows. */
  filter: {
    label: 'Filter the backlog',
    placeholder: 'Filter by title or key…',
    clear: 'Clear filter',
  },

  /** One dense task row. */
  row: {
    points: '{{points}} pts',
    pointsLabel: 'Story points',
    unassigned: 'Unassigned',
    noStatus: 'No status',
    moveToBacklog: 'Backlog',
  },

  /** The page with no sprints at all. */
  empty: {
    title: 'No sprints yet',
    body: 'Create a sprint to start planning. Until then, everything lives in the backlog.',
  },

  /**
   * Screen-reader narration for the drag, read by dnd-kit (WP5.1).
   *
   * Without these the library falls back to its own hard-coded ENGLISH
   * announcements ("Draggable item 3 was moved over droppable area 7"), which
   * are both untranslated on an Arabic page and useless on any page: an opaque
   * id is not a task and a droppable index is not a sprint. Every sentence here
   * names the TASK and the SECTION instead.
   */
  dnd: {
    instructions:
      'Press space to pick a task up. Use the arrow keys to move it between rows and sections, then press space to drop it. Press escape to cancel.',
    picked: 'Picked up {{key}} from {{section}}.',
    over: '{{key}} is now over {{section}}, position {{position}}.',
    dropped: 'Dropped {{key}} into {{section}} at position {{position}}.',
    cancelled: 'Cancelled. {{key}} stayed in {{section}}.',
  },
} as const;
