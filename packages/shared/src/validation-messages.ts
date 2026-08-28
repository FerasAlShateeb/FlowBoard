// Validation messages — the single source of the user-facing English text that
// every zod schema in this package attaches to its checks.
//
// Why a constants module rather than inline literals: these strings surface
// VERBATIM in two very different places — a react-hook-form field error (via
// `zodResolver`) and an API `422` `error.details` payload — and the web app
// localizes the first of those. `apps/web/src/i18n/validation.ts` builds a
// `Record<ValidationMessage, i18nKey>` keyed by the exact values below, so a
// message is translatable without the schema (or the wire contract) knowing
// anything about i18next. Change a value here and the map's key changes with it,
// which is a COMPILE error on the web side rather than an English leak.
//
// The English text IS the wire contract: `apps/api`'s 422 bodies and this
// package's contract tests assert these exact strings. Edit the copy only
// deliberately.
//
// Runtime-neutral: plain string constants, no zod, no DOM/Node globals.

// ── Generic ────────────────────────────────────────────────────────────────

/** A required field arrived empty or missing. */
export const VM_REQUIRED = 'This field is required';
/** Generic minimum-length failure for free text without its own message. */
export const VM_TOO_SHORT = 'This value is too short';
/** Generic maximum-length failure for free text without its own message. */
export const VM_TOO_LONG = 'This value is too long';
/** A PATCH body arrived with every field absent — nothing to change. */
export const VM_UPDATE_AT_LEAST_ONE_FIELD = 'Provide at least one field to update';
/** A set-replacement body (team members, transitions) arrived empty. */
export const VM_AT_LEAST_ONE_ITEM = 'Select at least one item';

// ── Identifiers & formats ──────────────────────────────────────────────────

/** Value is not a UUID — every FlowBoard row id is one. */
export const VM_UUID_INVALID = 'Expected a valid identifier';
/** Value is not a parseable email address. */
export const VM_EMAIL_INVALID = 'Enter a valid email address';
/** Value is not an absolute URL (avatar URLs, presigned upload URLs). */
export const VM_URL_INVALID = 'Enter a valid URL';
/** Organization slug charset failure (`acme-corp`). */
export const VM_SLUG_FORMAT = 'Slug must be lowercase letters, digits and dashes';
/** Project key charset failure (`FLOW`, `FB2`) — see `projectKeySchema`. */
export const VM_KEY_FORMAT =
  'Key must be 2-10 characters: a letter then letters or digits, uppercase';
/** Task key charset failure (`FLOW-123`). */
export const VM_TASK_KEY_FORMAT = 'Task key must look like PROJ-123';
/** Value is not a `#rgb` / `#rrggbb` hex color. */
export const VM_HEX_COLOR_INVALID = 'Expected a hex color, e.g. #4f46e5';
/** Value is not an ISO-8601 instant. */
export const VM_DATE_TIME_INVALID = 'Expected an ISO-8601 date-time';
/** Value is not an ISO-8601 calendar date. */
export const VM_DATE_INVALID = 'Expected a date in YYYY-MM-DD form';
/** A start/end pair arrived reversed (sprint dates, task schedule). */
export const VM_DATE_RANGE_INVALID = 'End date must be on or after the start date';

// ── Credentials & invites ──────────────────────────────────────────────────

/** Password below the policy floor. */
export const VM_PASSWORD_MIN = 'Password must be at least 8 characters';
/** Password above the bcrypt-safe ceiling. */
export const VM_PASSWORD_MAX = 'Password must be at most 128 characters';
/** An invite acceptance arrived without its token. */
export const VM_TOKEN_REQUIRED = 'An invite token is required';

// ── Names & free text ──────────────────────────────────────────────────────

/** A display/entity name arrived empty. */
export const VM_NAME_REQUIRED = 'Name cannot be empty';
/** A display/entity name exceeded its column width. */
export const VM_NAME_MAX = 'Name must be at most 120 characters';
/** A task title arrived empty. */
export const VM_TITLE_REQUIRED = 'Title cannot be empty';
/** A task title exceeded its column width. */
export const VM_TITLE_MAX = 'Title must be at most 200 characters';
/** A markdown description exceeded its ceiling. */
export const VM_DESCRIPTION_MAX = 'Description must be at most 20000 characters';
/** A comment body arrived empty (whitespace only counts as empty). */
export const VM_COMMENT_REQUIRED = 'Comment cannot be empty';
/** A comment body exceeded its ceiling. */
export const VM_COMMENT_MAX = 'Comment must be at most 10000 characters';

// ── Query parameters ───────────────────────────────────────────────────────

/** `?page` below 1. */
export const VM_PAGE_MIN = 'Page must be 1 or greater';
/** `?pageSize` below 1. */
export const VM_PAGE_SIZE_MIN = 'Page size must be 1 or greater';
/** `?pageSize` above the hard server ceiling. */
export const VM_PAGE_SIZE_MAX = 'Page size must be at most 100';
/** `?sort` did not match `field:asc|desc`. */
export const VM_SORT_FORMAT = 'Sort must look like field:asc or field:desc';
/** `?sort` named a field this endpoint refuses to sort on. */
export const VM_SORT_FIELD_UNKNOWN = 'That field cannot be sorted on';
/** Search term too short to be worth a trigram scan. */
export const VM_SEARCH_MIN = 'Enter at least 2 characters';
/** Search term above the ceiling. */
export const VM_SEARCH_MAX = 'Search is limited to 120 characters';

