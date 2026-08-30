/**
 * `palette` — the command palette (Ctrl/⌘+K), its topbar trigger, and the `?`
 * keyboard cheat sheet.
 *
 * WHAT IS *NOT* HERE, and must not be added: the names of the pages the palette
 * navigates to. Those are `common:nav.*`, the same strings the sidebar renders.
 * A palette with its own word for "Backlog" is a second vocabulary for one
 * product — the exact duplication WP3.8 spent a wave removing for the task
 * types. This namespace owns only the palette's OWN chrome: its section
 * headings, its two verbs, its states, and the shortcut descriptions.
 *
 * KEY CAPS ARE NOT STRINGS. `Ctrl`, `Esc`, `↵` and `⌘` are rendered from
 * `components/palette/chords.ts` and stay Latin in every language: they are
 * what is printed on the hardware, not prose about it.
 */
export default {
  title: 'Command palette',
  description: 'Search FlowBoard, jump to a page, or start something new.',
  placeholder: 'Search tasks, or jump to a page…',
  inputLabel: 'Search or run a command',
  /** The topbar button's accessible name. */
  trigger: 'Search',
  empty: 'No matches for “{{query}}”',

  /** The two lanes, in list order. */
  lanes: {
    navigation: 'Go to',
    tasks: 'Tasks',
  },

  /** Which part of the app a navigation row belongs to, shown beside it. */
  sections: {
    project: 'Project',
    organization: 'Organization',
    workspace: 'Workspace',
    admin: 'Administration',
    actions: 'Actions',
  },

  /** The palette's own verbs — rows that do something instead of going somewhere. */
  actions: {
    createTask: 'Create task…',
    openThemeStudio: 'Open Theme Studio',
    openDiagnostics: 'Open diagnostics',
  },

  tasks: {
    searching: 'Searching…',
    none: 'No tasks match “{{query}}”',
    error: 'Search is unavailable right now',
  },

  /** The hint row along the bottom. The caps beside these are not translated. */
  footer: {
    navigate: 'navigate',
    open: 'open',
    close: 'close',
  },

  shortcuts: {
    title: 'Keyboard shortcuts',
    description: 'Every shortcut currently active in this session.',

    /** One per registered chord, resolved from its `descriptionKey`. */
    openPalette: 'Open the command palette',
    cheatSheet: 'Show this list',
    createTask: 'Create a task in this project',
    themeStudio: 'Open the Theme Studio',

    /** The registry's three buckets. */
    groups: {
      navigation: 'Anywhere',
      tasks: 'Tasks',
      system: 'System',
    },

    /**
     * The fence between the two halves of the dialog: above it, chords that
     * fire anywhere; below it, keys that only work on the thing you are on.
     */
    contextualNote: 'These keys work on whatever has focus.',

    contextual: {
      board: {
        title: 'Board',
        pickUp: 'Pick up the focused card',
        move: 'Move it between columns and positions',
        drop: 'Drop it',
        cancel: 'Cancel the move',
        open: 'Open the focused card',
      },
      table: {
        title: 'Table',
        move: 'Move between cells',
        edit: 'Edit the focused cell',
        page: 'Jump ten rows',
        edges: 'First or last column (with Ctrl: first or last row)',
      },
      roadmap: {
        title: 'Roadmap',
        nudge: 'Move the focused bar by a day',
        resize: 'Move its end date by a day',
        open: 'Open the focused task',
      },
      /**
       * NOT called "Anywhere": that is the heading of the REGISTERED
       * navigation group above, and two identical headings either side of the
       * fence would undo the one distinction this dialog is drawing.
       */
      anywhere: {
        title: 'Panels',
        escape: 'Close the open panel',
      },
    },
  },
} as const;
