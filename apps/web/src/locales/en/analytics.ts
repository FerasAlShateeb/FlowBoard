/**
 * `analytics` — the admin analytics console: the four domain dashboards
 * (engagement, work, traffic, growth), the generic metric drill-down behind
 * `/admin/analytics/:domain/:metric`, and the ops surfaces that now link into
 * them.
 *
 * ── WHY ITS OWN NAMESPACE RATHER THAN MORE OF `admin` ───────────────────────
 * The metric registry is the i18n-exhaustiveness test's subject — every metric
 * must resolve a title, every column a header — and that assertion is far
 * easier to write, and far harder to accidentally satisfy with an unrelated
 * key, against a namespace that contains nothing else. `admin` keeps the
 * accounts directory and the existing ops copy, and this file adds NOTHING
 * there: `metric-registry.ts` derives its key type from THIS module
 * (`AnalyticsKey`), so a key renamed here is a compile error in the registry
 * rather than a raw `analytics:metrics.work.cycle-time.title` in a card header.
 *
 * ── WHAT IS DELIBERATELY REUSED FROM `admin:` ──────────────────────────────
 * The ops pages keep `admin:telemetry.*`, `admin:events.*`, `admin:eventType.*`,
 * `admin:endpoints.column.*` and `admin:units.ms`: the events feed and the
 * Traffic dashboard must never disagree about what an `auth_login` is called or
 * what "ms" is spelled. Only copy that did not exist before this round lives
 * here, under {@link ops}.
 *
 * ── WHAT DOES NOT BELONG HERE ──────────────────────────────────────────────
 * The names the sidebar and breadcrumbs render. Those are `common:nav.*`,
 * exactly as the command palette's are — one product, one word per destination.
 *
 * ── DIGITS AND PRESET TOKENS ───────────────────────────────────────────────
 * `7d` / `30d` / `90d` / `12m` are NOT in this catalog: the range pills render
 * their Latin tokens in every language by policy (i18n.md §2, `RangePills`).
 */
