import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useVirtualizer } from '@tanstack/react-virtual';
import { CalendarRange } from 'lucide-react';
import type { Status, TaskSummary } from '@flowboard/shared';

import { cn } from '@/lib/utils';
import { getIntlLocale } from '@/lib/lang-policy';
import { usePatchTask } from '@/hooks/useTaskMutations';
import { Button } from '@/components/ui/button';
import EmptyState from '@/components/common/EmptyState';
import {
  AXIS_HEIGHT,
  DAY_WIDTH,
  ROW_HEIGHT,
  SIDEBAR_WIDTH,
  ZOOM_LEVELS,
  daysBetween,
  deriveRange,
  todayDay,
  useGanttGeometry,
  type GanttZoom,
} from '@/components/gantt/useGanttGeometry';
import { buildGanttRows, rowIndexById, rowSpan } from '@/components/gantt/gantt-rows';
import { seedSchedule } from '@/components/gantt/gantt-drag';
import { edgeKey, type DependencyEdge } from '@/components/gantt/gantt-arrows';
import { useGanttDependencies } from '@/components/gantt/useGanttDependencies';
import GanttSidebar from '@/components/gantt/GanttSidebar';
import GanttTimeAxis from '@/components/gantt/GanttTimeAxis';
import GanttGrid from '@/components/gantt/GanttGrid';
import GanttBarLayer from '@/components/gantt/GanttBarLayer';
import GanttDependencyLayer from '@/components/gantt/GanttDependencyLayer';
import GanttZoomControls from '@/components/gantt/GanttZoomControls';

/**
 * The roadmap chart: a fixed sidebar, a scrollable time canvas, and the wiring
 * that keeps them describing the same rows.
 *
 * ═══ TWO SCROLL BOXES, ONE VIRTUALIZER ════════════════════════════════════
 *
 * The canvas owns BOTH axes of scrolling and is the virtualizer's scroll
 * element. The sidebar has its own vertical box (so a wheel over the names
 * still scrolls) whose `scrollTop` is mirrored to the canvas's, and both panes
 * render the SAME `getVirtualItems()` array.
 *
 * The mirror is deliberately stateless — `if (target.scrollTop !== source.scrollTop)`
 * and nothing else. Assigning `scrollTop` a value it already holds fires no
 * scroll event, so the ping-pong terminates after exactly one bounce with no
 * lock, no flag, and no timer to get wrong. A `syncing` boolean released on a
 * timeout (the usual shape of this) drops frames whenever the user switches
 * panes mid-flick.
 *
 * The two boxes stay aligned because their scrollable heights are equal by
 * construction: the canvas is `AXIS_HEIGHT + rows` tall inside a box `H` tall,
 * the sidebar is `rows` tall inside a box `H - AXIS_HEIGHT` tall (its own
 * header is outside the scroll box), and `(AXIS + rows) - H` equals
 * `rows - (H - AXIS)`. The one asymmetry is the canvas's horizontal scrollbar,
 * which eats a few pixels of its client height — worth a few px of drift at the
 * very bottom of a long list, and not worth a `ResizeObserver`.
 *
 * ═══ THE `dir="ltr"` ISLAND ═══════════════════════════════════════════════
 *
 * The canvas element carries `dir="ltr"`; the sidebar inherits the page's
 * direction. Everything downstream follows from that one attribute: `scrollLeft`
 * counts up from the left edge in every browser, `clientX` deltas mean what
 * they say, and `dateToX` needs no mirror. See `GanttTimeAxis` for the policy
 * and `GanttSidebar` for the other half of it.
 */

export interface GanttChartProps {
  projectId: string;
  /** The project key as the URL spells it — used to build task-sheet links. */
  projectKeyParam: string;
  /** The canonical uppercase key, used to compose `FLOW-142`. */
  projectKey: string;
  orgSlug: string;
  tasks: readonly TaskSummary[];
  statuses: readonly Status[];
  canWrite: boolean;
  /** True when {@link useRoadmapTasks} hit its page cap. */
  truncated: boolean;
}

