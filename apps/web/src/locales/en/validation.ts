/**
 * `validation` — the localized twin of `@flowboard/shared`'s validation-message
 * constants.
 *
 * Shared schemas attach ENGLISH text to every check (`VM_EMAIL_INVALID`,
 * `VM_TITLE_MAX`, …) because that text is the wire contract: the API's 422
 * `error.details` payload carries it verbatim. The browser must not show it —
 * an Arabic form with an English error is exactly the leak the i18n checklist
 * audits for.
 *
 * `src/i18n/validation.ts` maps each constant to one key below, and its unit
 * test asserts the map covers `VALIDATION_MESSAGES` exhaustively. So a new
 * shared message without a key here fails the build rather than reaching a user.
 *
 * Keep the copy FIELD-AGNOSTIC. One message is reused by every schema that
 * attaches it, so "Name cannot be empty" belongs here but "Enter your project's
 * name" does not — that is page copy.
 */
export default {
  // Generic
  required: 'This field is required.',
  tooShort: 'This value is too short.',
  tooLong: 'This value is too long.',
  updateAtLeastOneField: 'Change at least one field.',
  atLeastOneItem: 'Select at least one item.',

  // Identifiers & formats
  uuidInvalid: 'That identifier is not valid.',
  emailInvalid: 'Enter a valid email address.',
  urlInvalid: 'Enter a valid URL.',
  slugFormat: 'Use lowercase letters, digits and dashes.',
  keyFormat: 'Use 2–10 characters: a letter, then letters or digits, uppercase.',
  taskKeyFormat: 'A task key looks like PROJ-123.',
  hexColorInvalid: 'Enter a hex color, e.g. #4f46e5.',
  dateTimeInvalid: 'Enter a valid date and time.',
  dateInvalid: 'Enter a date in YYYY-MM-DD form.',
  dateRangeInvalid: 'The end date must be on or after the start date.',

  // Credentials & invites
  passwordMin: 'Passwords are at least 8 characters.',
  passwordMax: 'Passwords are at most 128 characters.',
  tokenRequired: 'An invite token is required.',

  // Names & free text
  nameRequired: 'Enter a name.',
  nameMax: 'Names are at most 120 characters.',
  titleRequired: 'Enter a title.',
  titleMax: 'Titles are at most 200 characters.',
  descriptionMax: 'Descriptions are at most 20,000 characters.',
  commentRequired: 'Write something first.',
  commentMax: 'Comments are at most 10,000 characters.',

  // Query parameters
  pageMin: 'Page must be 1 or greater.',
  pageSizeMin: 'Page size must be 1 or greater.',
  pageSizeMax: 'Page size is at most 100.',
  sortFormat: 'Sort must look like field:asc or field:desc.',
  sortFieldUnknown: 'That field cannot be sorted on.',
  searchMin: 'Enter at least 2 characters.',
  searchMax: 'Search is limited to 120 characters.',

  // Domain rules
  storyPointsRange: 'Story points must be between 0 and 1000.',
  wipLimitMin: 'A WIP limit must be 1 or greater.',
  positionInvalid: 'Position must be 0 or greater.',
  transitionSelf: 'A transition cannot start and end on the same status.',
  projectRoleRequired: 'Choose a project role for the project you selected.',
  rankNeighbours: 'Provide a before or an after neighbour, not both.',
  exactlyOneOfUserIdEmail: 'Provide either a person or an email address, not both.',
  dependencyDirection: 'Choose one direction: blocked by, or blocking.',

  // Attachments
  fileNameRequired: 'A file name is required.',
  fileTypeRequired: 'A file type is required.',
  fileEmpty: 'That file is empty.',
  fileTooLarge: 'Files must be 25 MB or smaller.',
  attachmentReferenceRequired: 'That upload could not be matched — try again.',
} as const;
