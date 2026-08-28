/**
 * The diagnostics drawer's chrome constants and PURE helpers.
 *
 * Deliberately React-free and DOM-free (it only ever receives plain objects, so
 * `isNearBottom` takes the three numbers it needs rather than an `HTMLElement`).
 * That is what lets every rule the drawer actually encodes — severity ordering,
 * the minimum-level filter, the badge tint, the timestamp format, the JSONL
 * serialization, the stick-to-bottom threshold — be unit-tested in the web
 * package's default `node` environment, with no jsdom and no render.
 *
 * The class strings live here for the same reason the logic does: one place to
 * change the dense devtools look, and no component importing another
 * component's styling.
 */
import type { LogLevel, ServerLogRecord } from '@flowboard/shared';
import { isSideDock, type DiagDock } from '@/stores/useLayoutStore';

// ───────────────────────────────────────────────────────────────────────────
// Chrome
// ───────────────────────────────────────────────────────────────────────────

/** The drawer header's icon button — small, quiet, hover-lit. */
export const ICON_BTN =
  'inline-flex size-7 shrink-0 items-center justify-center rounded-[var(--btn-radius)] text-[var(--text-muted)] transition-colors duration-[var(--speed)] hover:bg-[var(--secondary)] hover:text-[var(--text)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]';

/** A monospace value chip (context keys, counters). */
export const MONO_CHIP =
  'inline-flex shrink-0 items-center rounded-[var(--btn-radius)] border border-[var(--border)] bg-[var(--bg)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--text-muted)]';

/**
 * How many (already filtered) rows the list paints, newest-last.
 *
 * The STORE keeps up to `LOGS_CAP` (1000) records; painting all of them is what
 * turns a busy tail into a janky one. 500 rows is far more than fits any dock
 * size, and the copy button still serializes the full filtered set — so the cap
 * costs the user nothing they can see.
 */
export const RENDER_ROW_CAP = 500;

// ───────────────────────────────────────────────────────────────────────────
// Dock geometry
// ───────────────────────────────────────────────────────────────────────────

/**
 * Which flex direction the SHELL must run in for a given dock.
 *
 * Side docks make the shell a row (drawer beside the app); top/bottom make it a
 * column (drawer above or below it). The drawer is a real flex child either
 * way — it pushes content, it never floats over it.
 */
export function shellDirectionClass(dock: DiagDock): string {
  return isSideDock(dock) ? 'flex-row' : 'flex-col';
}

/**
 * Does the drawer come FIRST in the shell's flex order?
 *
 * ── THE ONE DELIBERATE PHYSICAL-DIRECTION DEVIATION IN THE APP ──────────────
 * Everything else in FlowBoard uses logical properties (`ms-`, `pe-`,
 * `start-`); the dock sides are PHYSICAL. That is the devtools convention and
 * it is the right one here: "dock it to the left" is a statement about the
 * screen, the way a developer moves a console around, not about reading order.
 * An Arabic-reading developer asking for a left dock means the left of their
 * monitor.
 *
 * Which is exactly why this function exists. CSS `direction: rtl` reverses the
 * main axis of a flex ROW, so under `dir="rtl"` the FIRST child is painted on
 * the RIGHT. A physical-left dock must therefore become the LAST child, and a
 * physical-right dock the first — the XOR below. Columns are NOT affected by
 * direction (`top` is above `bottom` in every language), so the top/bottom case
 * ignores `rtl` entirely.
 *
 * Pure, and takes `rtl` as an argument rather than calling `isRTL()`, so the
 * whole truth table is a node test: four docks × two directions.
 */
export function isDrawerFirst(dock: DiagDock, rtl: boolean): boolean {
  return isSideDock(dock) ? (dock === 'left') !== rtl : dock === 'top';
}

/**
 * The physical border the drawer shows toward the page content.
 *
 * PHYSICAL, NOT LOGICAL, ON PURPOSE: a dock side is a SCREEN EDGE, not a
 * reading edge. A drawer docked left stays on the left in Arabic — that is the
 * devtools convention the whole panel follows (see the header of
 * `locales/ar/diagnostics.ts`) — so its inner border faces right in both
 * directions and `border-e` would flip it away from the content.
 */
export const DOCK_BORDER_CLASS: Record<DiagDock, string> = {
  bottom: 'border-t',
  top: 'border-b',
  left: 'border-r',
  right: 'border-l',
};

// ───────────────────────────────────────────────────────────────────────────
// Levels
// ───────────────────────────────────────────────────────────────────────────

/** The pino levels, least → most severe. Comparison is on this number. */
export const LOG_LEVEL_ORDER: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  fatal: 5,
};

/**
 * The filter selection: a MINIMUM severity, or the `'all'` sentinel.
 *
 * A string sentinel rather than `null` because the value round-trips through a
 * Radix `DropdownMenuRadioGroup`, whose `value` is a string — `null` would have
 * to be encoded and decoded at both ends of every change handler.
 */
export type LevelFilter = 'all' | LogLevel;

