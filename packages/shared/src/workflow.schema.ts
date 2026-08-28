// Per-project workflow contracts: the board's columns (`statuses`) and the
// optional whitelist of moves between them (`workflow_transitions`).
//
// Statuses are DATA, not a pg enum: every project designs its own columns, so a
// new column must never need a migration. Only `category` is closed, because the
// product reasons about it — "done" is what stamps `resolved_at`, feeds the
// burndown, and strikes a dependency through.
//
// Runtime-neutral: zod only, no DOM/Node globals.
import { z } from 'zod';
import { hexColor, uuid } from './common';
import { nameSchema } from './users.schema';
import {
  VM_AT_LEAST_ONE_ITEM,
  VM_POSITION_INVALID,
  VM_TRANSITION_SELF,
  VM_UPDATE_AT_LEAST_ONE_FIELD,
  VM_WIP_LIMIT_MIN,
} from './validation-messages';

/**
 * The closed semantic bucket a status belongs to. Entering a `done` status is
 * what sets `resolved_at`; `todo` and `in_progress` split the cumulative-flow
 * chart and drive the cycle-time clock (started = first `in_progress`).
 */
export const statusCategorySchema = z.enum(['todo', 'in_progress', 'done']);
export type StatusCategory = z.infer<typeof statusCategorySchema>;

/** A WIP limit, or `null` for "unlimited" — 0 is not a way to say unlimited. */
export const wipLimitSchema = z.number().int().min(1, VM_WIP_LIMIT_MIN).nullable();

/**
 * One board column of one project. `position` is a dense 0-based integer (not a
 * fractional rank): columns are few and reordered as a whole set, so the whole
 * column order is rewritten in one transaction by `statuses/order`.
 */
export const statusSchema = z.object({
  id: uuid,
  projectId: uuid,
  name: nameSchema,
  category: statusCategorySchema,
  color: hexColor,
  position: z.number().int().min(0, VM_POSITION_INVALID),
  wipLimit: wipLimitSchema,
});
export type Status = z.infer<typeof statusSchema>;

/** `POST /projects/:projectId/statuses` — appended at the end of the board. */
export const createStatusInputSchema = z.object({
  name: nameSchema,
  category: statusCategorySchema,
  color: hexColor,
  wipLimit: wipLimitSchema.default(null),
});
export type CreateStatusInput = z.infer<typeof createStatusInputSchema>;

/**
 * `PATCH /projects/:projectId/statuses/:statusId` — at least one field required.
 * `position` is absent on purpose: reordering goes through
 * {@link reorderStatusesInputSchema} so the whole order stays consistent.
 */
export const updateStatusInputSchema = z
  .object({
    name: nameSchema,
    category: statusCategorySchema,
    color: hexColor,
    wipLimit: wipLimitSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: VM_UPDATE_AT_LEAST_ONE_FIELD });
export type UpdateStatusInput = z.infer<typeof updateStatusInputSchema>;

/**
 * `PUT /projects/:projectId/statuses/order` — the complete, ordered list of the
 * project's status ids. The server rejects a list that is not exactly the
 * project's current status set, so a concurrent column add cannot be silently
 * dropped by a stale drag.
 */
export const reorderStatusesInputSchema = z.object({
  statusIds: z.array(uuid).min(1, VM_AT_LEAST_ONE_ITEM),
});
export type ReorderStatusesInput = z.infer<typeof reorderStatusesInputSchema>;

/**
 * `DELETE /projects/:projectId/statuses/:statusId` — the BODY, not a query
 * param, because it is a decision about where work goes rather than a filter on
 * what is deleted.
 *
 * `moveTasksTo` is optional in the contract and REQUIRED by the server when the
 * column still holds tasks: only the server knows whether it does, and
 * answering "409, 12 tasks are in this column" is a far better prompt than a
 * blanket 422 on an empty column that could have been deleted outright. The UI
 * asks for a destination up front regardless — "where did my twelve cards go?"
 * is not a recoverable question.
 */
export const deleteStatusInputSchema = z.object({
  moveTasksTo: uuid.optional(),
});
export type DeleteStatusInput = z.infer<typeof deleteStatusInputSchema>;

/**
 * One allowed move between two statuses.
 *
 * WORKFLOW SEMANTICS (the rule both the board and `PATCH /tasks/:id` enforce):
 * transitions are a per-SOURCE-status whitelist, evaluated per source, not
 * globally.
 *
 * - **Zero rows FROM a status => every move out of that status is allowed.**
 *   This is what makes a fresh project fully open with no rows at all.
 * - **One or more rows FROM a status => only those targets are allowed**, and
 *   every other move out of that status is rejected with `TRANSITION_NOT_ALLOWED`.
 *
 * The two are independent per status: locking down "In Review" leaves "To Do"
 * open. A status is always allowed to transition to ITSELF (a same-column
 * reorder is not a transition), which is why self-referential rows are rejected.
 */
export const transitionSchema = z.object({
  id: uuid,
  projectId: uuid,
  fromStatusId: uuid,
  toStatusId: uuid,
});
export type Transition = z.infer<typeof transitionSchema>;

/** An edge in the whole-set PUT — ids only, since the row id is server-owned. */
export const transitionEdgeSchema = z
  .object({
    fromStatusId: uuid,
    toStatusId: uuid,
  })
  .refine((value) => value.fromStatusId !== value.toStatusId, {
    message: VM_TRANSITION_SELF,
    path: ['toStatusId'],
  });
export type TransitionEdge = z.infer<typeof transitionEdgeSchema>;

/**
 * `PUT /projects/:projectId/transitions` — replaces the project's ENTIRE
 * transition set in one transaction. A whole-set PUT is the only safe shape for
 * a graph editor: a per-edge API lets a half-applied burst leave a status
 * whitelisted with a single unreachable target, which is a workflow nobody can
 * escape. An empty array means "no restrictions anywhere".
 */
export const replaceTransitionsInputSchema = z.object({
  transitions: z.array(transitionEdgeSchema),
});
export type ReplaceTransitionsInput = z.infer<typeof replaceTransitionsInputSchema>;

/**
 * The complete workflow of a project — what the settings editor loads and what
 * the `workflow:changed` socket event carries so open boards re-render columns
 * and forbidden-drop styling without a refetch.
 */
export const workflowSchema = z.object({
  statuses: z.array(statusSchema),
  transitions: z.array(transitionSchema),
});
export type Workflow = z.infer<typeof workflowSchema>;
