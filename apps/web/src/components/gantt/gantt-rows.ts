import type { StatusCategory, TaskSummary } from '@flowboard/shared';

import type { DatedSpan } from '@/components/gantt/useGanttGeometry';

/**
 * The roadmap's ROW MODEL — a flat task list turned into the tree the sidebar
 * and the canvas both iterate.
 *
 * FLAT, NOT NESTED. The two panes are driven by ONE virtualizer, and a
 * virtualizer measures a list of rows by index; a nested structure would have to
 * be flattened at render time on both sides, twice, and the two flattenings
 * would eventually disagree about what row 47 is. So the tree is expressed as
 * `depth` on a flat array and the collapse state is applied HERE, once.
 *
 * ═══ WHAT BECOMES A ROW ════════════════════════════════════════════════════
 *
 *   epic            a row, with a disclosure triangle and a rolled-up bar
 *     ↳ its tasks   rows at depth 1, matched by `epicId`
 *   "No epic"       a group header, then every remaining top-level task
 *   subtask         NOT a row — rolled into its parent's tooltip count
 *
 * Subtasks are excluded because a roadmap is a plan, and a plan is made of the
 * things people commit to; a 40-row epic whose rows are mostly checklist items
 * is a checklist, not a roadmap. The count survives on the parent so nothing is
 * silently lost.
 *
 * Everything here is PURE and synchronous — no React, no geometry, no locale.
 */

// ───────────────────────────────────────────────────────────────────────────
// Shapes
// ───────────────────────────────────────────────────────────────────────────

/** The sentinel id of the "No epic" group. Never a real uuid. */
export const NO_EPIC_GROUP_ID = 'no-epic';

/** A resolved date span, or `null` when nothing in the group carries dates. */
export type DateSpan = { startDate: string; dueDate: string } | null;

/** The "No epic" header. */
export interface GanttGroupRow {
  kind: 'group';
  /** Row identity AND collapse key. */
  id: typeof NO_EPIC_GROUP_ID;
  /** How many task rows sit under it when expanded. */
  childCount: number;
  collapsed: boolean;
}

/** An epic: a disclosure, a roll-up bar and a progress ratio. */
export interface GanttEpicRow {
  kind: 'epic';
  id: string;
  task: TaskSummary;
  /**
   * The epic's OWN dates when it has them, otherwise the roll-up of its
   * children — see {@link rollUpSpan} for why its own dates win.
   */
  span: DateSpan;
  /** True when {@link span} came from the children rather than from the epic. */
  rolledUp: boolean;
  childCount: number;
  /** Children in a `done`-category status — the progress overlay's numerator. */
  doneCount: number;
  /** Subtasks hanging off this epic's children, plus its own. */
  subtaskCount: number;
  collapsed: boolean;
}

/** A normal task row. `depth` 1 under an epic, 0 under the "No epic" group. */
export interface GanttTaskRow {
  kind: 'task';
  id: string;
  task: TaskSummary;
  depth: 0 | 1;
  subtaskCount: number;
}

export type GanttRow = GanttGroupRow | GanttEpicRow | GanttTaskRow;

/** What {@link buildGanttRows} needs beyond the tasks themselves. */
export interface BuildRowsInput {
  tasks: readonly TaskSummary[];
  /** `statusId` → category, from the project detail. Drives `doneCount`. */
  categoryByStatusId: ReadonlyMap<string, StatusCategory>;
  /** Ids of collapsed epics, plus possibly {@link NO_EPIC_GROUP_ID}. */
  collapsed: ReadonlySet<string>;
}

// ───────────────────────────────────────────────────────────────────────────
// Roll-up
// ───────────────────────────────────────────────────────────────────────────

/**
 * The min-start / max-end of a set of spans.
 *
 * A member with only ONE date contributes it at both ends — a task due on the
 * 9th with no start still means the epic is not finished before the 9th, and
 * dropping it from the roll-up would make the epic bar claim otherwise.
 * Members with no dates at all contribute nothing. An empty (or entirely
 * undated) input rolls up to `null`, which the canvas draws as no bar.
 */
