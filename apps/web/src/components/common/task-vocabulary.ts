import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { TaskPriority, TaskType } from '@flowboard/shared';

/**
 * The five issue types and the five priorities, as WORDS — one accessor for the
 * whole app.
 *
 * ═══ WHY A HOOK AND NOT A TEMPLATE LITERAL AT THE CALL SITE ════════════════
 *
 * Before WP3.8 twelve call sites across four views composed their own key —
 * `` t(`board:types.${task.type}`) ``, `` t(`table:priorities.${p}`) ``,
 * `` t(`tasks:type.${type}`) `` — against four duplicate catalog subtrees. A
 * template literal is only as typed as its inference: delete or rename the
 * catalog subtree and TypeScript stays silent while the UI renders the literal
 * string `board:types.bug` to a user.
 *
 * The maps below are LITERAL, so every key is checked against
 * `locales/en/common.ts` at compile time. That is the pattern WP3.3's
 * `TaskTypeIcon` already used deliberately, generalised to one place.
 *
 * ═══ TWO SHAPES PER FIELD ═════════════════════════════════════════════════
 *
 *   - `typeName` / `priorityName` — the bare word, for a menu row, a filter
 *     chip, a CSV cell: somewhere the surrounding text already says what the
 *     word is about.
 *   - `typeAria` / `priorityAria` — the whole sentence, for a BARE GLYPH. A
 *     lone chevron announced as "Highest" tells a screen-reader user nothing;
 *     "Priority: Highest" is the sentence they need.
 */

const TYPE_KEYS = {
  epic: 'common:taskType.epic',
  story: 'common:taskType.story',
  task: 'common:taskType.task',
  bug: 'common:taskType.bug',
  subtask: 'common:taskType.subtask',
} as const satisfies Record<TaskType, string>;

const PRIORITY_KEYS = {
  lowest: 'common:priority.lowest',
  low: 'common:priority.low',
  medium: 'common:priority.medium',
  high: 'common:priority.high',
  highest: 'common:priority.highest',
} as const satisfies Record<TaskPriority, string>;

export interface TaskVocabulary {
  /** "Bug". */
  typeName: (type: TaskType) => string;
  /** "Highest". */
  priorityName: (priority: TaskPriority) => string;
  /** "Type: Bug" — the accessible name of a bare type glyph. */
  typeAria: (type: TaskType) => string;
  /** "Priority: Highest" — the accessible name of a bare priority glyph. */
  priorityAria: (priority: TaskPriority) => string;
}

export function useTaskVocabulary(): TaskVocabulary {
  const { t } = useTranslation(['common']);

  return useMemo(
    () => ({
      typeName: (type) => t(TYPE_KEYS[type]),
      priorityName: (priority) => t(PRIORITY_KEYS[priority]),
      typeAria: (type) => t('common:taskTypeLabel', { type: t(TYPE_KEYS[type]) }),
      priorityAria: (priority) =>
        t('common:priorityLabel', { priority: t(PRIORITY_KEYS[priority]) }),
    }),
    [t],
  );
}