// ── Domain rules ───────────────────────────────────────────────────────────

/** Story points outside the accepted estimate range. */
export const VM_STORY_POINTS_RANGE = 'Story points must be between 0 and 1000';
/** A column WIP limit below 1 (use `null` to mean "no limit"). */
export const VM_WIP_LIMIT_MIN = 'A WIP limit must be 1 or greater';
/** A status position below 0. */
export const VM_POSITION_INVALID = 'Position must be 0 or greater';
/** A workflow transition pointing a status at itself. */
export const VM_TRANSITION_SELF = 'A transition cannot start and end on the same status';
/** An invite named a project to grant but no role to grant on it. */
export const VM_PROJECT_ROLE_REQUIRED = 'Choose a project role for the project you selected';
/** A move/rank request named both a before and an after neighbour. */
export const VM_RANK_NEIGHBOURS = 'Provide a before or an after neighbour, not both';
/** Adding an org member named both a user id and an email, or neither. */
export const VM_EXACTLY_ONE_OF_USER_ID_EMAIL = 'Provide exactly one of userId or email';
/** A dependency body named both directions of the edge, or neither. */
export const VM_DEPENDENCY_DIRECTION = 'Provide exactly one of blockerTaskId or blockedTaskId';

// ── Attachments ────────────────────────────────────────────────────────────

/** Presign request without a file name. */
export const VM_FILE_NAME_REQUIRED = 'A file name is required';
/** Presign request without a MIME type. */
export const VM_FILE_TYPE_REQUIRED = 'A file type is required';
/** Presign request for a zero-byte file. */
export const VM_FILE_EMPTY = 'File must not be empty';
/** Presign request above the 25 MB attachment ceiling. */
export const VM_FILE_TOO_LARGE = 'File must be 25 MB or smaller';
/** A confirm body identified the pending upload by neither `attachmentId` nor `s3Key`. */
export const VM_ATTACHMENT_REFERENCE_REQUIRED =
  'Provide the attachmentId or the s3Key returned by presign';

/**
 * Every message above, keyed by its constant name.
 *
 * The web's localization map is typed `Record<ValidationMessage, TranslationKey>`
 * and a unit test asserts it covers this object exhaustively, so adding a
 * message without a translation key fails the build rather than leaking English
 * into an Arabic UI.
 */
export const VALIDATION_MESSAGES = {
  VM_REQUIRED,
  VM_TOO_SHORT,
  VM_TOO_LONG,
  VM_UPDATE_AT_LEAST_ONE_FIELD,
  VM_AT_LEAST_ONE_ITEM,
  VM_UUID_INVALID,
  VM_EMAIL_INVALID,
  VM_URL_INVALID,
  VM_SLUG_FORMAT,
  VM_KEY_FORMAT,
  VM_TASK_KEY_FORMAT,
  VM_HEX_COLOR_INVALID,
  VM_DATE_TIME_INVALID,
  VM_DATE_INVALID,
  VM_DATE_RANGE_INVALID,
  VM_PASSWORD_MIN,
  VM_PASSWORD_MAX,
  VM_TOKEN_REQUIRED,
  VM_NAME_REQUIRED,
  VM_NAME_MAX,
  VM_TITLE_REQUIRED,
  VM_TITLE_MAX,
  VM_DESCRIPTION_MAX,
  VM_COMMENT_REQUIRED,
  VM_COMMENT_MAX,
  VM_PAGE_MIN,
  VM_PAGE_SIZE_MIN,
  VM_PAGE_SIZE_MAX,
  VM_SORT_FORMAT,
  VM_SORT_FIELD_UNKNOWN,
  VM_SEARCH_MIN,
  VM_SEARCH_MAX,
  VM_STORY_POINTS_RANGE,
  VM_WIP_LIMIT_MIN,
  VM_POSITION_INVALID,
  VM_TRANSITION_SELF,
  VM_PROJECT_ROLE_REQUIRED,
  VM_RANK_NEIGHBOURS,
  VM_EXACTLY_ONE_OF_USER_ID_EMAIL,
  VM_DEPENDENCY_DIRECTION,
  VM_FILE_NAME_REQUIRED,
  VM_FILE_TYPE_REQUIRED,
  VM_FILE_EMPTY,
  VM_FILE_TOO_LARGE,
  VM_ATTACHMENT_REFERENCE_REQUIRED,
} as const;

/** The constant NAMES (`'VM_REQUIRED' | …`) — handy for i18n key derivation. */
export type ValidationMessageKey = keyof typeof VALIDATION_MESSAGES;

/** Union of the English message TEXTS — the key type of the web's i18n map. */
export type ValidationMessage = (typeof VALIDATION_MESSAGES)[ValidationMessageKey];