export function rollUpSpan(spans: readonly DateSpan[]): DateSpan {
  let start: string | null = null;
  let end: string | null = null;

  for (const entry of spans) {
    if (entry === null) continue;
    if (start === null || entry.startDate < start) start = entry.startDate;
    if (end === null || entry.dueDate > end) end = entry.dueDate;
  }

  return start === null || end === null ? null : { startDate: start, dueDate: end };
}

/**
 * A task's own span, normalised: a single-dated task becomes a one-day span,
 * an undated one becomes `null`.
 *
 * The same normalisation `geometry.barRect` applies, expressed on dates rather
 * than on pixels — which is what lets the roll-up be computed without a
 * geometry (and therefore without a zoom level) in hand.
 */
export function spanOf(task: DatedSpan): DateSpan {
  const from = task.startDate ?? task.dueDate;
  const to = task.dueDate ?? task.startDate;
  if (from === null || to === null) return null;
  // Inverted dates collapse to the start day, exactly as `barRect` draws them.
  return { startDate: from, dueDate: to < from ? from : to };
}

/**
 * An epic's span: its OWN dates when it has any, otherwise its children's.
 *
 * Own dates win because an epic with explicit dates is a commitment somebody
 * made deliberately — usually WIDER than the work currently scheduled under it,
 * and overwriting it with the roll-up would quietly erase the buffer. The
 * `rolledUp` flag it returns alongside is what the bar uses to decide whether
 * it is draggable and what its tooltip says.
 */
export function epicSpan(
  epic: DatedSpan,
  children: readonly DatedSpan[],
): { span: DateSpan; rolledUp: boolean } {
  const own = spanOf(epic);
  if (own !== null) return { span: own, rolledUp: false };
  return { span: rollUpSpan(children.map(spanOf)), rolledUp: true };
}

// ───────────────────────────────────────────────────────────────────────────
// Ordering
// ───────────────────────────────────────────────────────────────────────────

/**
 * Chronological, undated last, then by task number.
 *
 * A roadmap is read top-to-bottom as a sequence, so the earliest thing belongs
 * at the top. Undated rows sink to the bottom of their group rather than
 * floating to the top as "no date sorts first" would have them — they are the
 * work still to be planned, and the plan is what the user came to look at.
 * Task number is the tiebreaker so the order is TOTAL: without it, two tasks
 * starting the same day would swap places between renders.
 */
function compareRows(a: { span: DateSpan; number: number }, b: { span: DateSpan; number: number }) {
  if (a.span === null || b.span === null) {
    if (a.span !== b.span) return a.span === null ? 1 : -1;
  } else if (a.span.startDate !== b.span.startDate) {
    return a.span.startDate < b.span.startDate ? -1 : 1;
  }
  return a.number - b.number;
}

// ───────────────────────────────────────────────────────────────────────────
// The build
// ───────────────────────────────────────────────────────────────────────────

/** True for a row that must NOT appear on the roadmap: a subtask. */
function isSubtask(task: TaskSummary): boolean {
  return task.type === 'subtask' || task.parentId !== null;
}

/**
 * Turns the flat task list into the ordered row list both panes render.
 *
 * ORPHANS ARE NOT DROPPED. A task whose `epicId` names an epic that is not in
 * the list — filtered out, or on page 7 of a truncated fetch — falls into the
 * "No epic" group rather than vanishing. A roadmap that silently omits work is
 * worse than one that files it imprecisely.
 */
