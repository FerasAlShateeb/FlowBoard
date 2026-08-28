/**
 * `notifications` — the bell menu and the notification centre (WP4.2).
 *
 * ═══ THE COPY RULE FOR THIS NAMESPACE ═════════════════════════════════════
 *
 * Every row is ONE SENTENCE in the past tense, naming the person and the thing:
 * "Ada Lovelace commented on FLOW-142". Not "New comment" — a notification list
 * is read at a glance, and the two facts a reader needs before deciding to
 * click are WHO and WHAT. The task key carries the sentence's weight, so it is
 * always the interpolated `{{task}}`, never a bare "a task".
 *
 * `sentence.*` has EXACTLY the seven keys of the shared `notificationType`
 * enum, and a test asserts that both catalogs resolve all seven. A type without
 * a sentence would render its own key into the bell.
 *
 * FALLBACKS ARE REAL STRINGS, not blanks. A notification's payload is a
 * snapshot, and an old row written before a field existed (or one whose actor
 * has since been deleted) still has to read as English — hence `someone` and
 * `aTask`.
 *
 * NO i18next PLURALS IN THIS NAMESPACE — by CHOICE. Counts render as a bare
 * figure inside a labelled accessible name, which needs no grammar and reads
 * the same at 1 and at 12 in both languages. Plurals are AVAILABLE if a
 * sentence ever needs them: `i18n/locales.test.ts` has understood the CLDR
 * asymmetry since WP5.1 (English `_one`/`_other`, Arabic all six categories).
 * The old wording here implied Arabic's six categories made plurals
 * impossible; they only make a naive key-for-key diff wrong, and that diff was
 * fixed.
 */
export default {
  title: 'Notifications',
  description: 'Everything that happened on the work you follow.',

  /** The topbar bell and its dropdown. */
  bell: {
    label: 'Notifications',
    /** Accessible name for the badge — the count is never left to the glyph. */
    unreadLabel: 'Notifications, unread: {{count}}',
    /** The badge caps here rather than widening the topbar. */
    overflow: '99+',
    heading: 'Notifications',
    viewAll: 'View all',
    empty: 'Nothing new',
  },

  tabs: {
    all: 'All',
    unread: 'Unread',
  },

  actions: {
    markAllRead: 'Mark all as read',
    markRead: 'Mark as read',
    loadMore: 'Load more',
    open: 'Open {{task}}',
  },

  /** Day headings on the notification centre. Anything older gets a date. */
  groups: {
    today: 'Today',
    yesterday: 'Yesterday',
  },

  /** One per `notificationType`. See the copy rule above. */
  sentence: {
    task_assigned: '{{actor}} assigned {{task}} to you',
    mentioned: '{{actor}} mentioned you in {{task}}',
    status_changed: '{{actor}} moved {{task}} to a new status',
    comment_added: '{{actor}} commented on {{task}}',
    sprint_started: '{{actor}} started {{sprint}}',
    sprint_completed: '{{actor}} completed {{sprint}}',
    due_soon: '{{task}} is due soon',
  },

  /** Stand-ins for a snapshot field an old row does not carry. */
  fallback: {
    someone: 'Someone',
    aTask: 'a task',
    aSprint: 'a sprint',
  },

  /** The three states every list owes the reader, plus the unread variant. */
  states: {
    loading: 'Loading notifications…',
    emptyTitle: 'No notifications yet',
    emptyBody:
      'When someone assigns you work, mentions you or comments on a task you follow, it shows up here.',
    emptyUnreadTitle: 'You are all caught up',
    emptyUnreadBody: 'Every notification has been read.',
    // Only the HEADING: the body of an error state is the localized
    // `ApiError.code` sentence that `ErrorState` derives from the failure
    // itself, which says something specific instead of "try again".
    errorTitle: 'Could not load your notifications',
  },

  /** Screen-reader marker on an unread row — the dot alone says nothing. */
  unread: 'Unread',
  markedAllRead: 'All notifications marked as read.',
} as const;
