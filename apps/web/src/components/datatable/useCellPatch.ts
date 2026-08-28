import { useCallback, useState } from 'react';
import type { PatchTaskInput } from '@flowboard/shared';

import { usePatchTask } from '@/hooks/useTaskMutations';

/**
 * One inline edit → one `PATCH /tasks/:id`, plus the per-cell "saving" flag.
 *
 * WHY A WRAPPER AROUND `usePatchTask` AT ALL. The mutation hook is shared by the
 * whole app and exposes ONE `isPending` for the whole mutation. A table where
 * every cell spins because someone changed a due date three rows up is worse
 * than no indicator at all — so the pending set is keyed by
 * `taskId + field` and lives here, where the grid can ask about exactly the
 * cell it is drawing.
 *
 * NOT DEBOUNCED, NOT BATCHED. Each editor commits once, on the interaction that
 * ends the edit (a select, a blur, an Enter), so there is nothing to coalesce —
 * and batching two fields of one row into a single request would lose the
 * per-field activity entries the API writes.
 *
 * ERRORS ARE THE HOOK'S JOB. `usePatchTask` is fully optimistic: `onMutate`
 * snapshots every cache entry it paints, `onError` restores them and raises the
 * localized toast, and `onSuccess` writes the authoritative row. So this
 * wrapper's `onSettled` only has to clear the per-cell flag — there is nothing
 * for it to undo, and adding a rollback here would restore a snapshot the
 * mutation has already put back.
 *
 * (That was not always true: the patch mutation started out non-optimistic, and
 * this note went on claiming "rolls nothing back" long after WP3.5 made it
 * roll back — the kind of comment that reads as permission to add a second,
 * conflicting recovery path.)
 */

/** The task fields the Table view can edit, spelled as the PATCH body spells them. */
export type EditableField =
  | 'title'
  | 'type'
  | 'statusId'
  | 'priority'
  | 'assigneeId'
  | 'storyPoints'
  | 'sprintId'
  | 'labelIds'
  | 'startDate'
  | 'dueDate';

/** The value type of one editable field, straight from the shared contract. */
export type EditableValue<TField extends EditableField> = NonNullable<PatchTaskInput[TField]>;

/** The pending-set key. Exported so tests can assert on it without guessing. */
export function cellKey(taskId: string, field: EditableField): string {
  return `${taskId}:${field}`;
}

/**
 * The request body for one cell edit.
 *
 * Pure, and separate from the hook, because "which key does this editor write"
 * is exactly the kind of thing that is wrong in a way nothing complains about:
 * a status editor that sends `status` instead of `statusId` gets a 422 the user
 * reads as "the server is broken", and a points editor that sends `points`
 * silently changes nothing. One function, asserted per field.
 */
export function buildCellPatch<TField extends EditableField>(
  taskId: string,
  field: TField,
  value: PatchTaskInput[TField],
): PatchTaskInput & { taskId: string } {
  return { taskId, [field]: value } as PatchTaskInput & { taskId: string };
}

export interface CellPatcher {
  /** Fires the PATCH. Returns immediately — the cell's spinner tracks the rest. */
  commit: <TField extends EditableField>(
    taskId: string,
    field: TField,
    value: PatchTaskInput[TField],
  ) => void;
  /** Is THIS cell mid-flight? */
  isSaving: (taskId: string, field: EditableField) => boolean;
}

export function useCellPatch(projectId: string): CellPatcher {
  const patchTask = usePatchTask(projectId);
  const { mutate } = patchTask;
  const [pending, setPending] = useState<ReadonlySet<string>>(() => new Set());

  const commit = useCallback<CellPatcher['commit']>(
    (taskId, field, value) => {
      const key = cellKey(taskId, field);

      setPending((current) => {
        const next = new Set(current);
        next.add(key);
        return next;
      });

      mutate(buildCellPatch(taskId, field, value), {
        onSettled: () => {
          setPending((current) => {
            if (!current.has(key)) return current;
            const next = new Set(current);
            next.delete(key);
            return next;
          });
        },
      });
    },
    [mutate],
  );

  const isSaving = useCallback(
    (taskId: string, field: EditableField) => pending.has(cellKey(taskId, field)),
    [pending],
  );

  return { commit, isSaving };
}

/**
 * `"0.5"` → `0.5`, `""` → `null`, anything else → a rejection.
 *
 * FRACTIONAL POINTS ARE THE WHOLE POINT (`storyPointsSchema` allows halves), so
 * this must not be `parseInt`, and it must not reject `.5` typed without its
 * leading zero. A comma is accepted as a decimal separator because an Arabic or
 * European keyboard produces one where an English one produces a dot — but the
 * VALUE that leaves here is always a JS number, so nothing downstream has to
 * know that happened.
 *
 * The range mirrors `storyPointsSchema` (0–1000). Rejecting locally is not
 * about trusting the client — the server re-validates — it is about not firing
 * a request that can only come back as a toast.
 */
export function parsePoints(raw: string): { ok: true; value: number | null } | { ok: false } {
  const trimmed = raw.trim().replace(',', '.');
  if (trimmed === '') return { ok: true, value: null };

  // `Number('')` is 0 and `Number('1 2')` is NaN; the explicit pattern rejects
  // the exponent and hex forms `Number` would otherwise accept ('1e3', '0x10').
  if (!/^\d*\.?\d+$/.test(trimmed)) return { ok: false };

  const value = Number(trimmed);
  if (!Number.isFinite(value) || value < 0 || value > 1000) return { ok: false };

  return { ok: true, value };
}
