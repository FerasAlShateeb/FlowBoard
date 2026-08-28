// Shared zod primitives reused by every contract in this package: identifiers,
// the wire date conventions, and the query-string parsers (`?page`, `?sort`,
// comma-separated multi-value filters) that the API's `validate(schema, 'query')`
// middleware and the web's query-key factory both run.
//
// Runtime-neutral: zod only, no DOM/Node globals.
import { z } from 'zod';
import {
  VM_DATE_INVALID,
  VM_DATE_TIME_INVALID,
  VM_HEX_COLOR_INVALID,
  VM_PAGE_MIN,
  VM_PAGE_SIZE_MAX,
  VM_PAGE_SIZE_MIN,
  VM_SLUG_FORMAT,
  VM_SORT_FIELD_UNKNOWN,
  VM_SORT_FORMAT,
  VM_UUID_INVALID,
} from './validation-messages';

/**
 * Canonical row identifier. Every domain table uses a UUID primary key, so each
 * cross-boundary reference to one of our rows is validated as a UUID. The
 * append-only streams (`activity`, `telemetry_events`) use bigserial ids and are
 * carried as strings instead — see {@link bigIntId}.
 */
export const uuid = z.uuid(VM_UUID_INVALID);
export type Uuid = z.infer<typeof uuid>;

/** Alias of {@link uuid} for call sites that read better as `idSchema`. */
export const idSchema = uuid;
export type Id = z.infer<typeof idSchema>;

/**
 * A bigserial primary key (activity, telemetry, request logs) as a decimal
 * string. Strings, not numbers: Postgres `bigint` exceeds `Number.MAX_SAFE_INTEGER`
 * and JSON has no 64-bit integer, so a number would silently round at scale.
 */
export const bigIntId = z.string().regex(/^\d+$/, VM_UUID_INVALID);
export type BigIntId = z.infer<typeof bigIntId>;

/**
 * URL-safe organization slug: lowercase alphanumeric groups joined by single
 * dashes (`acme`, `acme-corp`). Used in the `/o/:orgSlug` route.
 */
export const slugSchema = z
  .string()
  .trim()
  .min(2, VM_SLUG_FORMAT)
  .max(60, VM_SLUG_FORMAT)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, VM_SLUG_FORMAT);
export type Slug = z.infer<typeof slugSchema>;

/**
 * Dates cross the wire as ISO-8601 strings — one convention for the whole
 * package. `offset: true` accepts both `…Z` and `…+03:00` forms.
 */
export const isoDateTime = z.iso.datetime({ offset: true, message: VM_DATE_TIME_INVALID });
export type IsoDateTime = z.infer<typeof isoDateTime>;

/**
 * A DATE-ONLY ISO-8601 string (`YYYY-MM-DD`), for values that are a calendar
 * bucket rather than an instant — a sprint start, a task due date, a burndown
 * day. Distinct from {@link isoDateTime} on purpose: stamping a calendar day
 * with a full timestamp invites clients to re-interpret it in the local zone and
 * shift the day by one, which is exactly how a due date lands on the wrong
 * column of a calendar view.
 */
export const isoDate = z.iso.date(VM_DATE_INVALID);
export type IsoDate = z.infer<typeof isoDate>;

/**
 * `#rgb` or `#rrggbb` hex color — status pills and labels, whose pickers are hex
 * pickers. The Theme Studio's tokens are deliberately NOT this: they accept CSS
 * color functions too, because FlowBoard's palette is authored in OKLCH (see
 * `theme.schema.ts`).
 */
export const hexColor = z
  .string()
  .regex(/^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/, VM_HEX_COLOR_INVALID);
export type HexColor = z.infer<typeof hexColor>;

/**
 * The `'none'` sentinel used by multi-value filter params to mean "the NULL
 * bucket": `?sprintId=none` is the backlog, `?assigneeId=none` is unassigned,
 * `?parentId=none` is top-level. A bare omission means "no filter at all", which
 * is a different question — hence a sentinel rather than an empty value.
 */
export const NONE_SENTINEL = 'none';

/** A row id or the {@link NONE_SENTINEL} — the shape of nullable-id filters. */
export const uuidOrNone = z.union([z.literal(NONE_SENTINEL), uuid]);
export type UuidOrNone = z.infer<typeof uuidOrNone>;

/**
 * Query-string boolean: accepts a real boolean (JSON bodies) or the
 * `true/false/1/0` spellings a URL can carry (`?unread=1`).
 */
export const booleanQuery = z
  .union([z.boolean(), z.enum(['true', 'false', '1', '0'])])
  .transform((raw) => raw === true || raw === 'true' || raw === '1');
