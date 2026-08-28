/**
 * `admin` — the global-admin surfaces, which today means the three telemetry
 * pages (overview, request analytics, the raw event feed).
 *
 * THREE GROUPS THAT EARN THEIR OWN NOTE:
 *
 *   - `overview.*Hint` — every KPI carries a one-line definition under it, and
 *     the definition is the point. "DAU: 42" is a number two people will quote
 *     to mean two different things; "distinct signed-in users with any event
 *     today (UTC)" is a measurement. The hints spell out the exact windows the
 *     API computes against.
 *   - `eventType.*` — the closed enum from `@flowboard/shared`, one label per
 *     member. These are the only strings in the file whose KEYS are contract:
 *     adding an event type to the shared enum is a compile error here until the
 *     label exists, which is deliberate.
 *   - `*.summary` — the screen-reader sentence behind each chart's
 *     `role="img"`. It is the ONLY thing a non-sighted user gets from the plot,
 *     so it carries the headline numbers rather than describing the picture.
 *     Values are interpolated PRE-FORMATTED (Latin digits — see
 *     `lib/lang-policy`), so i18next never reformats them.
 */
export default {
  title: 'Administration',

  /**
   * The user directory (WP4.7).
   *
   * Two copy decisions worth keeping if this is ever rewritten:
   *
   *   - Every destructive action NAMES ITS SIDE EFFECT. Deactivating and
   *     resetting a password both revoke every session, and an admin who learns
   *     that from a support ticket instead of from the confirm dialog has been
   *     let down by the copy, not by the feature.
   *   - The temporary password is described as unrecoverable BEFORE it is
   *     dismissed, not after. The server never echoes it back, so "you will not
   *     see it again" is a fact about the system, not a warning about care.
   */
  users: {
    title: 'Users',
    description: 'Every account in the deployment. Provision, suspend and reset from here.',
    searchPlaceholder: 'Search name or email',
    searchLabel: 'Search users',

    filter: {
      status: 'Status',
      all: 'All accounts',
      active: 'Active only',
      inactive: 'Deactivated only',
    },

    column: {
      user: 'User',
      email: 'Email',
      role: 'Access',
      status: 'Status',
      created: 'Added',
      actions: 'Actions',
    },

    badge: {
      globalAdmin: 'Global admin',
      member: 'Member',
      active: 'Active',
      inactive: 'Deactivated',
      you: 'You',
    },

    empty: 'No accounts yet',
    emptyBody: 'Provision the first one to get started.',

    rowMenu: 'Actions for {{name}}',

    actions: {
      provision: 'Provision user',
      activate: 'Reactivate account',
      deactivate: 'Deactivate account',
      promote: 'Make global admin',
      demote: 'Revoke global admin',
      resetPassword: 'Reset password',
      forceLogout: 'Sign out everywhere',
    },

    provision: {
      title: 'Provision a user',
      description:
        'Creates the account immediately. There is no invitation email — you hand over the temporary password yourself.',
      name: 'Full name',
      email: 'Email',
      emailHint: 'Used to sign in. Case-insensitive and unique across the deployment.',
      globalAdmin: 'Grant global administrator',
      globalAdminHint: 'Full access to every organization, plus these admin pages.',
      submit: 'Create account',
      created: 'Account created for {{name}}',
    },

    password: {
      title: 'Temporary password',
      description:
        'Copy this now — it is not stored anywhere you can read it back, and closing this dialog is the last time it is shown.',
      label: 'Temporary password',
      regenerate: 'Generate a different one',
      done: 'I have copied it',
      resetTitle: 'Reset {{name}}’s password',
      resetDescription:
        'The new password below replaces the old one and signs the account out of every device.',
      resetSubmit: 'Reset password',
      resetDone: 'Password reset for {{name}}',
    },

    confirm: {
      deactivateTitle: 'Deactivate {{name}}?',
      deactivateBody:
        'They lose access immediately and every one of their sessions is revoked. You can reactivate the account later; nothing is deleted.',
      activateTitle: 'Reactivate {{name}}?',
      activateBody: 'They will be able to sign in again with their existing password.',
      promoteTitle: 'Make {{name}} a global administrator?',
      promoteBody:
        'They gain full access to every organization in the deployment, and to these administration pages.',
      demoteTitle: 'Revoke {{name}}’s global administrator access?',
      demoteBody: 'They keep their organization memberships and lose everything above them.',
      forceLogoutTitle: 'Sign {{name}} out everywhere?',
      forceLogoutBody:
        'Every access and refresh token is revoked. They stay active and can sign in again straight away.',
    },

    toast: {
      activated: '{{name}} reactivated',
      deactivated: '{{name}} deactivated',
      promoted: '{{name}} is now a global admin',
      demoted: '{{name}} is no longer a global admin',
      loggedOut: '{{name}} signed out everywhere',
    },

    selfGuard: 'You cannot change your own access from here.',
  },

  /** Units, kept out of the sentences so a number never carries one. */
  units: {
    ms: 'ms',
  },

  /** The window chips, shared by all three pages. */
  range: {
    label: 'Time range',
    all: 'All time',
    '24h': 'Last 24 hours',
    '7d': 'Last 7 days',
    '30d': 'Last 30 days',
  },

  /** The granularity toggle on the requests page. */
  bucket: {
    label: 'Granularity',
    hour: 'Hourly',
    day: 'Daily',
  },

  telemetry: {
    title: 'Telemetry',
    description: 'What people are doing in FlowBoard, and how the API is holding up.',
  },

  /** The KPI row. Each hint states the exact window the number is measured over. */
  overview: {
    dau: 'Active users',
    dauHint: 'Distinct users with any event today (UTC).',
    eventsToday: 'Events today',
    eventsTodayHint: 'Every recorded event since midnight UTC.',
    tasksCreated: 'Tasks created',
    tasksCreatedHint: 'In the last 7 days.',
    tasksCompleted: 'Tasks completed',
    tasksCompletedHint: 'In the last 7 days.',
    activeProjects: 'Active projects',
    activeProjectsHint: 'Projects touched by any event in the last 7 days.',
  },

  requestsPage: {
    title: 'Request analytics',
    description: 'Traffic, response times and the endpoints doing the most work.',
  },

  requests: {
    title: 'Requests over time',
    info: 'How many HTTP requests the API served in each time bucket. Quiet buckets are drawn as zero rather than skipped, so an outage is visible as a gap in traffic instead of a straight line across it.',
    series: {
      count: 'Requests',
      avg: 'Average duration',
    },
    // `requests`, never `count` — i18next reserves that name for pluralization.
    summary:
      '{{requests}} requests across {{buckets}} time buckets, averaging {{avg}} ms per request.',
    empty: 'No traffic in this window',
    emptyBody: 'Nothing has been served in the selected range. Try a wider one.',
  },

  latency: {
    title: 'Response time',
    info: 'Response-time percentiles per time bucket. The median is the typical experience, the 95th is the one people complain about, and the 99th is the tail where timeouts hide. Buckets that served nothing break the line rather than plotting zero.',
    series: {
      p50: 'Median',
      p95: '95th',
      p99: '99th',
    },
    summary:
      'Median response time {{p50}} ms; the worst 95th percentile in this window was {{p95}} ms.',
    empty: 'Nothing measured in this window',
    emptyBody:
      'No request was served in the selected range, so there is nothing to take percentiles of.',
  },

  endpoints: {
    title: 'Busiest endpoints',
    subtitle: 'By request count',
    column: {
      endpoint: 'Endpoint',
      count: 'Requests',
      avg: 'Average',
      errorRate: 'Errors',
    },
    empty: 'No endpoints in this window',
    emptyBody: 'Nothing has been served in the selected range.',
  },

  events: {
    title: 'Telemetry events',
    description: 'The raw product-analytics stream, newest first.',
    system: 'System',
    column: {
      time: 'Time',
      type: 'Event',
      user: 'User',
      project: 'Project',
      details: 'Show payload',
    },
    filter: {
      type: 'Event',
      allTypes: 'All events',
      oneUser: 'One user',
      clearUser: 'Clear the user filter',
    },
    empty: 'No events match these filters',
    emptyBody: 'Widen the time range, or clear the event-type filter.',
  },

  /** One label per member of the shared closed enum — see the file header. */
  eventType: {
    auth_login: 'Signed in',
    page_view: 'Page view',
    task_created: 'Task created',
    task_moved: 'Task moved',
    task_completed: 'Task completed',
    sprint_started: 'Sprint started',
    sprint_completed: 'Sprint completed',
    comment_added: 'Comment added',
    search_performed: 'Search',
    notification_opened: 'Notification opened',
    theme_changed: 'Theme changed',
    export_csv: 'CSV export',
  },
} as const;
