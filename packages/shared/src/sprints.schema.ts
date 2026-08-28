// Sprint contracts: the scrum cycle (plan -> start -> complete) and the two
// point stamps that make velocity meaningful.
//
// `committedPoints` is stamped AT START and `completedPoints` AT COMPLETE, both
// server-side, both immutable afterwards. Recomputing them later would make the
// velocity chart rewrite its own history every time someone re-estimates a
// closed sprint, which is precisely the number teams use to plan the next one.
//
// Runtime-neutral: zod only, no DOM/Node globals.
import { z } from 'zod';
import { isoDate, isoDateTime, uuid } from './common';
import { nameSchema } from './users.schema';
import {
  VM_DATE_RANGE_INVALID,
  VM_TOO_LONG,
  VM_UPDATE_AT_LEAST_ONE_FIELD,
} from './validation-messages';

/**
 * Sprint lifecycle. A project may hold many `planned` and many `completed`
 * sprints but at most ONE `active` — enforced by a partial unique index, not by
 * hope.
 */
export const sprintStateSchema = z.enum(['planned', 'active', 'completed']);
export type SprintState = z.infer<typeof sprintStateSchema>;

/** The sprint goal blurb, or `null`. */
export const sprintGoalSchema = z.string().trim().max(1000, VM_TOO_LONG).nullable();

/** A sprint row. */
export const sprintSchema = z.object({
  id: uuid,
  projectId: uuid,
  name: nameSchema,
  goal: sprintGoalSchema,
  state: sprintStateSchema,
  /** Planned dates — calendar days, so a sprint boundary never shifts by zone. */
  startDate: isoDate.nullable(),
  endDate: isoDate.nullable(),
  /** Actual instants, stamped by `/start` and `/complete`. */
  startedAt: isoDateTime.nullable(),
  completedAt: isoDateTime.nullable(),
  /** Sum of story points in scope at START; `null` until the sprint starts. */
  committedPoints: z.number().nonnegative().nullable(),
  /** Sum of DONE story points at COMPLETE; `null` until the sprint completes. */
  completedPoints: z.number().nonnegative().nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type Sprint = z.infer<typeof sprintSchema>;

/** `POST /projects/:projectId/sprints` — creates in the `planned` state. */
export const createSprintInputSchema = z
  .object({
    name: nameSchema,
    goal: sprintGoalSchema.default(null),
    startDate: isoDate.nullable().default(null),
    endDate: isoDate.nullable().default(null),
  })
  .refine(
    (value) =>
      value.startDate === null || value.endDate === null || value.endDate >= value.startDate,
    { message: VM_DATE_RANGE_INVALID, path: ['endDate'] },
  );
export type CreateSprintInput = z.infer<typeof createSprintInputSchema>;

/**
 * `PATCH /projects/:projectId/sprints/:sprintId` — at least one field required.
 * `state` is absent on purpose: the two state changes that matter have their own
 * endpoints, because each has side effects (`/start` stamps commitment,
 * `/complete` moves the leftovers).
 */
export const updateSprintInputSchema = z
  .object({
    name: nameSchema,
    goal: sprintGoalSchema,
    startDate: isoDate.nullable(),
    endDate: isoDate.nullable(),
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: VM_UPDATE_AT_LEAST_ONE_FIELD })
  .refine(
    (value) =>
      value.startDate === undefined ||
      value.endDate === undefined ||
      value.startDate === null ||
      value.endDate === null ||
      value.endDate >= value.startDate,
    { message: VM_DATE_RANGE_INVALID, path: ['endDate'] },
  );
export type UpdateSprintInput = z.infer<typeof updateSprintInputSchema>;

/**
 * `POST /projects/:projectId/sprints/:sprintId/start` — dates are required here
 * even though they are nullable on the row: a running sprint with no end date
 * has no burndown x-axis. Fails if another sprint is already active.
 */
export const startSprintInputSchema = z
  .object({
    startDate: isoDate,
    endDate: isoDate,
  })
  .refine((value) => value.endDate >= value.startDate, {
    message: VM_DATE_RANGE_INVALID,
    path: ['endDate'],
  });
export type StartSprintInput = z.infer<typeof startSprintInputSchema>;

/**
 * `POST /projects/:projectId/sprints/:sprintId/complete` — every task not in a
 * `done` status has to go somewhere, and the caller says where:
 * `'backlog'` clears `sprint_id`, a uuid moves them into that (planned) sprint.
 * There is no "leave them here" option; that is what keeps a completed sprint's
 * `completedPoints` a fact rather than a moving target.
 */
export const completeSprintInputSchema = z.object({
  moveIncompleteTo: z.union([z.literal('backlog'), uuid]),
});
export type CompleteSprintInput = z.infer<typeof completeSprintInputSchema>;

/** `GET /projects/:projectId/sprints?state=` — the backlog page's sprint list. */
export const sprintListQuerySchema = z.object({
  state: sprintStateSchema.optional(),
});
export type SprintListQuery = z.infer<typeof sprintListQuerySchema>;
