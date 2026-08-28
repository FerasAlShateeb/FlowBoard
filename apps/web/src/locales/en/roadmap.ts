/**
 * `roadmap` — the Gantt view (WP3.4).
 *
 * TWO THINGS THIS CATALOG IS CAREFUL ABOUT:
 *
 * 1. **No plural suffixes — by choice.** Counts are phrased as labelled numbers
 *    (`Subtasks: {{count}}`), which read the same at 1 and at 12 in both
 *    languages and need no grammar at all. The old rationale here — that the
 *    extra Arabic categories would be rejected as catalog drift — stopped being
 *    true in WP5.1: `i18n/locales.test.ts` now REQUIRES English to declare
 *    `_one`/`_other` and Arabic to declare all six CLDR categories for the same
 *    base, so a genuinely inflecting sentence can and should use plurals.
 * 2. **Digits stay Western.** Every `{{count}}` here lands in a `tabular-nums`
 *    row beside task keys; see `lib/lang-policy`'s `getIntlLocale`.
 */
export default {
  title: 'Roadmap',
  description: 'Plan work across time. Drag a bar to reschedule it, or its edges to resize.',

  zoom: {
    label: 'Zoom level',
    week: 'Week',
    month: 'Month',
    quarter: 'Quarter',
  },

  actions: {
    today: 'Today',
    todayHint: 'Scroll the timeline to today',
    fit: 'Fit to view',
    fitHint: 'Zoom out until the whole plan fits on screen',
    dependencies: 'Dependencies',
    dependenciesHint: 'Show the blocking arrows between bars',
    schedule: 'Add dates',
    scheduleHint: 'Give this task a start and due date so it appears on the timeline',
    expand: 'Expand',
    collapse: 'Collapse',
  },

  sidebar: {
    header: 'Tasks',
    noEpic: 'No epic',
    subtasks: 'Subtasks: {{count}}',
  },

  axis: {
    /** `Q1 2026`. The digits are Western in both languages, by policy. */
    quarter: 'Q{{quarter}} {{year}}',
    today: 'Today',
    rangeLabel: 'Timeline from {{start}} to {{end}}',
  },

  bar: {
    progress: 'Done: {{done}} of {{total}}',
    rolledUp: 'These dates are rolled up from the tasks in this epic — drag those instead.',
    keyboardHint: 'With a bar focused: arrow keys move it one day, Shift + arrow resizes it.',
  },

  empty: {
    noTasksTitle: 'No tasks in this project yet',
    noTasksBody: 'Create a task and give it dates, and it will appear on the roadmap.',
    unscheduledTitle: 'Nothing is scheduled yet',
    unscheduledBody:
      'None of these tasks has a start or due date, so there is nothing to place on the timeline. Add dates to one and the rest will follow.',
    cta: 'Schedule the first task',
  },

  error: {
    title: 'The roadmap did not load',
  },

  truncated: 'Showing the first {{count}} tasks — this project has more than the roadmap can draw.',
} as const;