/**
 * The choices the header offers, in menu order.
 *
 * `trace` and `fatal` are absent ON PURPOSE: they are ends of the scale, not
 * useful floors. "Debug and above" already includes trace's neighbours, and
 * "Errors and above" already includes fatal.
 *
 * Typed as its OWN union rather than `LevelFilter[]`, which is what lets the
 * menu resolve `diagnostics:logs.levels.${choice}` as a checked i18n key —
 * there is no `levels.trace` string to resolve, and there should not be one.
 */
export type LevelFilterChoice = 'all' | 'debug' | 'info' | 'warn' | 'error';

export const LEVEL_FILTER_CHOICES: readonly LevelFilterChoice[] = [
  'all',
  'debug',
  'info',
  'warn',
  'error',
];

/** Keeps the records at or above `min`. `'all'` returns the input unchanged. */
export function filterByMinLevel(
  records: readonly ServerLogRecord[],
  min: LevelFilter,
): ServerLogRecord[] {
  if (min === 'all') return [...records];
  const floor = LOG_LEVEL_ORDER[min];
  return records.filter((record) => LOG_LEVEL_ORDER[record.level] >= floor);
}

/**
 * The design token a level's badge is tinted from.
 *
 * Returns the VARIABLE NAME, not a colour: the badge builds both its text
 * colour and its `color-mix()` background from the one token, which is what
 * keeps a Theme Studio preset restyling the drawer for free (design-system.md:
 * zero colour literals in components).
 */
export function levelBadgeVar(level: LogLevel): string {
  switch (level) {
    case 'trace':
    case 'debug':
      return '--text-muted';
    case 'info':
      return '--info';
    case 'warn':
      return '--warning';
    case 'error':
    case 'fatal':
      return '--danger';
  }
}

/** Inline style for a level badge: token-coloured text on a 14% wash of itself. */
export function levelBadgeStyle(level: LogLevel): { color: string; background: string } {
  const token = levelBadgeVar(level);
  return {
    color: `var(${token})`,
    background: `color-mix(in oklab, var(${token}) 14%, transparent)`,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Rows
// ───────────────────────────────────────────────────────────────────────────

/**
 * `HH:mm:ss.SSS` in the viewer's LOCAL time, from epoch-ms.
 *
 * Hand-padded rather than `Intl.DateTimeFormat`: this is a devtools column, so
 * it must be fixed-width, 24-hour and millisecond-precise in every locale —
 * three things the locale-aware formatter would each undo. (The app's numerals
 * are Western in Arabic too — see `lib/lang-policy` — so nothing is mirrored
 * away here either.)
 */
export function formatLogTime(epochMs: number): string {
  const date = new Date(epochMs);
  if (Number.isNaN(date.getTime())) return '--:--:--.---';
  const pad = (value: number, width = 2): string => String(value).padStart(width, '0');
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(
    date.getMilliseconds(),
    3,
  )}`;
}

/**
 * Context keys promoted to inline chips on the row itself.
 *
 * An ALLOWLIST, not a "first three keys": these four are the ids you scan a log
 * with in this app (whose session, which project, which task, which subsystem),
 * and everything else — request bodies, durations, error stacks — stays behind
 * the expander where it cannot push the message off the row.
 */
export const CONTEXT_CHIP_KEYS = ['userId', 'projectId', 'taskId', 'scope'] as const;

/** The `key:value` chips for one record's context, in allowlist order. */
export function contextChips(context: Record<string, unknown>): string[] {
  return CONTEXT_CHIP_KEYS.filter((key) => context[key] != null).map(
    (key) => `${key}:${String(context[key])}`,
  );
}

/**
 * True when a scroller sits within `threshold` px of its bottom.
 *
 * The stick-to-bottom rule in one function, and the reason it takes a plain
 * `{ scrollHeight, scrollTop, clientHeight }` instead of an element: the
 * behaviour that matters ("a user who scrolled up keeps their place") is
 * arithmetic, and arithmetic deserves a test that does not boot a DOM.
 */
export function isNearBottom(
  el: { scrollHeight: number; scrollTop: number; clientHeight: number },
  threshold = 24,
): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight <= threshold;
}

/**
 * Newline-delimited JSON — one record per line, no trailing newline.
 *
 * JSONL rather than a JSON array because that is what every log tool on the
 * other end of a paste (`jq`, `pino-pretty`, a grep) already reads.
 */
export function logsToJsonl(records: readonly ServerLogRecord[]): string {
  return records.map((record) => JSON.stringify(record)).join('\n');
}

/**
 * Best-effort clipboard write.
 *
 * Returns whether the API was reachable at all, so a caller can decide about a
 * toast; it never throws and never rejects. `navigator.clipboard` is absent
 * over plain HTTP and in jsdom, and a copy button is not worth an error
 * boundary.
 */
export function copyText(text: string): boolean {
  try {
    const clipboard = globalThis.navigator?.clipboard;
    if (!clipboard) return false;
    void clipboard.writeText(text);
    return true;
  } catch {
    // Clipboard blocked by permissions policy — nothing else to do.
    return false;
  }
}
