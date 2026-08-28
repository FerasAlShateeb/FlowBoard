import { VALIDATION_MESSAGES, type ValidationMessage } from '@flowboard/shared';
import type { TFunction } from 'i18next';

import type enValidation from '@/locales/en/validation';

/**
 * Turns `@flowboard/shared`'s English validation text into localized copy.
 *
 * ── The problem this solves ─────────────────────────────────────────────────
 * Every FlowBoard form validates with the SAME zod schema the API validates
 * with — that is the "zod at every boundary, both ends" rule, and it is what
 * makes a contract change a compile error on both sides. But those schemas
 * attach English messages (`VM_EMAIL_INVALID` = "Enter a valid email address"),
 * because that text is the wire contract: it comes back verbatim in a 422's
 * `error.details`. Rendering it would put English on an Arabic screen.
 *
 * A schema cannot carry i18n keys instead — `packages/shared` is runtime-neutral
 * and knows nothing about i18next, and the API needs the English. So the
 * translation happens at the LAST possible moment: `components/ui/form.tsx`'s
 * `FormMessage` runs every message it is about to render through
 * {@link localizeValidationMessage}. One call site, so no form has to remember.
 *
 * ── Why the map is exhaustive by type ───────────────────────────────────────
 * `Record<ValidationMessage, …>` makes a new shared message a COMPILE error
 * until it has a key, and `validation.test.ts` re-asserts it at runtime against
 * `VALIDATION_MESSAGES`. Neither can be satisfied by a stale map.
 */

/**
 * A key of the `validation` namespace. Derived from the ENGLISH catalog, which
 * is the key-shape authority for the whole app (`i18n/i18next.d.ts`), so a
 * renamed entry is a compile error in the map below.
 */
export type ValidationKey = keyof typeof enValidation;

/**
 * Shared message TEXT → catalog key. Keyed by the text (not the constant name)
 * because the text is all a `ZodIssue` carries by the time it reaches a form.
 */
export const VALIDATION_MESSAGE_KEYS: Record<ValidationMessage, ValidationKey> = {
  [VALIDATION_MESSAGES.VM_REQUIRED]: 'required',
  [VALIDATION_MESSAGES.VM_TOO_SHORT]: 'tooShort',
  [VALIDATION_MESSAGES.VM_TOO_LONG]: 'tooLong',
  [VALIDATION_MESSAGES.VM_UPDATE_AT_LEAST_ONE_FIELD]: 'updateAtLeastOneField',
  [VALIDATION_MESSAGES.VM_AT_LEAST_ONE_ITEM]: 'atLeastOneItem',
  [VALIDATION_MESSAGES.VM_UUID_INVALID]: 'uuidInvalid',
  [VALIDATION_MESSAGES.VM_EMAIL_INVALID]: 'emailInvalid',
  [VALIDATION_MESSAGES.VM_URL_INVALID]: 'urlInvalid',
  [VALIDATION_MESSAGES.VM_SLUG_FORMAT]: 'slugFormat',
  [VALIDATION_MESSAGES.VM_KEY_FORMAT]: 'keyFormat',
  [VALIDATION_MESSAGES.VM_TASK_KEY_FORMAT]: 'taskKeyFormat',
  [VALIDATION_MESSAGES.VM_HEX_COLOR_INVALID]: 'hexColorInvalid',
  [VALIDATION_MESSAGES.VM_DATE_TIME_INVALID]: 'dateTimeInvalid',
  [VALIDATION_MESSAGES.VM_DATE_INVALID]: 'dateInvalid',
  [VALIDATION_MESSAGES.VM_DATE_RANGE_INVALID]: 'dateRangeInvalid',
  [VALIDATION_MESSAGES.VM_PASSWORD_MIN]: 'passwordMin',
  [VALIDATION_MESSAGES.VM_PASSWORD_MAX]: 'passwordMax',
  [VALIDATION_MESSAGES.VM_TOKEN_REQUIRED]: 'tokenRequired',
  [VALIDATION_MESSAGES.VM_NAME_REQUIRED]: 'nameRequired',
  [VALIDATION_MESSAGES.VM_NAME_MAX]: 'nameMax',
  [VALIDATION_MESSAGES.VM_TITLE_REQUIRED]: 'titleRequired',
  [VALIDATION_MESSAGES.VM_TITLE_MAX]: 'titleMax',
  [VALIDATION_MESSAGES.VM_DESCRIPTION_MAX]: 'descriptionMax',
  [VALIDATION_MESSAGES.VM_COMMENT_REQUIRED]: 'commentRequired',
  [VALIDATION_MESSAGES.VM_COMMENT_MAX]: 'commentMax',
  [VALIDATION_MESSAGES.VM_PAGE_MIN]: 'pageMin',
  [VALIDATION_MESSAGES.VM_PAGE_SIZE_MIN]: 'pageSizeMin',
  [VALIDATION_MESSAGES.VM_PAGE_SIZE_MAX]: 'pageSizeMax',
  [VALIDATION_MESSAGES.VM_SORT_FORMAT]: 'sortFormat',
  [VALIDATION_MESSAGES.VM_SORT_FIELD_UNKNOWN]: 'sortFieldUnknown',
  [VALIDATION_MESSAGES.VM_SEARCH_MIN]: 'searchMin',
  [VALIDATION_MESSAGES.VM_SEARCH_MAX]: 'searchMax',
  [VALIDATION_MESSAGES.VM_STORY_POINTS_RANGE]: 'storyPointsRange',
  [VALIDATION_MESSAGES.VM_WIP_LIMIT_MIN]: 'wipLimitMin',
  [VALIDATION_MESSAGES.VM_POSITION_INVALID]: 'positionInvalid',
  [VALIDATION_MESSAGES.VM_TRANSITION_SELF]: 'transitionSelf',
  [VALIDATION_MESSAGES.VM_PROJECT_ROLE_REQUIRED]: 'projectRoleRequired',
  [VALIDATION_MESSAGES.VM_RANK_NEIGHBOURS]: 'rankNeighbours',
  [VALIDATION_MESSAGES.VM_EXACTLY_ONE_OF_USER_ID_EMAIL]: 'exactlyOneOfUserIdEmail',
  [VALIDATION_MESSAGES.VM_DEPENDENCY_DIRECTION]: 'dependencyDirection',
  [VALIDATION_MESSAGES.VM_FILE_NAME_REQUIRED]: 'fileNameRequired',
  [VALIDATION_MESSAGES.VM_FILE_TYPE_REQUIRED]: 'fileTypeRequired',
  [VALIDATION_MESSAGES.VM_FILE_EMPTY]: 'fileEmpty',
  [VALIDATION_MESSAGES.VM_FILE_TOO_LARGE]: 'fileTooLarge',
  [VALIDATION_MESSAGES.VM_ATTACHMENT_REFERENCE_REQUIRED]: 'attachmentReferenceRequired',
};

/**
 * Translate one message produced by a shared schema.
 *
 * Anything unmapped is returned UNCHANGED rather than swallowed: a zod built-in
 * that no shared constant covers (a type error on a hand-built schema) is still
 * better shown than replaced by a blank. The exhaustive map plus its test are
 * what keep that path from carrying real product copy.
 */
export function localizeValidationMessage(t: TFunction<'validation'>, message: string): string {
  const key: ValidationKey | undefined = VALIDATION_MESSAGE_KEYS[message as ValidationMessage];
  return key === undefined ? message : t(key);
}