export function buildGanttRows({
  tasks,
  categoryByStatusId,
  collapsed,
}: BuildRowsInput): GanttRow[] {
  const epics: TaskSummary[] = [];
  const planned: TaskSummary[] = [];
  /** `parentId` → count, for the tooltip roll-up of the excluded subtasks. */
  const subtaskCounts = new Map<string, number>();

  for (const task of tasks) {
    if (isSubtask(task)) {
      const parentId = task.parentId;
      if (parentId !== null) subtaskCounts.set(parentId, (subtaskCounts.get(parentId) ?? 0) + 1);
      continue;
    }
    if (task.type === 'epic') epics.push(task);
    else planned.push(task);
  }

  const epicIds = new Set(epics.map((epic) => epic.id));
  const childrenByEpic = new Map<string, TaskSummary[]>();
  const orphans: TaskSummary[] = [];

  for (const task of planned) {
    const epicId = task.epicId;
    if (epicId !== null && epicIds.has(epicId)) {
      const bucket = childrenByEpic.get(epicId);
      if (bucket) bucket.push(task);
      else childrenByEpic.set(epicId, [task]);
    } else {
      orphans.push(task);
    }
  }

  const taskRow = (task: TaskSummary, depth: 0 | 1): GanttTaskRow => ({
    kind: 'task',
    id: task.id,
    task,
    depth,
    subtaskCount: subtaskCounts.get(task.id) ?? 0,
  });

  // ── Epic blocks, each already ordered internally ────────────────────────
  const blocks = epics.map((epic) => {
    const children = (childrenByEpic.get(epic.id) ?? [])
      .map((task) => ({ task, span: spanOf(task) }))
      .sort((a, b) =>
        compareRows(
          { span: a.span, number: a.task.number },
          { span: b.span, number: b.task.number },
        ),
      );

    const { span, rolledUp } = epicSpan(
      epic,
      children.map((child) => child.task),
    );

    const row: GanttEpicRow = {
      kind: 'epic',
      id: epic.id,
      task: epic,
      span,
      rolledUp,
      childCount: children.length,
      doneCount: children.filter((child) => categoryByStatusId.get(child.task.statusId) === 'done')
        .length,
      subtaskCount:
        (subtaskCounts.get(epic.id) ?? 0) +
        children.reduce((total, child) => total + (subtaskCounts.get(child.task.id) ?? 0), 0),
      collapsed: collapsed.has(epic.id),
    };

    return { row, children: children.map((child) => taskRow(child.task, 1)) };
  });

  blocks.sort((a, b) =>
    compareRows(
      { span: a.row.span, number: a.row.task.number },
      { span: b.row.span, number: b.row.task.number },
    ),
  );

  const rows: GanttRow[] = [];
  for (const block of blocks) {
    rows.push(block.row);
    if (!block.row.collapsed) rows.push(...block.children);
  }

  // ── The "No epic" group, only when it has members ───────────────────────
  if (orphans.length > 0) {
    const groupCollapsed = collapsed.has(NO_EPIC_GROUP_ID);
    rows.push({
      kind: 'group',
      id: NO_EPIC_GROUP_ID,
      childCount: orphans.length,
      collapsed: groupCollapsed,
    });
    if (!groupCollapsed) {
      rows.push(
        ...orphans
          .map((task) => ({ task, span: spanOf(task) }))
          .sort((a, b) =>
            compareRows(
              { span: a.span, number: a.task.number },
              { span: b.span, number: b.task.number },
            ),
          )
          .map((entry) => taskRow(entry.task, 0)),
      );
    }
  }

  return rows;
}

/** The span a row's bar is drawn from — `null` for a group header. */
export function rowSpan(row: GanttRow): DateSpan {
  if (row.kind === 'group') return null;
  return row.kind === 'epic' ? row.span : spanOf(row.task);
}

/** Row index by task id — what the dependency layer resolves endpoints with. */
export function rowIndexById(rows: readonly GanttRow[]): Map<string, number> {
  const index = new Map<string, number>();
  rows.forEach((row, position) => {
    if (row.kind !== 'group') index.set(row.id, position);
  });
  return index;
}
