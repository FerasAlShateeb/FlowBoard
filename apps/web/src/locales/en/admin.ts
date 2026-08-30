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
      memberships: 'Organizations',
    },

    tableLabel: 'User accounts',
    exportCsv: 'Export CSV',
    exportName: 'flowboard-users',
    csv: {
      name: 'Name',
      email: 'Email',
      access: 'Access',
      status: 'Status',
      organizations: 'Organizations',
      created: 'Added',
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
      memberships: 'Manage memberships…',
      delete: 'Delete user…',
    },

    /**
     * The memberships column and its dialog.
     *
     * `none` is a real, common answer rather than an error state: a freshly
     * provisioned global admin belongs to no organization at all, and a table
     * cell that showed a spinner for that would be describing a state the
     * product does not have.
     */
    memberships: {
      none: 'None',
      overflow: '+{{overflow}}',
      cell: '{{names}}',
      title: 'Organizations for {{name}}',
      description:
        'Add this account to an organization, change the role it holds there, or remove it. Changes apply immediately.',
      current: 'Member of',
      empty: 'This account is not in any organization yet.',
      addTitle: 'Add to an organization',
      org: 'Organization',
      orgPlaceholder: 'Pick an organization',
      role: 'Role',
      add: 'Add',
      remove: 'Remove from {{org}}',
      roleFor: 'Role in {{org}}',
      noneLeft: 'This account is already in every organization.',
      added: 'Added to {{org}}',
      removed: 'Removed from {{org}}',
      roleChanged: 'Role in {{org}} updated',
    },

    /** Org roles, spelled out — a bare "Admin" is ambiguous next to a global one. */
    orgRole: {
      admin: 'Organization admin',
      member: 'Member',
    },

    /**
     * Deletion. The copy leads with what actually happens — the row survives,
     * scrubbed — because an admin who expects a hard delete and gets an
     * anonymized account has been surprised by the product rather than informed
     * by it.
     */
    delete: {
      title: 'Delete {{name}}?',
      body: 'The account is anonymized rather than erased: the name becomes “Deleted user”, the email address is replaced, the avatar is cleared, and every session is revoked immediately.',
      keeps:
        'Their comments, activity and task history stay intact and keep reading correctly — they are simply no longer attributed to a person.',
      memberships: 'They are removed from every organization they belong to.',
      confirmHint: 'Type {{value}} to confirm',
      submit: 'Delete account',
      /**
       * A PLURAL key, not `{{orgs}} organizations` (W3.2).
       *
       * The count comes from `membershipsRemoved` on the delete response and is
       * most often 0 or 1 — the two values a hard-coded plural noun gets wrong.
       * English read "removed from 1 organizations"; Arabic, whose numeral
       * agreement has six forms rather than two, was wrong for every count
       * except three-to-ten. `_zero` is not an English CLDR category, so the
       * "belonged to nothing" case rides on `_other` reading naturally at zero
       * ("removed from 0 organizations" is not a sentence) — hence the phrasing
       * below, which drops the clause entirely when there is nothing to report.
       */
      done_one: '{{name}} was deleted and removed from {{count}} organization',
      done_other: '{{name}} was deleted and removed from {{count}} organizations',
      doneNoOrgs: '{{name}} was deleted',
      selfGuard: 'You cannot delete your own account.',
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
      /**
       * The org grants handed out in the same request. One transaction rather
       * than "create, then add member, then add member": the multi-request
       * version has two chances to half-succeed and leave an account that
       * exists but belongs nowhere.
       */
      orgs: 'Organizations',
      orgsHint: 'Optional. The account is created and added to these in one step.',
      orgsEmpty: 'Not in any organization yet.',
      addOrg: 'Add organization',
      noOrgs: 'This deployment has no organizations yet.',
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
      // CSV ONLY. The grid shows the project's NAME and keeps the id on the
      // cell's `title`; the export gives the id its own column so a spreadsheet
      // can join this file against another one.
      projectId: 'Project ID',
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

  // ═════════════════════════════════════════════════════════════════════════
  // Round 2 — instance administration (W2.1)
  //
  // Four surfaces that did not exist before: the admin LANDING page, the
  // organizations console, the cross-org projects overview, and the instance
  // settings form. They share the `admin` namespace with the telemetry pages
  // above because they share a nav section and an audience; nothing here reuses
  // a telemetry key, and `platform.*` is deliberately NOT called `overview.*` —
  // that name is already the telemetry KPI row's.
  // ═════════════════════════════════════════════════════════════════════════

  /**
   * `/admin/overview` — the admin landing page.
   *
   * The captions under each KPI state the exact window the number covers, for
   * the same reason the telemetry hints do: "Users: 42" is a number two people
   * will quote to mean two different things.
   *
   * Interpolated values arrive PRE-FORMATTED (Latin digits, grouped by
   * `lib/format`), so i18next never reformats them — and no placeholder is
   * named `count`, which i18next reserves for pluralization.
   */
  platform: {
    title: 'Platform overview',
    description: 'Every account, organization and project on this instance, at a glance.',
    autoRefresh: 'Auto-refresh',
    autoRefreshLabel: 'Refresh every 30s',

    kpi: {
      users: 'Users',
      usersCaption: '{{active}} active in the last 30 days',
      usersLink: 'Open the user directory',
      orgs: 'Organizations',
      orgsCaption: 'Live organizations on this instance',
      orgsLink: 'Open the organizations console',
      projects: 'Projects',
      projectsCaption: 'Across every organization',
      projectsLink: 'Open the projects overview',
      tasks: 'Tasks',
      tasksCaption: '{{completed}} completed in the last 30 days',
      tasksLink: 'Open the work analytics',
      errorRate: 'Error rate',
      errorRateCaption: 'Failed requests, last 24 hours',
      errorRateLink: 'Open the traffic analytics',
    },

    events: {
      title: 'Activity',
      info: 'Telemetry events per day over the last 14 days. This window is fixed: a health summary whose sparkline rescales with a range picker is one nobody can read at a glance.',
      series: 'Events',
      summary: '{{events}} events over the last 14 days, peaking at {{peak}} in a day.',
      empty: 'No activity recorded yet',
      emptyBody: 'Events appear here as people use FlowBoard.',
    },

    requests: {
      title: 'API traffic',
      info: 'HTTP requests per hour over the last 24 hours. Quiet hours are drawn as zero rather than skipped, so an outage reads as a gap in traffic instead of a straight line across it.',
      series: 'Requests',
      summary: '{{requests}} requests over the last 24 hours, peaking at {{peak}} in an hour.',
      empty: 'No traffic in the last 24 hours',
      emptyBody: 'Nothing has been served since yesterday.',
    },
  },

  /**
   * `/admin/orgs` — the organizations console.
   *
   * "Archive", never "delete": the operation is a soft delete that
   * {@link orgs.restore} undoes, and calling it delete would make the restore
   * row read as an undo of something the copy said was permanent.
   */
  orgs: {
    title: 'Organizations',
    description: 'Every organization on this instance, archived ones included.',
    tableLabel: 'Organizations',

    facet: {
      q: 'Name or slug',
      qPlaceholder: 'Search organizations',
    },
    showArchived: 'Show archived',
    showArchivedHint: 'Archived organizations are hidden until you ask for them.',

    column: {
      name: 'Organization',
      members: 'Members',
      projects: 'Projects',
      created: 'Created',
      status: 'Status',
    },

    badge: {
      archived: 'Archived',
      archivedOn: 'Archived {{date}}',
      live: 'Live',
    },

    empty: 'No organizations yet',
    emptyBody: 'Create the first one — it becomes the workspace projects live in.',
    noResults: 'No organization matches these filters',

    rowMenu: 'Actions for {{name}}',
    actions: {
      create: 'New organization',
      open: 'Open organization',
      rename: 'Rename…',
      archive: 'Archive…',
      restore: 'Restore',
    },

    create: {
      title: 'New organization',
      description:
        'You become its first administrator. Projects, teams and members all live inside an organization.',
      name: 'Name',
      slug: 'URL slug',
      slugHint: 'Appears in every link: /o/<slug>. Lowercase letters, numbers and hyphens.',
      submit: 'Create organization',
      created: '{{name}} created',
    },

    rename: {
      title: 'Rename {{name}}',
      description:
        'Changing the slug changes every URL under this organization. Existing links stop resolving.',
      submit: 'Save changes',
      renamed: '{{name}} updated',
    },

    archive: {
      title: 'Archive {{name}}?',
      body: 'Its projects, teams and tasks stop being reachable and it disappears from every switcher. Nothing is erased — you can restore it from this table.',
      confirmHint: 'Type {{value}} to confirm',
      submit: 'Archive organization',
      archived: '{{name}} archived',
    },

    restore: {
      restored: '{{name}} restored',
      conflict:
        'Another organization now uses the slug “{{slug}}”. Re-slug that one, then restore this.',
    },

    singleMode: {
      title: 'This instance runs in single-organization mode',
      body: '{{name}} is the workspace: the organization switcher is hidden and every link resolves inside it. Creating another organization is still allowed, but it stays invisible to everyone until the mode changes.',
      bodyNoDefault:
        'No default organization is set, so the app has nowhere to send people. Pick one in instance settings, or switch back to multi-organization mode.',
      link: 'Instance settings',
    },
  },

  /**
   * `/admin/projects` — the cross-organization projects overview.
   *
   * Read-only by design: a project's settings belong to the project, and a
   * console that could edit one from outside its organization would need to
   * re-implement every guard the project pages already enforce.
   */
  projects: {
    title: 'Projects',
    description: 'Every project across every organization, with what is happening inside it.',
    tableLabel: 'Projects',

    facet: {
      q: 'Name or key',
      qPlaceholder: 'Search projects',
      org: 'Organization',
      archived: 'Archived',
      archivedInclude: 'Include archived',
    },

    column: {
      key: 'Key',
      name: 'Project',
      org: 'Organization',
      lead: 'Lead',
      members: 'Members',
      tasks: 'Open / total',
      activity: 'Last activity',
      status: 'Status',
    },

    value: {
      noLead: 'No lead',
      neverActive: 'Never',
      tasks: '{{open}} / {{total}}',
    },

    badge: {
      archived: 'Archived',
      // Both states are named, matching `/admin/orgs` — see the note on the
      // Status column in `AdminProjectsPage`.
      archivedOn: 'Archived {{date}}',
      live: 'Live',
    },

    empty: 'No projects yet',
    emptyBody: 'Projects created inside any organization appear here.',
    noResults: 'No project matches these filters',

    rowMenu: 'Actions for {{name}}',
    actions: {
      openBoard: 'Open board',
      openOrg: 'Open organization',
    },
  },

  /**
   * `/admin/settings` — the instance singleton.
   *
   * The mode explanation is written the way a self-hosted operator reads it:
   * what changes on screen, not what changes in the database.
   */
  settings: {
    title: 'Instance settings',
    description: 'How this deployment presents itself to everyone signed in.',

    identity: {
      title: 'Identity',
      description: 'What this deployment calls itself.',
      name: 'Instance name',
      nameHint: 'Shown wherever the deployment names itself. It does not rename the product.',
    },

    mode: {
      title: 'Organization mode',
      description: 'Whether this deployment is a platform of many organizations, or one workspace.',
      label: 'Mode',
      multi: 'Multiple organizations',
      multiHint:
        'The shipped shape: people can belong to several organizations and switch between them.',
      single: 'Single organization',
      singleHint: 'One organization is the whole workspace.',
    },

    modeAlert: {
      title: 'What single-organization mode changes',
      body: 'The organization switcher is hidden, the home page resolves straight into the default organization, and the sidebar scopes itself to it. Nothing is deleted and no data model changes — other organizations simply stop being reachable from the interface. Switch back at any time.',
    },

    defaultOrg: {
      label: 'Default organization',
      hint: 'Where single-organization mode sends everyone. Only live organizations can be chosen.',
      placeholder: 'Pick an organization',
      none: 'None',
      required: 'Single-organization mode needs a default organization. Pick one.',
      invalid: 'That organization no longer exists, or has been archived. Pick another.',
      loading: 'Loading organizations…',
      empty: 'This deployment has no organizations yet. Create one before switching modes.',
    },

    save: 'Save settings',
    saved: 'Instance settings saved',
    unchanged: 'No changes to save',
    lastUpdated: 'Last changed {{date}}',
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
