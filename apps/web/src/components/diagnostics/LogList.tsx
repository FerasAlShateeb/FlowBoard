import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ArrowDownToLine } from 'lucide-react';
import type { LogLevel, ServerLogRecord } from '@flowboard/shared';

import { useDiagLogsStore } from '@/stores/useDiagLogsStore';
import {
  contextChips,
  filterByMinLevel,
  formatLogTime,
  isNearBottom,
  levelBadgeStyle,
  MONO_CHIP,
  RENDER_ROW_CAP,
} from '@/components/diagnostics/diag-chrome';

/**
 * The tail itself: the scroller, the rows, and the stick-to-bottom behaviour.
 *
 * Split out of `DiagnosticsDrawer` so the drawer file is only chrome (header,
 * dock, resize) and this file is only the list — the two things that change for
 * completely different reasons.
 *
 * ── THE POLLING WINDOW IS THIS COMPONENT'S LIFETIME ─────────────────────────
 * `startPolling` on mount, `stopPolling` on unmount, and the drawer only
 * renders this when it is OPEN and the viewer is a global admin. So the request
 * loop exists exactly while a global admin is looking at it: closing the drawer
 * stops it, and so does signing out. (Pausing stops the FETCH too — that lives
 * in the store, because a pause must survive a re-render.)
 */

/** A tinted, uppercase severity badge — the row's colour cue. */
function LevelBadge({ level }: { level: LogLevel }) {
  return (
    <span
      className="shrink-0 rounded px-1 text-[10px] font-semibold uppercase leading-4"
      style={levelBadgeStyle(level)}
      data-testid="fb-diag-level-badge"
    >
      {level}
    </span>
  );
}

/**
 * One log line.
 *
 * The layout is a devtools row, not a card: time, level, message, and the
 * allowlisted context ids on ONE line, with everything else folded into a
 * native `<details>`. `<details>` rather than local state on purpose — 500 rows
 * that each own an open/closed boolean is 500 re-renders the browser was
 * willing to handle for free.
 */
function LogRow({ record }: { record: ServerLogRecord }) {
  const { t } = useTranslation(['diagnostics']);
  const chips = contextChips(record.context);
  const hasContext = Object.keys(record.context).length > 0;

  return (
    <div
      className="border-b border-[var(--border)]/50 px-2 py-0.5"
      data-testid="fb-diag-row"
      data-level={record.level}
      data-log-id={record.id}
    >
      {/*
        `flex-wrap` IS LOAD-BEARING — it is what keeps a side dock readable.

        The context chips are `shrink-0` (a truncated user id is worse than no
        user id), and a `userId:<uuid>` chip is ~45 monospace characters. On a
        NON-wrapping row that chip claimed its full intrinsic width and squeezed
        the message down to about one character, at which point `break-words`
        dutifully broke it one letter per line: "S / o / c / k / e / t". The
        drawer's whole job is reading log lines, and in the 380px left/right
        docks it could not do it.

        Wrapping fixes it without truncating anything: at bottom/top width
        nothing wraps and the layout is unchanged, and in a side dock the chips
        drop to their own line while the message keeps the rest of the first
        one. `gap-y-0.5` rather than `gap-2` so a wrapped row stays dense.
      */}
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <span className="shrink-0 text-[var(--text-muted)]" data-testid="fb-diag-row-time">
          {formatLogTime(record.time)}
        </span>
        <LevelBadge level={record.level} />
        <span className="min-w-0 break-words text-[var(--text)]" data-testid="fb-diag-row-msg">
          {record.msg}
        </span>
        {chips.map((chip) => (
          <span key={chip} className={MONO_CHIP} data-testid="fb-diag-chip">
            {chip}
          </span>
        ))}
      </div>
      {hasContext ? (
        <details className="mt-0.5" data-testid="fb-diag-context">
          <summary className="cursor-pointer text-[10px] text-[var(--text-muted)] hover:text-[var(--text)]">
            {t('diagnostics:logs.context')}
          </summary>
          <pre className="mt-0.5 overflow-x-auto whitespace-pre-wrap break-words rounded bg-[var(--bg)] p-1.5 text-[10px] text-[var(--text-muted)]">
            {JSON.stringify(record.context, null, 2)}
          </pre>
        </details>
      ) : null}
    </div>
  );
}

export default function LogList() {
  const { t } = useTranslation(['diagnostics']);
  const records = useDiagLogsStore((state) => state.records);
  const minLevel = useDiagLogsStore((state) => state.minLevel);
  const paused = useDiagLogsStore((state) => state.paused);
  const error = useDiagLogsStore((state) => state.error);

  const listRef = useRef<HTMLDivElement>(null);
  /** Whether new rows should pull the view down. A ref: it must not re-render. */
  const stickRef = useRef(true);
  const [showJump, setShowJump] = useState(false);

  useEffect(() => {
    useDiagLogsStore.getState().startPolling();
    return () => {
      useDiagLogsStore.getState().stopPolling();
    };
  }, []);

  // Filtering is a RENDER concern: the store keeps every record it was sent, so
  // raising the minimum level and lowering it again reveals the lines that were
  // hidden rather than having thrown them away.
  const filtered = filterByMinLevel(records, minLevel);
  const visible =
    filtered.length > RENDER_ROW_CAP ? filtered.slice(filtered.length - RENDER_ROW_CAP) : filtered;

  // Stick-to-bottom: follow the tail while the user is AT the tail, and hold
  // their place the moment they scroll up to read something. The pill is how
  // they get back — and how they know new lines are still arriving.
  useEffect(() => {
    const element = listRef.current;
    if (!element) return;
    if (stickRef.current) {
      element.scrollTop = element.scrollHeight;
      setShowJump(false);
    } else {
      setShowJump(true);
    }
  }, [visible.length]);

  const onScroll = (): void => {
    const element = listRef.current;
    if (!element) return;
    stickRef.current = isNearBottom(element);
    setShowJump(!stickRef.current);
  };

  const jumpToLatest = (): void => {
    const element = listRef.current;
    if (!element) return;
    element.scrollTop = element.scrollHeight;
    stickRef.current = true;
    setShowJump(false);
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={listRef}
        onScroll={onScroll}
        data-testid="fb-diag-list"
        className="flex-1 overflow-y-auto font-mono text-xs"
      >
        {visible.length === 0 ? (
          <div className="p-4 text-center text-xs text-[var(--text-muted)]">
            {error !== null ? (
              <span className="text-[var(--danger)]" data-testid="fb-diag-error">
                {error}
              </span>
            ) : (
              <span data-testid="fb-diag-empty">
                {paused ? t('diagnostics:logs.pausedHint') : t('diagnostics:logs.empty')}
              </span>
            )}
          </div>
        ) : (
          visible.map((record) => <LogRow key={record.id} record={record} />)
        )}
      </div>

      {showJump ? (
        <button
          type="button"
          data-testid="fb-diag-jump"
          onClick={jumpToLatest}
          // `start-1/2` + a logical translate would flip the pill's anchor with
          // the language for no reason: it is centred over its own scroller.
          className="absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full bg-[var(--primary)] px-2.5 py-1 text-[11px] font-medium text-[var(--primary-fg)] shadow-[var(--shadow-2)]"
        >
          <ArrowDownToLine className="size-3" aria-hidden />
          {t('diagnostics:jumpToLatest')}
        </button>
      ) : null}
    </div>
  );
}
