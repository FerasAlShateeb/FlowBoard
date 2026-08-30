/**
 * `reports` — the project dashboard: burndown, burnup, cumulative flow,
 * velocity, cycle time and workload.
 *
 * THREE THINGS EVERY CHART OWES THE USER, and therefore three key groups per
 * chart:
 *
 *   - `title` + `info`  — the name, and ONE sentence in the card's tooltip
 *     saying what the chart actually measures. A burndown that nobody can read
 *     is decoration; the sentence is the difference.
 *   - `empty.*`         — "no data yet" WITH THE REASON. "No completed sprints
 *     yet" tells the user what to do; "No data" does not.
 *   - `summary`         — the screen-reader sentence, interpolating the
 *     headline numbers. It is the `aria-label` of the plot's `role="img"`, so
 *     it is the ONLY thing a non-sighted user gets from the chart. Numbers are
 *     interpolated pre-formatted (Latin digits, see `lib/lang-policy`).
 *
 * Series names double as the legend labels — the charts render their own HTML
 * legend rather than Recharts', so that the legend flips with the page under
 * RTL while the plot itself stays an LTR island.
 */
export default {
  title: 'Reports',
  description: 'How this project is actually moving.',

  /** The two controls above the grid. */
  toolbar: {
    sprintLabel: 'Sprint',
    sprintPlaceholder: 'Select a sprint',
    sprintEmpty: 'No sprints yet',
    sprintState: {
      active: 'Active',
      planned: 'Planned',
      completed: 'Completed',
    },
    rangeLabel: 'Range',
    rangePreset: {
      '2w': 'Last 2 weeks',
      '4w': 'Last 4 weeks',
      '8w': 'Last 8 weeks',
    },
    rangeFrom: 'From',
    rangeTo: 'To',
    rangeValue: '{{from}} – {{to}}',
    pickDate: 'Pick a date',
  },

  /** The `ReportCard` shell itself. */
  card: {
    infoLabel: 'What this chart shows',
  },

  /** Unit words. Kept out of the sentences so a number never carries one. */
  units: {
    points: 'points',
    tasks: 'tasks',
    hours: 'hours',
  },

  burndown: {
    title: 'Burndown',
    info: 'Story points still open on each day of the sprint, against the straight line from the commitment down to zero.',
    remaining: 'Remaining',
    ideal: 'Ideal',
    axis: 'Points',
    empty: {
      noSprint: 'No sprint selected',
      noSprintBody: 'Pick a sprint above to draw its burndown.',
      noDays: 'Nothing recorded yet',
      noDaysBody: 'This sprint has no day buckets — it has not started, or it started today.',
    },
    summary:
      'Burndown across {{days}} days. {{remaining}} points remain today against an ideal of {{ideal}}.',
  },

  burnup: {
    title: 'Burnup',
    info: 'Completed points climbing towards the sprint scope — a rising scope line is the scope creep a burndown hides.',
    completed: 'Completed',
    scope: 'Scope',
    axis: 'Points',
    empty: {
      noSprint: 'No sprint selected',
      noSprintBody: 'Pick a sprint above to draw its burnup.',
      noDays: 'Nothing recorded yet',
      noDaysBody: 'This sprint has no day buckets — it has not started, or it started today.',
    },
    summary: 'Burnup across {{days}} days. {{completed}} of {{scope}} points are complete.',
  },

  cumulativeFlow: {
    title: 'Cumulative flow',
    info: 'How many tasks sat in each status category on each day — a widening band is a queue building up.',
    todo: 'To do',
    inProgress: 'In progress',
    done: 'Done',
    axis: 'Tasks',
    empty: {
      title: 'No flow in this range',
      body: 'No task moved between categories between the selected dates. Try a wider range.',
    },
    summary:
      'Cumulative flow across {{days}} days. Today: {{todo}} to do, {{inProgress}} in progress, {{done}} done.',
  },

  velocity: {
    title: 'Velocity',
    info: 'What each completed sprint committed to versus what it actually delivered — the number to plan the next sprint with.',
    committed: 'Committed',
    completed: 'Completed',
    average: 'Average',
    axis: 'Points',
    empty: {
      title: 'No completed sprints yet',
      body: 'Velocity appears once a sprint has been started and completed — the two points where the numbers are stamped.',
    },
    summary:
      'Velocity across {{sprints}} completed sprints. Average {{average}} points completed; the most recent delivered {{last}}.',
  },

  cycleTime: {
    title: 'Cycle time',
    info: 'How long each resolved task took from the moment work started on it to the moment it was done.',
    tasks: 'Resolved tasks',
    p50: 'Median (p50)',
    p90: 'p90',
    axis: 'Hours',
    openTask: 'Open {{key}}',
    empty: {
      title: 'Nothing resolved in this range',
      body: 'No task reached a done status between the selected dates. Try a wider range.',
    },
    summary:
      'Cycle time for {{tasks}} resolved tasks. Median {{p50}} hours, ninetieth percentile {{p90}} hours.',
  },

  workload: {
    title: 'Workload',
    info: 'Open story points carried by each assignee right now, unassigned work included.',
    unassigned: 'Unassigned',
    points: '{{points}} points',
    tasks: '{{tasks}} tasks',
    empty: {
      title: 'No open work',
      body: 'Every task in this project is either done or has no story points on it.',
    },
    summary: 'Workload across {{people}} assignees: {{tasks}} open tasks worth {{points}} points.',
  },
} as const;
