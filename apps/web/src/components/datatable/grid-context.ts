import { createContext, useContext } from 'react';
import type { Label, Sprint, Status, Transition } from '@flowboard/shared';

import type { TableColumnId } from '@/components/datatable/table-model';
import type { CellPatcher } from '@/components/datatable/useCellPatch';

/**
 * Everything an inline cell editor needs, delivered by context rather than by
 * props.
 *
 * WHY CONTEXT AND NOT `tableMeta`. TanStack v9 does have a typed per-table meta
 * slot, and threading this through it would work — but the value would then be
 * reachable only from a `CellContext`, which means the toolbar, the column
 * popover and the export could not read the same statuses/labels/sprints, and
 * every cell component would need `TFeatures` in its signature to name its own
 * props. A plain React context keeps the cell components ordinary components
 * that happen to render inside a grid, and it is what makes them testable by
 * rendering one cell under one provider.
 *
 * WHY THE EDIT STATE LIVES HERE TOO. Exactly one cell in the grid is in edit
 * mode at a time, and the component that knows a click landed (the grid cell
 * wrapper, which owns roving focus) is not the component that renders the
 * editor (the column's cell renderer). One shared `editing` coordinate is the
 * smallest thing that lets those two agree, and it makes "opening an editor
 * closes the previous one" fall out for free instead of needing a broadcast.
 */

/** Which cell is open for editing, addressed the way a grid addresses a cell. */
export interface EditingCell {
  taskId: string;
  columnId: TableColumnId;
}

export interface TableGridEnv {
  projectId: string;
  /** The org, for the assignee picker's user directory. */
  orgId: string | null;
  /** For building the task-sheet link (`/o/:orgSlug/p/:projectKey/table/t/KEY`). */
  projectKey: string;
  /** Board columns, in board order — the status editor's options. */
  statuses: readonly Status[];
  /** The transition whitelist. Empty means every move is allowed. */
  transitions: readonly Transition[];
  /** The project's label vocabulary. */
  labels: readonly Label[];
  /** Every sprint, for the sprint editor. */
  sprints: readonly Sprint[];
  /** `false` for a viewer: cells render read-only and never open an editor. */
  canWrite: boolean;
  patcher: CellPatcher;
  editing: EditingCell | null;
  beginEdit: (cell: EditingCell) => void;
  /** Closes the editor and returns focus to the cell it belonged to. */
  endEdit: () => void;
}

const TableGridContext = createContext<TableGridEnv | null>(null);

export const TableGridProvider = TableGridContext.Provider;

/**
 * The grid environment. Throws outside a provider — a cell rendered without one
 * would silently lose its editors, which is a much harder bug to find than a
 * crash on the first render.
 */
export function useTableGrid(): TableGridEnv {
  const env = useContext(TableGridContext);
  if (!env) throw new Error('useTableGrid must be used inside a TableGridProvider');
  return env;
}

/** Is this exact cell the one being edited? */
export function useIsEditing(taskId: string, columnId: TableColumnId): boolean {
  const { editing } = useTableGrid();
  return editing?.taskId === taskId && editing.columnId === columnId;
}