export function GanttChart({
  projectId,
  projectKeyParam,
  projectKey,
  orgSlug,
  tasks,
  statuses,
  canWrite,
  truncated,
}: GanttChartProps) {
  const { t } = useTranslation(['roadmap']);
  const navigate = useNavigate();
  const locale = getIntlLocale();

  const canvasRef = useRef<HTMLDivElement | null>(null);
  const sidebarScrollRef = useRef<HTMLDivElement | null>(null);

  const [zoom, setZoom] = useState<GanttZoom>('month');
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set<string>());
  const [showDependencies, setShowDependencies] = useState(true);
  const [hoveredTaskId, setHoveredTaskId] = useState<string | null>(null);
  const [hoveredEdge, setHoveredEdge] = useState<DependencyEdge | null>(null);

  // ── Model ───────────────────────────────────────────────────────────────

  const categoryByStatusId = useMemo(
    () => new Map(statuses.map((status) => [status.id, status.category] as const)),
    [statuses],
  );

  const rows = useMemo(
    () => buildGanttRows({ tasks, categoryByStatusId, collapsed }),
    [tasks, categoryByStatusId, collapsed],
  );
  const rowIndex = useMemo(() => rowIndexById(rows), [rows]);

  /** Pinned at mount: a chart whose "today" moved mid-session would jump. */
  const today = useMemo(() => todayDay(), []);
  const range = useMemo(() => deriveRange(tasks, zoom, today), [tasks, zoom, today]);
  const geometry = useGanttGeometry({ zoom, ...range, today });

  const numberById = useMemo(
    () => new Map(tasks.map((task) => [task.id, task.number] as const)),
    [tasks],
  );

  // ── Virtualization ──────────────────────────────────────────────────────

  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => canvasRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 8,
    // The axis is the first 48px of the canvas's scroll content, so every row
    // has to start after it. Expressing that as the virtualizer's own padding
    // (rather than as an offset added at each render site) is what lets
    // `item.start` be used verbatim as a canvas y by the bars AND the arrows.
    paddingStart: AXIS_HEIGHT,
    getItemKey: (index) => rows[index]?.id ?? index,
  });

  const items = virtualizer.getVirtualItems();
  const totalSize = virtualizer.getTotalSize();
  const rowsHeight = Math.max(0, totalSize - AXIS_HEIGHT);

  // ── Scroll ──────────────────────────────────────────────────────────────

  const mirrorScroll = (source: HTMLDivElement | null, target: HTMLDivElement | null) => {
    if (!source || !target) return;
    if (target.scrollTop !== source.scrollTop) target.scrollTop = source.scrollTop;
  };

  /** Applied by the layout effect once the canvas has a measurable width. */
  const pendingScrollRef = useRef<{ date: string; align: number } | null>({
    // First paint lands with today a third in from the reading edge: far enough
    // right to show what just happened, far enough left to show what is coming.
    date: today,
    align: 0.3,
  });

  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const pending = pendingScrollRef.current;
    if (!canvas || !pending || canvas.clientWidth === 0) return;
    pendingScrollRef.current = null;
    canvas.scrollLeft = Math.max(
      0,
      Math.min(
        geometry.totalWidth - canvas.clientWidth,
        geometry.dateToX(pending.date) - canvas.clientWidth * pending.align,
      ),
    );
  }, [geometry]);

  /**
   * Changing zoom keeps the date under the middle of the viewport under the
   * middle of the viewport. Without this, zooming out from a week in November
   * dumps the user at the start of the range with no idea where they were.
   */
  const changeZoom = (next: GanttZoom) => {
    const canvas = canvasRef.current;
    pendingScrollRef.current =
      canvas && canvas.clientWidth > 0
        ? { date: geometry.xToDate(canvas.scrollLeft + canvas.clientWidth / 2), align: 0.5 }
        : null;
    setZoom(next);
  };

  const scrollToToday = () => {
    const canvas = canvasRef.current;
    if (!canvas || geometry.todayX === null) return;
    canvas.scrollTo({
      left: Math.max(
        0,
        Math.min(
          geometry.totalWidth - canvas.clientWidth,
          geometry.todayX - canvas.clientWidth * 0.4,
        ),
      ),
      behavior: 'smooth',
    });
  };

  /** The coarsest zoom is the fallback: something always "fits" at 4px/day. */
  const fitRange = () => {
    const canvas = canvasRef.current;
    const width = canvas?.clientWidth ?? 0;
    const next =
      ZOOM_LEVELS.find((level) => {
        const fitted = deriveRange(tasks, level, today);
        const days = daysBetween(fitted.rangeStart, fitted.rangeEnd) + 1;
        return days * DAY_WIDTH[level] <= width;
      }) ?? 'quarter';

    pendingScrollRef.current = { date: deriveRange(tasks, next, today).rangeStart, align: 0 };
    setZoom(next);
  };

  // ── Dependencies ────────────────────────────────────────────────────────

  /**
   * EVERY edge in the project, from one request — not the visible window's.
   *
   * There is nothing to window here any more: `GanttDependencyLayer` already
   * draws an arrow only when both of its rows are rendered AND both have a bar,
   * so handing it the whole set costs one `Map` lookup per edge and buys the
   * arrows whose other end is off screen, which the old per-row detail fetch
   * could not see at all.
   */
  const { edges } = useGanttDependencies(projectId, showDependencies);

  // ── Interaction ─────────────────────────────────────────────────────────

  const { mutateAsync } = usePatchTask(projectId);

  const commit = useCallback(
    (taskId: string, patch: { startDate: string; dueDate: string }) =>
      mutateAsync({ taskId, ...patch }),
    [mutateAsync],
  );

  const openTask = useCallback(
    (taskId: string) => {
      const number = numberById.get(taskId);
      if (number === undefined) return;
      // Absolute rather than relative: the task sheet is itself a child route,
      // so a relative `t/FLOW-1` from an already-open sheet would nest.
      void navigate(`/o/${orgSlug}/p/${projectKeyParam}/roadmap/t/${projectKey}-${String(number)}`);
    },
    [navigate, numberById, orgSlug, projectKeyParam, projectKey],
  );

  const scheduleTask = useCallback(
    (taskId: string) => {
      void commit(taskId, seedSchedule(today)).catch(() => undefined);
    },
    [commit, today],
  );

  const toggleRow = useCallback((rowId: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(rowId)) next.delete(rowId);
      else next.add(rowId);
      return next;
    });
  }, []);

  /** A bar and its sidebar row light up together, from either end. */
  const hoveredTaskIds = useMemo(() => {
    const set = new Set<string>();
    if (hoveredTaskId) set.add(hoveredTaskId);
    if (hoveredEdge) {
      set.add(hoveredEdge.blockerId);
      set.add(hoveredEdge.blockedId);
    }
    return set;
  }, [hoveredTaskId, hoveredEdge]);

  const hasDatedRow = useMemo(() => rows.some((row) => rowSpan(row) !== null), [rows]);
  const firstSchedulable = rows.find((row) => row.kind === 'task');

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-[var(--gap)]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <GanttZoomControls
          zoom={zoom}
          onZoomChange={changeZoom}
          onToday={scrollToToday}
          todayAvailable={geometry.todayX !== null}
          onFit={fitRange}
          showDependencies={showDependencies}
          onToggleDependencies={setShowDependencies}
        />
        {truncated ? (
          <p className="text-xs text-[var(--warning)]">
            {t('roadmap:truncated', { count: tasks.length })}
          </p>
        ) : null}
      </div>

      <div className="flex min-h-0 flex-1 overflow-hidden rounded-[var(--card-radius)] border border-border bg-surface">
        {/* ── Sidebar pane (page direction — RTL on an Arabic page) ──────── */}
        <div
          className="flex shrink-0 flex-col border-e border-border bg-surface"
          style={{ width: SIDEBAR_WIDTH }}
        >
          <div
            className="flex shrink-0 items-center border-b border-border bg-surface-raised px-2 text-[11px] font-medium text-muted-foreground"
            style={{ height: AXIS_HEIGHT }}
          >
            {t('roadmap:sidebar.header')}
          </div>
          <div
            ref={sidebarScrollRef}
            data-testid="gantt-sidebar-scroll"
            // `overflow-y-auto` with the scrollbar hidden: the pane must still
            // respond to a wheel or a trackpad flick over the names, but a
            // second visible vertical bar next to the canvas's own would read
            // as two independent lists.
            className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            onScroll={() => {
              mirrorScroll(sidebarScrollRef.current, canvasRef.current);
            }}
          >
            <div className="relative" style={{ height: rowsHeight }}>
              <GanttSidebar
                rows={rows}
                items={items}
                paddingStart={AXIS_HEIGHT}
                projectKey={projectKey}
                canWrite={canWrite}
                hoveredTaskIds={hoveredTaskIds}
                onToggle={toggleRow}
                onOpen={openTask}
                onSchedule={scheduleTask}
                onHover={setHoveredTaskId}
              />
            </div>
          </div>
        </div>

        {/* ── Canvas pane — THE `dir="ltr"` ISLAND ───────────────────────── */}
        <div
          ref={canvasRef}
          dir="ltr"
          data-testid="gantt-canvas"
          className="relative min-w-0 flex-1 overflow-auto"
          onScroll={() => {
            mirrorScroll(canvasRef.current, sidebarScrollRef.current);
          }}
        >
          <div
            className="relative"
            style={{ width: geometry.totalWidth, height: Math.max(totalSize, AXIS_HEIGHT) }}
          >
            <GanttGrid geometry={geometry} height={rowsHeight} />
            <GanttTimeAxis geometry={geometry} locale={locale} />
            <GanttBarLayer
              rows={rows}
              items={items}
              geometry={geometry}
              categoryByStatusId={categoryByStatusId}
              canWrite={canWrite}
              hoveredTaskIds={hoveredTaskIds}
              locale={locale}
              onCommit={commit}
              onOpen={openTask}
              onHover={setHoveredTaskId}
            />
            {showDependencies ? (
              <GanttDependencyLayer
                rows={rows}
                items={items}
                geometry={geometry}
                edges={edges}
                rowIndex={rowIndex}
                height={Math.max(totalSize, AXIS_HEIGHT)}
                hoveredEdge={hoveredEdge ? edgeKey(hoveredEdge) : null}
                onHoverEdge={setHoveredEdge}
              />
            ) : null}
          </div>

          {/*
            Nothing is scheduled yet: the chart still renders (every row is in
            the sidebar with its "schedule" affordance) and the explanation sits
            over the empty grid, where the missing bars would be.
          */}
          {hasDatedRow ? null : (
            <div
              className={cn(
                'pointer-events-none sticky left-0 top-0 z-30 flex items-center justify-center',
                'h-full w-full',
              )}
              // The island is LTR, but this panel is prose: it reads in the
              // page's own direction.
              dir="auto"
            >
              <div className="pointer-events-auto max-w-sm rounded-[var(--card-radius)] border border-border bg-surface-raised p-1 shadow-[var(--shadow-2)]">
                <EmptyState
                  icon={<CalendarRange className="size-4" />}
                  title={t('roadmap:empty.unscheduledTitle')}
                  message={t('roadmap:empty.unscheduledBody')}
                  action={
                    canWrite && firstSchedulable ? (
                      <Button
                        size="sm"
                        onClick={() => {
                          scheduleTask(firstSchedulable.id);
                        }}
                      >
                        {t('roadmap:empty.cta')}
                      </Button>
                    ) : undefined
                  }
                />
              </div>
            </div>
          )}
        </div>
      </div>

      {/* The keyboard contract, stated once where a keyboard user will find it. */}
      <p className="text-[11px] text-muted-foreground">{t('roadmap:bar.keyboardHint')}</p>
    </div>
  );
}

export default GanttChart;
