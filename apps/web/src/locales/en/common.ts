/**
 * `common` — the default namespace. Strings that belong to no single page: the
 * button verbs, navigation labels, generic states, and the app-level error
 * screen.
 *
 * The rule: anything reused by three or more surfaces lands here; anything
 * owned by one view belongs in that view's own namespace (Wave 3 adds
 * `board`, `backlog`, `roadmap`, `table`, `calendar`, `reports`).
 *
 * `as const` is load-bearing — `i18n/i18next.d.ts` types `t()` against
 * `typeof en`, so widening these to `string` would lose key checking.
 */
export default {
  /** The product name. A BRAND — never translated, in any locale. */
  brand: 'FlowBoard',

  /** Verbs. One per action, reused everywhere — never re-declare these locally. */
  actions: {
    save: 'Save',
    cancel: 'Cancel',
    close: 'Close',
    delete: 'Delete',
    edit: 'Edit',
    create: 'Create',
    search: 'Search',
    filter: 'Filter',
    retry: 'Try again',
    back: 'Back',
    next: 'Next',
    confirm: 'Confirm',
    copy: 'Copy',
    copied: 'Copied',
    reload: 'Reload',
    signIn: 'Sign in',
    signOut: 'Sign out',
    add: 'Add',
    remove: 'Remove',
    apply: 'Apply',
    clear: 'Clear',
    saveChanges: 'Save changes',
    saving: 'Saving…',
    manage: 'Manage',
    open: 'Open',
    refresh: 'Refresh',
    more: 'More actions',
    done: 'Done',
  },

  /** Generic view states. Every page owes the user all three. */
  states: {
    loading: 'Loading…',
    empty: 'Nothing here yet',
    error: 'Something went wrong',
    errorBody: 'That did not load. Try again in a moment.',
    noResults: 'No matches',
    offline: 'You appear to be offline',
  },

  /** Destructive-action confirmations, phrased as questions with a named verb. */
  confirm: {
    title: 'Are you sure?',
    deleteTitle: 'Delete {{name}}?',
    deleteBody: 'This cannot be undone.',
    discardTitle: 'Discard changes?',
    discardBody: 'Your edits will be lost.',
    /** The typed-name gate on the most destructive confirmations. */
    typeToConfirm: 'Type {{value}} to confirm',
  },

  /**
   * The person picker (`common/UserSelect`), reused by every assignee, lead and
   * membership field in the app.
   */
  picker: {
    search: 'Search people…',
    empty: 'No one matches that',
    unassigned: 'Unassigned',
    selectPerson: 'Select a person',
    clearSelection: 'Clear selection',
  },

  /**
   * `common/ErrorState` — the third of the three states every page owes the
   * user. The MESSAGE is supplied by the caller (a localized API error); these
   * are the frame around it.
   */
  errorState: {
    title: 'That did not load',
    retry: 'Try again',
  },

  /** Sidebar / topbar chrome. */
  nav: {
    sidebarLabel: 'Main navigation',
    projectSection: 'Project',
    workspaceSection: 'Workspace',
    adminSection: 'Administration',
    home: 'Home',
    board: 'Board',
    backlog: 'Backlog',
    roadmap: 'Roadmap',
    table: 'Table',
    calendar: 'Calendar',
    dashboard: 'Dashboard',
    projectSettings: 'Project settings',
    general: 'General',
    workflow: 'Workflow',
    labels: 'Labels',
    task: 'Task',
    invite: 'Invitation',
    organization: 'Organization',
    teams: 'Teams',
    members: 'Members',
    orgSettings: 'Organization settings',
    notifications: 'Notifications',
    profile: 'My profile',
    theme: 'Theme',
    adminUsers: 'Users',
    adminTelemetry: 'Telemetry',
    adminTelemetryEvents: 'Telemetry events',
    adminTelemetryRequests: 'Request analytics',
    collapseSidebar: 'Collapse sidebar',
    expandSidebar: 'Expand sidebar',
    openMenu: 'Open navigation menu',
    switchOrg: 'Switch organization',
    noOrganization: 'No organization',
    userMenu: 'Account menu',
    breadcrumb: 'Breadcrumb',
  },

  /** Appearance controls that live in the topbar. */
  appearance: {
    toggleDark: 'Switch to dark mode',
    toggleLight: 'Switch to light mode',
  },

  /** The language switcher. */
  language: {
    label: 'Language',
    hint: 'Switches the interface language and text direction. Stored on this device.',
    changed: 'Language: {{name}}',
    english: 'English',
    arabic: 'العربية',
  },

  /**
   * Copy baked into the `components/ui/*` primitives themselves rather than
   * into any one surface — the primitives are shared by every page, which is
   * precisely what makes `common` their namespace.
   *
   * `calendar.*` overrides react-day-picker's `labels`, which are hard-coded
   * English regardless of the `locale` handed to `DayPicker` (unlike the month
   * names and weekday headers, which follow date-fns). The English here is
   * byte-for-byte the upstream default, so the strings a screen-reader user
   * already knows do not shift under them.
   */
  ui: {
    calendar: {
      previousMonth: 'Go to the Previous Month',
      nextMonth: 'Go to the Next Month',
      chooseMonth: 'Choose the Month',
      chooseYear: 'Choose the Year',
    },
    command: {
      placeholder: 'Type a command or search…',
      empty: 'No results found.',
    },
  },

  /** The placeholder every not-yet-built page renders (`common/PageStub`). */
  stub: {
    body: 'This view is arriving in a later wave.',
    wave: 'Planned for {{wave}}',
  },

  /**
   * The app-level error screen (`routes/RouteErrorScreen`). `updating` is the
   * stale-chunk case: a deploy replaced the bundle under an open tab, so the
   * fix is a reload, not a bug report.
   */
  appError: {
    title: 'Something went wrong',
    description:
      'This page hit an unexpected error. Reloading usually clears it — if it keeps happening, head back to the start.',
    updating: 'Updating to the latest version…',
    reload: 'Reload',
    home: 'Go home',
  },

  /** 404. */
  notFound: {
    title: 'Page not found',
    description: 'That link does not lead anywhere in FlowBoard.',
  },

  /**
   * THE TASK VOCABULARY — the five issue types and the five-step priority
   * scale, in ONE place.
   *
   * WHY IT LIVES IN `common` (WP3.8). These ten words were defined FOUR times —
   * once each in `board`, `backlog`, `table` and `tasks` — with three different
   * key shapes (`types.*`, `type.*`), which is exactly what this namespace's
   * rule at the top of this file exists to prevent: anything reused by three or
   * more surfaces belongs here. Four copies is not four opportunities to phrase
   * a word differently; it is four places for an Arabic translator to be asked
   * the same question and three chances to answer it inconsistently.
   *
   * Read them through `useTaskVocabulary()` (`components/common/
   * task-vocabulary.ts`) rather than composing `` t(`common:taskType.${type}`) ``
   * at the call site: that hook holds a LITERAL key map, so renaming a key here
   * is a compile error instead of a raw `common:taskType.bug` on screen.
   */
  taskType: {
    epic: 'Epic',
    story: 'Story',
    task: 'Task',
    bug: 'Bug',
    subtask: 'Subtask',
  },

  /** Priority scale, lowest to highest. */
  priority: {
    lowest: 'Lowest',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
    highest: 'Highest',
  },

  /**
   * The accessible names for a BARE type/priority glyph.
   *
   * A lone chevron announced as "Highest" says nothing; "Priority: Highest" is
   * the whole sentence. These are the frames every view's icon uses, so a card,
   * a backlog row and a table cell describe themselves identically.
   */
  taskTypeLabel: 'Type: {{type}}',
  priorityLabel: 'Priority: {{priority}}',
} as const;
