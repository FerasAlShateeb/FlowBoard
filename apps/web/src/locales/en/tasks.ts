/**
 * `tasks` — the task detail sheet: header, description, fields sidebar,
 * subtasks, dependencies, comments, attachments and the activity history.
 *
 * The RULE this file follows: a verb that exists in `common:actions` is never
 * re-declared here. "Save", "Cancel", "Delete", "Edit", "Add", "Remove", "Copy"
 * and "Close" all live there, and the sheet uses them — so a wording change
 * lands in one place and an Arabic reader never sees two spellings of the same
 * button.
 *
 * `activity.*` is the one section with a hard structural contract: it carries
 * ONE sentence per member of the shared `activityActionSchema` enum, keyed by
 * the action itself (`activity.task.status_changed`). The enum is closed
 * precisely so that mapping can be exhaustive, and
 * `components/tasks/activity-format.test.ts` fails the build if a new action
 * ever arrives without a sentence.
 *
 * `as const` is load-bearing — `i18n/i18next.d.ts` types `t()` against
 * `typeof en`.
 */
export default {
  /** The word "task" as a section heading. */
  title: 'Task',

  /** The route-layered sheet itself. */
  sheet: {
    label: 'Task details',
    loading: 'Loading task…',
    notFoundTitle: 'That task does not exist',
    notFoundBody: 'It may have been deleted, or the link may be for another project.',
    backToView: 'Back to the previous view',
  },

  /** The header bar: key, type, status, watching, overflow. */
  header: {
    copyLink: 'Copy link to this task',
    changeType: 'Change issue type',
    changeStatus: 'Change status',
    watch: 'Watch this task',
    unwatch: 'Stop watching',
    watching: 'Watching',
    /**
     * NOT an i18next plural (`_one`/`_other`) — because it does not need to be:
     * "{{count}} watching" reads correctly at every number in both languages.
     *
     * It is not forbidden, either. `i18n/locales.test.ts` diffs the catalogs for
     * key parity WITH a plural exemption since WP5.1 (English declares
     * `_one`/`_other`, Arabic declares all six CLDR categories for the same
     * base), so a phrase that genuinely inflects should use one.
     */
    watcherCount: '{{count}} watching',
    more: 'More actions',
    delete: 'Delete task',
    deleteTitle: 'Delete {{key}}?',
    deleteBody: 'The task and its subtasks will be removed from every view. This cannot be undone.',
    transitionBlocked: 'The workflow does not allow moving from {{from}} to {{to}}.',
    reporterPrefix: 'Reported by',
  },

  /** The three closed status categories. */
  category: {
    todo: 'To do',
    in_progress: 'In progress',
    done: 'Done',
  },

  /** The fields sidebar. */
  fields: {
    heading: 'Details',
    assignee: 'Assignee',
    unassigned: 'Unassigned',
    reporter: 'Reporter',
    priority: 'Priority',
    storyPoints: 'Story points',
    storyPointsHint: 'Halves are allowed — 0.5, 1, 2, 3, 5.',
    startDate: 'Start date',
    dueDate: 'Due date',
    pickDate: 'Pick a date',
    /** Interpolated with the field name so the two clear buttons differ. */
    clearDate: 'Clear {{field}}',
    overdue: 'Overdue',
    sprint: 'Sprint',
    backlog: 'Backlog',
    epic: 'Epic',
    noEpic: 'No epic',
    labels: 'Labels',
    noLabels: 'No labels',
    searchLabels: 'Search labels…',
    createLabel: 'Create “{{name}}”',
    noLabelMatches: 'No labels match',
    created: 'Created',
    updated: 'Updated',
    resolved: 'Resolved',
    saving: 'Saving…',
    readOnly: 'You have read-only access to this project.',
  },

  /** The markdown description block. */
  description: {
    heading: 'Description',
    empty: 'No description yet.',
    add: 'Add a description',
    edit: 'Edit description',
    placeholder: 'Describe the work. Markdown is supported, and @ mentions someone.',
    submitHint: 'Ctrl/⌘ + Enter to save, Escape to cancel.',
  },

  /** The @mention autocomplete inside `MentionTextarea`. */
  mention: {
    label: 'Mention someone',
    empty: 'No one matches that',
    hint: 'Type @ to mention a teammate',
  },

  /** The subtask checklist. */
  subtasks: {
    heading: 'Subtasks',
    progress: '{{done}} of {{total}} done',
    empty: 'No subtasks yet.',
    add: 'Add a subtask',
    placeholder: 'What needs doing?',
    create: 'Add',
    parentHeading: 'Parent',
    parentHint: 'Subtasks cannot have subtasks of their own.',
  },

  /** The two dependency directions. */
  dependencies: {
    heading: 'Dependencies',
    blockedBy: 'Blocked by',
    blocks: 'Blocks',
    empty: 'No dependencies.',
    addBlockedBy: 'Add a blocker',
    addBlocks: 'Add a blocked task',
    search: 'Search tasks by key or title…',
    noMatches: 'No tasks match',
    remove: 'Remove dependency',
  },

  /** The comment thread and its composer. */
  comments: {
    heading: 'Comments',
    empty: 'No comments yet. Start the conversation.',
    placeholder: 'Leave a comment. @ mentions someone.',
    submit: 'Comment',
    edited: 'edited',
    editLabel: 'Edit comment',
    deleteLabel: 'Delete comment',
    deleteTitle: 'Delete this comment?',
    deleteBody: 'The comment will be removed for everyone. This cannot be undone.',
  },

  /** The dropzone and the attachment list. */
  attachments: {
    heading: 'Attachments',
    empty: 'No files attached.',
    drop: 'Drop files here, or',
    browse: 'browse',
    /** The hidden file input's accessible name — distinct from the section's. */
    choose: 'Choose files to attach',
    dropActive: 'Release to upload',
    uploading: 'Uploading…',
    failed: 'Upload failed',
    dismiss: 'Dismiss',
    download: 'Download',
    remove: 'Delete attachment',
    removeTitle: 'Delete {{name}}?',
    removeBody: 'The file will be removed permanently. This cannot be undone.',
    uploadedBy: 'Added by {{name}}',
    maxSize: 'Files up to {{size}}.',
  },

  /** The bottom tab strip. */
  tabs: {
    comments: 'Comments',
    activity: 'Activity',
  },

  /**
   * The audit history.
   *
   * One sentence per member of the closed `activityActionSchema` enum. EVERY
   * sentence names `{{actor}}` first — that keeps the interpolation contract
   * uniform across a map the renderer indexes dynamically, and it is also how
   * the feed reads best.
   */
  activity: {
    heading: 'Activity',
    empty: 'Nothing has happened here yet.',
    loadMore: 'Load more',
    system: 'FlowBoard',

    task: {
      created: '{{actor}} created this task',
      field_changed: '{{actor}} changed {{field}} from {{from}} to {{to}}',
      status_changed: '{{actor}} moved this from {{from}} to {{to}}',
      assigned: '{{actor}} assigned this to {{to}}',
      moved_sprint: '{{actor}} moved this to {{to}}',
      ranked: '{{actor}} reordered this task',
      deleted: '{{actor}} deleted this task',
    },
    comment: {
      added: '{{actor}} commented',
      edited: '{{actor}} edited a comment',
      deleted: '{{actor}} deleted a comment',
    },
    attachment: {
      added: '{{actor}} attached {{to}}',
      deleted: '{{actor}} removed the attachment {{from}}',
    },
    dependency: {
      added: '{{actor}} added a dependency',
      removed: '{{actor}} removed a dependency',
    },
    watcher: {
      added: '{{actor}} started watching',
      removed: '{{actor}} stopped watching',
    },
    label: {
      added: '{{actor}} added the label {{to}}',
      removed: '{{actor}} removed the label {{from}}',
    },
    sprint: {
      created: '{{actor}} created a sprint',
      started: '{{actor}} started a sprint',
      completed: '{{actor}} completed a sprint',
      deleted: '{{actor}} deleted a sprint',
    },
    workflow: {
      changed: '{{actor}} changed the workflow',
    },
    project: {
      created: '{{actor}} created the project',
      updated: '{{actor}} updated the project',
      deleted: '{{actor}} deleted the project',
    },
    member: {
      added: '{{actor}} added a project member',
      removed: '{{actor}} removed a project member',
    },

    /** Placeholder for a value that was empty on one side of a change. */
    nothing: 'nothing',

    /** Field names as they read inside a sentence. */
    field: {
      title: 'the title',
      description: 'the description',
      type: 'the issue type',
      statusId: 'the status',
      priority: 'the priority',
      assigneeId: 'the assignee',
      storyPoints: 'the story points',
      startDate: 'the start date',
      dueDate: 'the due date',
      sprintId: 'the sprint',
      epicId: 'the epic',
      parentId: 'the parent',
      labelIds: 'the labels',
      unknown: 'a field',
    },
  },

  /** The standalone create dialog (used by the board, backlog and palette). */
  create: {
    title: 'Create task',
    submit: 'Create',
    titleField: 'Title',
    titlePlaceholder: 'A short summary of the work',
    typeField: 'Type',
    statusField: 'Status',
    assigneeField: 'Assignee',
    priorityField: 'Priority',
    pointsField: 'Story points',
    sprintField: 'Sprint',
    labelsField: 'Labels',
    descriptionField: 'Description',
    descriptionPlaceholder: 'Optional. Markdown is supported.',
  },
} as const;
