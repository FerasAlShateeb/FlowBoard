import { z } from 'zod';
import type { ActivityAction } from '@flowboard/shared';

/**
 * Turning one audit row into one readable sentence.
 *
 * ── The contract ────────────────────────────────────────────────────────────
 *
 * `activityActionSchema` is a CLOSED enum, and this is the reason it is closed:
 * the feed renders a localized sentence per action, so an action with no
 * sentence would surface as a raw `task.moved_sprint` in prose a user is
 * reading. {@link ACTIVITY_SENTENCE_KEYS} is therefore declared
 * `satisfies Record<ActivityAction, …>` — adding a member to the shared enum
 * without adding a key here is a COMPILE error, not a runtime surprise — and
 * `activity-format.test.ts` additionally proves every one of those keys actually
 * resolves in the catalog.
 *
 * Keys are the full `tasks:activity.<action>` literal rather than a suffix so
 * the union that comes out of an index is a union of valid `t()` keys, which is
 * what keeps the dynamic lookup type-checked against the English catalog.
 *
 * ── Values are `unknown`, and that is not laziness ──────────────────────────
 *
 * `field`, `oldValue` and `newValue` are jsonb columns: the row holds whatever
 * the changed field held — a uuid, a number of points, a `YYYY-MM-DD`, an array
 * of label ids, `null` for a cleared assignee. {@link formatActivityValue}
 * narrows that safely with zod rather than casting, and falls back to a capped
 * JSON rendering for a shape it does not recognise. A feed that throws on an
 * unexpected value would take the whole task sheet down with it.
 */

// ───────────────────────────────────────────────────────────────────────────
// The sentence map
// ───────────────────────────────────────────────────────────────────────────

/**
 * One catalog key per audit action.
 *
 * Every sentence in both catalogs names `{{actor}}`, and the ones that describe
 * a change also take `{{field}}`, `{{from}}` and `{{to}}`. The uniform shape is
 * deliberate: the renderer indexes this map dynamically and passes one options
 * bag, so a sentence that needed a variable nobody supplies would render the
 * placeholder verbatim.
 */
export const ACTIVITY_SENTENCE_KEYS = {
  'task.created': 'tasks:activity.task.created',
  'task.field_changed': 'tasks:activity.task.field_changed',
  'task.status_changed': 'tasks:activity.task.status_changed',
  'task.assigned': 'tasks:activity.task.assigned',
  'task.moved_sprint': 'tasks:activity.task.moved_sprint',
  'task.ranked': 'tasks:activity.task.ranked',
  'task.deleted': 'tasks:activity.task.deleted',
  'comment.added': 'tasks:activity.comment.added',
  'comment.edited': 'tasks:activity.comment.edited',
  'comment.deleted': 'tasks:activity.comment.deleted',
  'attachment.added': 'tasks:activity.attachment.added',
  'attachment.deleted': 'tasks:activity.attachment.deleted',
  'dependency.added': 'tasks:activity.dependency.added',
  'dependency.removed': 'tasks:activity.dependency.removed',
  'watcher.added': 'tasks:activity.watcher.added',
  'watcher.removed': 'tasks:activity.watcher.removed',
  'label.added': 'tasks:activity.label.added',
  'label.removed': 'tasks:activity.label.removed',
  'sprint.created': 'tasks:activity.sprint.created',
  'sprint.started': 'tasks:activity.sprint.started',
  'sprint.completed': 'tasks:activity.sprint.completed',
  'sprint.deleted': 'tasks:activity.sprint.deleted',
  'workflow.changed': 'tasks:activity.workflow.changed',
  'project.created': 'tasks:activity.project.created',
  'project.updated': 'tasks:activity.project.updated',
  'project.deleted': 'tasks:activity.project.deleted',
  'member.added': 'tasks:activity.member.added',
  'member.removed': 'tasks:activity.member.removed',
} as const satisfies Record<ActivityAction, `tasks:activity.${string}`>;

/** The union of every sentence key — all valid `t()` keys by construction. */
export type ActivitySentenceKey = (typeof ACTIVITY_SENTENCE_KEYS)[ActivityAction];

/** The catalog key for one action. Total by construction. */
export function activitySentenceKey(action: ActivityAction): ActivitySentenceKey {
  return ACTIVITY_SENTENCE_KEYS[action];
}

// ───────────────────────────────────────────────────────────────────────────
// Field names
// ───────────────────────────────────────────────────────────────────────────