export type BooleanQuery = z.infer<typeof booleanQuery>;

/**
 * `?page&pageSize` — the pagination contract for every list endpoint. Values
 * arrive as strings, so they are coerced; both have defaults, so a caller that
 * passes nothing still gets page 1 of 25. The 100 ceiling is a hard server
 * limit, not a suggestion.
 */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1, VM_PAGE_MIN).default(1),
  pageSize: z.coerce.number().int().min(1, VM_PAGE_SIZE_MIN).max(100, VM_PAGE_SIZE_MAX).default(25),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

/** Sort direction half of a `?sort=field:asc` parameter. */
export const sortDirectionSchema = z.enum(['asc', 'desc']);
export type SortDirection = z.infer<typeof sortDirectionSchema>;

/** A parsed `?sort` parameter: the field and the direction, split apart. */
export const sortSpecSchema = z.object({
  field: z.string().min(1, VM_SORT_FORMAT),
  direction: sortDirectionSchema,
});
export type SortSpec = z.infer<typeof sortSpecSchema>;

/** `field:asc` / `field:desc`; the direction half is optional and defaults to asc. */
const SORT_PATTERN = /^[A-Za-z][A-Za-z0-9_]*(?::(?:asc|desc))?$/;

/** Splits a validated `field[:direction]` string; direction defaults to `asc`. */
function splitSortSpec(raw: string): SortSpec {
  const [field = '', direction] = raw.split(':');
  return { field, direction: direction === 'desc' ? 'desc' : 'asc' };
}

/**
 * `?sort=field:asc|desc` with any field name. Endpoints that know their sortable
 * columns should prefer {@link sortQueryFor}, which rejects unknown fields at the
 * boundary instead of letting them reach a query builder.
 */
export const sortQuerySchema = z
  .string()
  .regex(SORT_PATTERN, VM_SORT_FORMAT)
  .transform(splitSortSpec);

/**
 * Builds a `?sort` parser restricted to a whitelist of columns — the form every
 * endpoint should use, because the parsed `field` then has a literal union type
 * that a `switch` can exhaustively map to a Drizzle column.
 *
 * @example
 *   const taskSort = sortQueryFor(['createdAt', 'dueDate', 'priority']);
 *   taskSort.parse('dueDate:desc'); // { field: 'dueDate', direction: 'desc' }
 */
export function sortQueryFor<const TFields extends readonly [string, ...string[]]>(
  fields: TFields,
) {
  return z
    .string()
    .regex(SORT_PATTERN, VM_SORT_FORMAT)
    .transform(splitSortSpec)
    .pipe(
      z.object({
        field: z.enum(fields, VM_SORT_FIELD_UNKNOWN),
        direction: sortDirectionSchema,
      }),
    );
}

/**
 * Builds a parser for a comma-separated multi-value filter param
 * (`?statusId=a,b,c`), which is the project-wide convention for "this filter
 * accepts several values".
 *
 * Accepts either the raw string or an already-split array (Express hands you an
 * array when the param repeats: `?statusId=a&statusId=b`), trims each entry,
 * drops empties, then validates every survivor with `item`.
 *
 * @example
 *   const filter = commaSeparatedList(uuid).optional();
 *   filter.parse('a-uuid, b-uuid'); // ['a-uuid', 'b-uuid']
 */
export function commaSeparatedList<TItem extends z.ZodType>(item: TItem) {
  return z.preprocess((raw): unknown => {
    if (typeof raw === 'string') {
      return raw
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
    }

    if (Array.isArray(raw)) {
      const entries: unknown[] = raw;
      return entries
        .map((entry) => (typeof entry === 'string' ? entry.trim() : entry))
        .filter((entry) => entry !== '');
    }

    // Anything else falls through unchanged so `z.array()` reports the real
    // type error rather than this helper inventing one.
    return raw;
  }, z.array(item));
}

/**
 * Any value that survives a JSON round-trip: the contract for a column we store
 * as JSONB but never interpret.
 *
 * Recursive, so it needs `z.lazy` plus an explicit TS annotation — zod cannot
 * infer a self-referential schema, and the `z.ZodType<JsonValue>` annotation is
 * what stops the inference collapsing.
 *
 * Deliberately NOT `z.unknown()`: an opaque blob still has to be *serializable*.
 * `undefined`, functions and class instances are rejected here rather than
 * silently mangled by `JSON.stringify` on the way into Postgres.
 */
export type JsonValue =
  string | number | boolean | null | JsonValue[] | { [key: string]: JsonValue };

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(jsonValueSchema),
    z.record(z.string(), jsonValueSchema),
  ]),
);
