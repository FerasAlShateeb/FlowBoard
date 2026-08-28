/**
 * `diagnostics` — the admin-only devtools drawer (WP4.4).
 *
 * Almost every string here is an ICON BUTTON's accessible name rather than
 * visible copy: the drawer is a dense devtools strip, so the label is what a
 * screen reader (and the e2e suite) reads, and the tooltip is what a mouse
 * user sees. They are deliberately verb-first ("Pause the tail", not "Pause")
 * because out of context "Clear" answers neither *what* nor *where*.
 *
 * The `logs.levels.*` keys are MINIMUM severities, not level names — the filter
 * is "show me warnings and worse", so the copy says so.
 */
export default {
  title: 'Diagnostics',
  close: 'Close diagnostics',
  resize: 'Resize the diagnostics panel',
  jumpToLatest: 'Jump to latest',

  dock: {
    label: 'Dock side',
    cycle: 'Move the panel to the next edge',
    bottom: 'Dock to the bottom',
    left: 'Dock to the left',
    right: 'Dock to the right',
    top: 'Dock to the top',
  },

  logs: {
    pause: 'Pause the log tail',
    resume: 'Resume the log tail',
    paused: 'Paused',
    clear: 'Clear the log view',
    copy: 'Copy these lines as JSON',
    filter: 'Minimum log level',
    minLevel: 'Minimum level',
    levels: {
      all: 'All levels',
      debug: 'Debug and above',
      info: 'Info and above',
      warn: 'Warnings and above',
      error: 'Errors and above',
    },
    context: 'Context',
    empty:
      'No log lines yet. Only what the API writes through pino — at or above its LOG_LEVEL — reaches this buffer.',
    pausedHint: 'Paused. Nothing is being fetched until you resume.',
    unavailable: 'Logs unavailable — the request to /api/admin/logs failed.',
  },

  /** The topbar button — the discoverable half of Ctrl+J. */
  open: 'Open diagnostics',

  shortcuts: {
    toggle: 'Open or close the diagnostics drawer',
    cycleDock: 'Move the diagnostics drawer to the next edge',
  },
} as const;