/**
 * `task.field_changed` rows carry the COLUMN name in `field`. These are the
 * columns `patchTaskInputSchema` can actually change, plus an `unknown` catch —
 * a row written by a future field would otherwise put a bare `storyPoints` into
 * an Arabic sentence.
 */
export const ACTIVITY_FIELD_KEYS = {
  title: 'tasks:activity.field.title',
  description: 'tasks:activity.field.description',
  type: 'tasks:activity.field.type',
  statusId: 'tasks:activity.field.statusId',
  priority: 'tasks:activity.field.priority',
  assigneeId: 'tasks:activity.field.assigneeId',
  storyPoints: 'tasks:activity.field.storyPoints',
  startDate: 'tasks:activity.field.startDate',
  dueDate: 'tasks:activity.field.dueDate',
  sprintId: 'tasks:activity.field.sprintId',
  epicId: 'tasks:activity.field.epicId',
  parentId: 'tasks:activity.field.parentId',
  labelIds: 'tasks:activity.field.labelIds',
  unknown: 'tasks:activity.field.unknown',
} as const;

export type ActivityFieldKey = (typeof ACTIVITY_FIELD_KEYS)[keyof typeof ACTIVITY_FIELD_KEYS];

/** Field name → catalog key, with `unknown` as the total fallback. */
export function activityFieldKey(field: unknown): ActivityFieldKey {
  if (typeof field !== 'string') return ACTIVITY_FIELD_KEYS.unknown;
  return (
    (ACTIVITY_FIELD_KEYS as Record<string, ActivityFieldKey | undefined>)[field] ??
    ACTIVITY_FIELD_KEYS.unknown
  );
}

// ───────────────────────────────────────────────────────────────────────────
// Values
// ───────────────────────────────────────────────────────────────────────────

/**
 * The shapes a jsonb audit value is ALLOWED to render as text directly.
 * Anything else takes the JSON fallback below.
 */
const primitiveValue = z.union([z.string(), z.number(), z.boolean()]);

/** How long a JSON fallback may get before it stops being a sentence. */
const MAX_VALUE_LENGTH = 80;

/** A uuid, so an id can be swapped for the name it points at. */
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu;

/**
 * Resolves a row id to something a human recognises — a status name, an
 * assignee, a label, a sprint. Returns `null` when the id is unknown (a status
 * deleted since, a member removed), in which case the raw value is used.
 */
export type ActivityNameLookup = (id: string) => string | null;

function truncate(value: string): string {
  return value.length <= MAX_VALUE_LENGTH ? value : `${value.slice(0, MAX_VALUE_LENGTH - 1)}…`;
}

/**
 * One `oldValue` / `newValue` as display text, or `null` for "nothing".
 *
 * `null` is a MEANINGFUL answer, not a failure: a cleared assignee genuinely
 * changed *to* nothing, and the caller substitutes `activity.nothing` rather
 * than printing an empty gap in the middle of a sentence.
 *
 * Numbers go through `String()` rather than `toLocaleString()` — FlowBoard shows
 * Western digits in every locale, and a locale-aware format would put
 * Arabic-Indic numerals into an otherwise Latin-numeral page.
 */
export function formatActivityValue(value: unknown, resolve?: ActivityNameLookup): string | null {
  if (value === null || value === undefined) return null;

  // NaN / ±Infinity, checked BEFORE zod. `z.number()` rejects a non-finite
  // number, so without this guard it would fall through to the JSON branch —
  // and `JSON.stringify(Infinity)` is the string `"null"`, which would print
  // the word "null" in the middle of a sentence.
  if (typeof value === 'number' && !Number.isFinite(value)) return null;

  const parsed = primitiveValue.safeParse(value);
  if (parsed.success) {
    const primitive = parsed.data;

    if (typeof primitive === 'boolean') return String(primitive);
    if (typeof primitive === 'number') return Number.isFinite(primitive) ? String(primitive) : null;

    const text = primitive.trim();
    if (text === '') return null;
    if (resolve && UUID_PATTERN.test(text)) return truncate(resolve(text) ?? text);
    return truncate(text);
  }

  // An array of label ids, or something a future field invented. JSON is not
  // pretty, but it is honest and it cannot throw the feed.
  try {
    const json = JSON.stringify(value);
    return json === undefined ? null : truncate(json);
  } catch {
    return null;
  }
}
