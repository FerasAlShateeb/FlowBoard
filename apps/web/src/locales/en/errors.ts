/**
 * `errors` — the localized twin of the API's envelope `error.code`.
 *
 * Every key here is an API error code, LOWER-CASED (the API spells them
 * `SCREAMING_SNAKE`; `i18n/errors.ts` normalizes once on the way in). A code
 * with no entry falls back to the server's own English message rather than to a
 * blank — see that module for the full ladder — so this catalog is expected to
 * grow wave by wave rather than to be complete on day one.
 *
 * COPY RULE: say what happened and, where there is one, what to do about it.
 * These strings are read in a toast, three seconds after an action failed —
 * "You do not have permission to change this project's workflow" is useful,
 * "Forbidden" is not.
 */
export default {
  // ── Transport / generic ───────────────────────────────────────────────────
  unknown: 'Something went wrong. Please try again.',
  network_error: 'Could not reach the server. Check your connection and try again.',
  internal_error: 'The server hit an unexpected error. Please try again.',
  validation_error: 'Some fields need attention.',
  rate_limited: 'Too many attempts. Wait a moment and try again.',

  // ── Session ───────────────────────────────────────────────────────────────
  unauthorized: 'Please sign in to continue.',
  token_expired: 'Your session expired. Please sign in again.',
  token_invalid: 'Your session is no longer valid. Please sign in again.',
  invalid_credentials: 'That email and password do not match.',
  account_disabled: 'This account has been deactivated. Contact an administrator.',
  forbidden: 'You do not have permission to do that.',

  // ── Not found ─────────────────────────────────────────────────────────────
  not_found: 'That item no longer exists.',
  user_not_found: 'That user no longer exists.',
  org_not_found: 'That organization no longer exists.',
  team_not_found: 'That team no longer exists.',
  project_not_found: 'That project no longer exists.',
  task_not_found: 'That task no longer exists.',
  status_not_found: 'That status no longer exists.',
  sprint_not_found: 'That sprint no longer exists.',
  comment_not_found: 'That comment no longer exists.',
  attachment_not_found: 'That attachment no longer exists.',
  invite_not_found: 'That invitation link is not valid.',

  // ── Conflicts ─────────────────────────────────────────────────────────────
  conflict: 'Someone else changed this first. Refresh and try again.',
  email_taken: 'An account with that email already exists.',
  slug_taken: 'That address is already in use. Pick another.',
  project_key_taken: 'That key is already used by another project in this organization.',
  label_name_taken: 'A label with that name already exists in this project.',
  already_member: 'That person is already a member.',

  // ── Invites ───────────────────────────────────────────────────────────────
  invite_expired: 'This invitation has expired. Ask for a new link.',
  invite_already_accepted: 'This invitation has already been used.',
  invite_email_mismatch: 'This invitation was issued to a different email address.',

  // ── Workflow & board rules ────────────────────────────────────────────────
  transition_not_allowed: 'This project’s workflow does not allow that move.',
  wip_limit_exceeded: 'That column is at its WIP limit.',
  status_in_use: 'Move or delete that column’s tasks before removing it.',
  last_status: 'A project needs at least one status.',

  // ── Task domain ───────────────────────────────────────────────────────────
  dependency_cycle: 'That would create a circular dependency.',
  dependency_exists: 'That dependency is already recorded.',
  self_dependency: 'A task cannot block itself.',
  sprint_already_active: 'Another sprint is already running. Complete it first.',
  sprint_not_active: 'That sprint is not running.',

  // ── Attachments ───────────────────────────────────────────────────────────
  file_too_large: 'That file is larger than the 25 MB limit.',
  upload_failed: 'The upload did not finish. Try again.',
  storage_unavailable: 'File storage is unavailable right now. Try again shortly.',
} as const;