export default {
  title: 'Analytics',

  /* ------------------------------------------------------------------ */
  /* Shared chrome — the words every dashboard and the drill-down share.  */
  /* ------------------------------------------------------------------ */

  /** The two affordances the console repeats on every surface. */
  card: {
    details: 'Details',
    /** Accessible name for a tile's link and a card's "Details →". */
    openBreakdown: 'Open the {{label}} breakdown',
  },

  /** Domain → its name. One key feeds the page title AND the back link. */
  domains: {
    engagement: 'Engagement',
    work: 'Work',
    traffic: 'Traffic',
    growth: 'Growth',
  },

  /** The bucket word, for "per **day**" captions. */
  intervals: {
    hour: 'hour',
    day: 'day',
    week: 'week',
    month: 'month',
  },

  /** Units, kept out of the sentences so a number never carries one. */
  units: {
    /** Hours — the unit of every cycle-time figure in this console. */
    hours: 'h',
  },

  /** The chart body's three states and its accessible sentence. */
  chart: {
    summary: '{{title}} — {{buckets}} buckets. {{series}}',
    summarySeries: '{{label}}: latest {{latest}}, peak {{peak}}.',
    empty: {
      title: 'Nothing in this window',
      message: 'Every bucket in the selected range is zero. Try a wider range.',
    },
  },

  /** The opt-in 30-second refresh on the two "is it on fire" surfaces. */
  autoRefresh: {
    label: 'Auto-refresh',
    hint: 'Re-read this page every 30 seconds.',
  },

  /* ------------------------------------------------------------------ */
  /* Series names — the legend and tooltip words.                         */
  /* ------------------------------------------------------------------ */

  series: {
    activeUsers: 'Active users',
    signups: 'Sign-ups',
    stickiness: 'Stickiness',
    events: 'Events',
    tasksCreated: 'Created',
    tasksCompleted: 'Completed',
    cycleTime: 'Cycle time',
    points: 'Points',
    requests: 'Requests',
    errors: 'Errors',
    errorRate: 'Error rate',
    milliseconds: 'Response time',
    responses: 'Responses',
    orgs: 'Organizations',
    invitesSent: 'Sent',
    invitesAccepted: 'Accepted',
    tasks: 'Tasks',
  },

  /* ------------------------------------------------------------------ */
  /* Table column headers — shared across the registry.                   */
  /* ------------------------------------------------------------------ */

  columns: {
    bucket: 'Bucket',
    utcHour: 'Hour (UTC)',
    activeUsers: 'Active users',
    signups: 'Sign-ups',
    stickiness: 'Stickiness',
    eventType: 'Event',
    /*
      The WIRE identifier beside the translated name, on the events-by-type
      breakdown. Its column reused `eventType` until R2 W3.5, which printed the
      same header twice — in the table AND in the exported CSV, where two
      identically-named columns are a file a spreadsheet cannot disambiguate.
      "Event ID" and not "Type": `task_created` is the value the API filters on,
      the same thing `?type=` takes.
    */
    eventTypeId: 'Event ID',
    events: 'Events',
    share: 'Share',
    tasksCreated: 'Created',
    tasksCompleted: 'Completed',
    cycleTime: 'Cycle time',
    points: 'Points',
    project: 'Project',
    projectKey: 'Key',
    org: 'Organization',
    orgSlug: 'Slug',
    requests: 'Requests',
    errors: 'Errors',
    errorRate: 'Error rate',
    percentile: 'Percentile',
    duration: 'Duration',
    method: 'Method',
    path: 'Path',
    avg: 'Average',
    statusClass: 'Class',
    responses: 'Responses',
    members: 'Members',
    projects: 'Projects',
    tasks: 'Tasks',
    lastActivity: 'Last activity',
    orgsCreated: 'Organizations',
    invitesSent: 'Sent',
    invitesAccepted: 'Accepted',
  },

  /** Facet names on the drill-down page. */
  filters: {
    eventType: 'Event type',
    org: 'Organization',
    method: 'Method',
    statusClass: 'Status class',
  },

  /* ------------------------------------------------------------------ */
  /* The registry — one title/subtitle pair per drillable metric.         */
  /* ------------------------------------------------------------------ */

  metrics: {
    engagement: {
      dau: {
        title: 'Daily active users',
        subtitle: 'Distinct people with any recorded activity in each bucket.',
      },
      signups: {
        title: 'Sign-ups',
        subtitle: 'Accounts created in each bucket.',
      },
      stickiness: {
        title: 'Stickiness',
        subtitle: 'Daily actives over monthly actives — how much of the base shows up.',
      },
      'activity-by-hour': {
        title: 'Activity by hour',
        subtitle: 'When the deployment is actually busy, in UTC.',
      },
      'events-by-type': {
        title: 'Events by type',
        subtitle: 'What people did, by recorded event type.',
      },
    },
    work: {
      'tasks-created': {
        title: 'Tasks created',
        subtitle: 'Every task opened across every project in the deployment.',
      },
      'tasks-completed': {
        title: 'Tasks completed',
        subtitle: 'Tasks that reached a done status in each bucket.',
      },
      'cycle-time': {
        title: 'Cycle time',
        subtitle: 'Average hours from a task being opened to it being resolved.',
      },
      'points-completed': {
        title: 'Points completed',
        subtitle: 'Story points delivered in each bucket.',
      },
      'by-project': {
        title: 'Delivery by project',
        subtitle: 'Every project that moved in this window, and how much.',
      },
    },
    traffic: {
      requests: {
        title: 'Requests',
        subtitle: 'HTTP requests the API served in each bucket.',
      },
      errors: {
        title: 'Errors',
        subtitle: '4xx and 5xx responses in each bucket.',
      },
      'error-rate': {
        title: 'Error rate',
        subtitle: 'Failing responses as a share of the bucket’s traffic.',
      },
      latency: {
        title: 'Response time',
        subtitle: 'The percentile ladder over the whole window, in milliseconds.',
      },
      'top-endpoints': {
        title: 'Busiest endpoints',
        subtitle: 'By request count, with the average duration and error share of each.',
      },
      'status-breakdown': {
        title: 'Status classes',
        subtitle: 'How the window’s responses split across 2xx, 3xx, 4xx and 5xx.',
      },
    },
    growth: {
      'orgs-created': {
        title: 'Organizations created',
        subtitle: 'New organizations in each bucket.',
      },
      'invites-sent': {
        title: 'Invites sent',
        subtitle: 'Invitations issued in each bucket.',
      },
      'invites-accepted': {
        title: 'Invites accepted',
        subtitle: 'Invitations that turned into a member.',
      },
      'by-org': {
        title: 'Organizations',
        subtitle: 'Every organization in the deployment, with its size and last activity.',
      },
    },
  },

  /* ------------------------------------------------------------------ */
  /* The four domain dashboards.                                          */
  /* ------------------------------------------------------------------ */

  engagement: {
    title: 'Engagement',
    subtitle: 'Who is here, how often, and when.',
    loadError: 'The engagement figures could not be loaded.',
    empty: {
      title: 'No activity in this window',
      message: 'Nothing was recorded in the selected range. Try a wider one.',
    },
    kpis: {
      dau: 'Daily active users',
      dauCaption: 'The most recent bucket.',
      mau: 'Monthly active users',
      mauCaption: 'Distinct people in the trailing 30 days.',
      signups: 'Sign-ups',
      signupsCaption: 'Total in the selected window.',
      stickiness: 'Stickiness',
      stickinessCaption: 'Daily actives over monthly actives.',
    },
    charts: {
      dau: {
        title: 'Daily active users',
        subtitle: 'Distinct people per {{interval}}.',
      },
      signups: {
        title: 'Sign-ups',
        subtitle: 'New accounts per {{interval}}.',
      },
      activityByHour: {
        title: 'Activity by hour',
        subtitle: 'Every event in the window, by UTC hour of day.',
      },
      eventsByType: {
        title: 'Events by type',
        subtitle: 'The event mix over the whole window.',
      },
    },
  },

  work: {
    title: 'Work',
    subtitle: 'What the deployment is delivering, across every project.',
    loadError: 'The delivery figures could not be loaded.',
    empty: {
      title: 'No work in this window',
      message: 'No task was opened or resolved in the selected range.',
    },
    kpis: {
      created: 'Tasks created',
      createdCaption: 'Total in the selected window.',
      completed: 'Tasks completed',
      completedCaption: 'Total in the selected window.',
      completionRate: 'Completion rate',
      completionRateCaption: 'Completed over created, in this window.',
      points: 'Points completed',
      pointsCaption: 'Story points delivered in this window.',
    },
    charts: {
      flow: {
        title: 'Created vs completed',
        subtitle: 'Both series per {{interval}} — a widening gap is a growing backlog.',
      },
      cycleTime: {
        title: 'Cycle time',
        subtitle: 'Average hours to resolve, per {{interval}}.',
        percentiles: 'p50 {{p50}} · p90 {{p90}} · p95 {{p95}}',
        percentilesEmpty: 'Nothing was resolved in this window.',
      },
      points: {
        title: 'Points completed',
        subtitle: 'Story points delivered per {{interval}}.',
      },
      byProject: {
        title: 'Top projects',
        subtitle: 'The ten projects that completed the most in this window.',
      },
    },
  },

  traffic: {
    title: 'Traffic',
    subtitle: 'The HTTP surface: volume, failures and response time.',
    loadError: 'The traffic figures could not be loaded.',
    empty: {
      title: 'No traffic in this window',
      message: 'Nothing was served in the selected range. Try a wider one.',
    },
    kpis: {
      requests: 'Requests',
      requestsCaption: 'Total in the selected window.',
      errors: 'Errors',
      errorsCaption: '4xx and 5xx responses.',
      errorRate: 'Error rate',
      errorRateCaption: 'Failing responses over all responses.',
      p95: '95th percentile',
      p95Caption: 'The slow experience people complain about.',
    },
    charts: {
      requests: {
        title: 'Requests',
        subtitle: 'Volume per {{interval}}.',
      },
      errors: {
        title: 'Errors',
        subtitle: '4xx and 5xx per {{interval}}.',
      },
      errorRate: {
        title: 'Error rate',
        subtitle: 'Failing share per {{interval}} — a spike here is always a regression.',
      },
      latency: {
        title: 'Response time',
        subtitle: 'The percentile ladder over the whole window.',
        aria: 'Response-time percentiles for the selected window',
      },
      topEndpoints: {
        title: 'Busiest endpoints',
        subtitle: 'By request count.',
        aria: 'The busiest endpoints in the selected window',
      },
      statusBreakdown: {
        title: 'Status classes',
        subtitle: 'Every response in the window, by class.',
      },
    },
  },

  growth: {
    title: 'Growth',
    subtitle: 'Organizations, and how people get into them.',
    loadError: 'The growth figures could not be loaded.',
    empty: {
      title: 'Nothing to show yet',
      message: 'No organization has been created and no invite has been sent.',
    },
    kpis: {
      orgs: 'Organizations created',
      orgsCaption: 'Total in the selected window.',
      invitesSent: 'Invites sent',
      invitesSentCaption: 'Total in the selected window.',
      invitesAccepted: 'Invites accepted',
      invitesAcceptedCaption: 'Invitations that turned into a member.',
      acceptanceRate: 'Acceptance rate',
      acceptanceRateCaption: 'Accepted over sent, in this window.',
    },
    charts: {
      orgs: {
        title: 'Organizations created',
        subtitle: 'New organizations per {{interval}}.',
      },
      invites: {
        title: 'Invites',
        subtitle: 'Sent against accepted, per {{interval}}.',
      },
      byOrg: {
        title: 'Organizations',
        subtitle: 'Every organization in the deployment — all time, not the window.',
        aria: 'Every organization in the deployment',
      },
    },
  },

  /* ------------------------------------------------------------------ */
  /* The generic drill-down.                                              */
  /* ------------------------------------------------------------------ */

  detail: {
    title: 'Metric',
    loadError: 'This breakdown could not be loaded.',
    perInterval: 'Per {{interval}}.',
    chartEmpty: {
      title: 'Nothing in this window',
      message: 'Every bucket in the selected range is zero.',
    },
    tableEmpty: 'No rows match these filters.',
    tableAria: '{{title}} breakdown',
    export: 'Export CSV',
    exportError: 'The export could not be written.',
    notFound: {
      title: 'Unknown metric',
      subtitle: 'This link does not point at anything the console measures.',
      emptyTitle: 'No such breakdown',
      emptyMessage: 'There is no “{{metric}}” metric in the {{domain}} dashboard.',
      back: 'Back to Analytics',
    },
  },

  /* ------------------------------------------------------------------ */
  /* Ops — the telemetry pages, now wired into the console.               */
  /* ------------------------------------------------------------------ */

  ops: {
    events: {
      aria: 'Telemetry events',
      export: 'Export CSV',
      exportError: 'The export could not be written.',
      /**
       * The events grid's own facet name. It is NOT `admin:events.filter.type`
       * ("Event"): that label sat on a single-select chip bar, and this control
       * is multi-select — "Event type" is what a checkbox list of them is.
       * Everything else the page renders (column headers, the type names, the
       * actor-less "System" label) still comes from `admin:`, so the feed and
       * the analytics console cannot disagree about what an `auth_login` is.
       */
      typeFacet: 'Event type',
    },
    requests: {
      /** The folded page: it keeps working and points at its replacement. */
      note: 'Request volume, response time and the busiest endpoints now live on the Traffic dashboard, where they share one window with the rest of the console.',
      link: 'Open the traffic dashboard',
    },
  },
} as const;
