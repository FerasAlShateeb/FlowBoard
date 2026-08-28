/**
 * `calendar` namespace — the month/week grid, its chrome, and the unscheduled
 * tray.
 *
 * WHAT IS NOT HERE, ON PURPOSE: weekday names, month names, day numbers and
 * date ranges. Every one of those comes from `Intl` via
 * `components/calendar/calendar-dates.ts`, built with `getIntlLocale()` — so
 * Arabic gets السبت / مارس for free and a third language would too, with no
 * catalog work at all. Translating them by hand here would be both duplicated
 * effort and a source of drift from the `Intl` output the rest of the app uses.
 *
 * Digits stay Western in both languages (`ar-u-nu-latn`) — see
 * `lib/lang-policy.ts`.
 */
export default {
  title: 'Calendar',

  /** The Month | Week segmented control. */
  views: {
    label: 'Calendar view',
    month: 'Month',
    week: 'Week',
  },

  /** The period stepper. The current period's label itself comes from `Intl`. */
  nav: {
    previous: 'Previous period',
    next: 'Next period',
    today: 'Today',
  },

  grid: {
    /** The month cell's overflow affordance, once the lanes are full. */
    more_one: '+{{count}} more',
    more_other: '+{{count}} more',
  },

  /** One task, as a chip or a bar. */
  chip: {
    due: 'Due {{date}}',
    starts: 'Starts {{date}}',
    undated: 'No dates',
    points_one: '{{count}} point',
    points_other: '{{count}} points',
  },

  actions: {
    /** The keyboard/right-click reschedule menu on a chip. */
    moveTo: 'Move to…',
  },

  states: {
    empty: 'Nothing scheduled here',
    emptyBody:
      'No task starts or falls due in this period. Drag one in from the unscheduled tray, or step to another month.',
  },

  tray: {
    title: 'Unscheduled',
    hide: 'Hide unscheduled',
    empty: 'Everything has a date',
    emptyBody: 'Tasks with no start or due date collect here.',
    scheduleToday: 'Schedule for today',
    hint: 'Drag a task onto a day to schedule it.',
  },

  toast: {
    rescheduled: '{{key}} rescheduled',
  },

  /** Screen-reader only. */
  a11y: {
    day: '{{date}}',
    showWeek: 'Show the week of {{date}}',
    weekGrid: 'Tasks this week',
    resizeStart: 'Drag to change the start date',
    resizeEnd: 'Drag to change the due date',
  },

  /**
   * Screen-reader narration for the reschedule drag, read by dnd-kit (WP5.1).
   *
   * A calendar drop CHANGES A DATE, so the announcement names the DAY rather
   * than the drop target — dnd-kit's own English default ("was dropped over
   * droppable area 17") names neither, in either language.
   */
  dnd: {
    instructions:
      'Press space to pick a task up. Use the arrow keys to move it across the calendar, then press space to drop it on a day. Press escape to cancel.',
    picked: 'Picked up {{key}}.',
    over: '{{key}} is now over {{day}}.',
    dropped: 'Dropped {{key}} on {{day}}.',
    cancelled: 'Cancelled. {{key}} kept its dates.',
  },
} as const;
