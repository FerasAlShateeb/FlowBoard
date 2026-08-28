import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Pencil } from 'lucide-react';
import type { Task } from '@flowboard/shared';

import { Button } from '@/components/ui/button';
import { Markdown } from '@/components/tasks/Markdown';
import { MentionTextarea } from '@/components/tasks/MentionTextarea';

/**
 * The task description: rendered markdown, click to edit.
 *
 * ── Why click-to-edit rather than a permanent editor ────────────────────────
 *
 * A description is read far more often than it is written — the sheet opens to
 * answer "what is this?", not "let me rewrite this". A permanently mounted
 * textarea would show raw `@[Ada](uuid)` encodings and unrendered markdown to
 * everyone who ever opened the panel, which is precisely the audience that
 * wants the formatted version.
 *
 * ── The draft is local, and resets on the TASK ──────────────────────────────
 *
 * `draft` is seeded from the task when editing starts, and the effect below
 * discards it when the sheet navigates to a DIFFERENT task (keyed on `taskId`,
 * not on `description`). Keying it on the description instead would wipe a
 * half-written edit the moment a colleague's socket update landed — the exact
 * moment the user most needs their draft kept.
 *
 * Saving sends `null` for an emptied body rather than `''`: the contract's
 * `taskDescriptionSchema` is `string | null`, and "no description" is a null,
 * not an empty string that every consumer then has to test for separately.
 */
export function TaskDescription({
  taskId,
  description,
  orgId,
  canEdit,
  isSaving,
  onSave,
}: {
  /** Identity of the task being shown — the draft reset key. */
  taskId: string;
  description: Task['description'];
  orgId: string | null | undefined;
  canEdit: boolean;
  isSaving: boolean;
  onSave: (next: string | null) => void;
}) {
  const { t } = useTranslation(['tasks', 'common']);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  // A different task means a different description; anything in the editor
  // belonged to the previous one.
  useEffect(() => {
    setEditing(false);
    setDraft('');
  }, [taskId]);

  const startEditing = () => {
    setDraft(description ?? '');
    setEditing(true);
  };

  const save = () => {
    const trimmed = draft.trim();
    onSave(trimmed === '' ? null : trimmed);
    setEditing(false);
  };

  if (editing) {
    return (
      <section aria-label={t('tasks:description.heading')} className="flex flex-col gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">
          {t('tasks:description.heading')}
        </h3>

        <MentionTextarea
          orgId={orgId}
          value={draft}
          onChange={setDraft}
          onSubmit={save}
          onCancel={() => {
            setEditing(false);
          }}
          autoFocus
          rows={8}
          placeholder={t('tasks:description.placeholder')}
          ariaLabel={t('tasks:description.heading')}
        />

        <div className="flex items-center gap-2">
          <Button type="button" size="sm" disabled={isSaving} onClick={save}>
            {isSaving ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {t('common:actions.save')}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditing(false);
            }}
          >
            {t('common:actions.cancel')}
          </Button>
        </div>
      </section>
    );
  }

  return (
    <section aria-label={t('tasks:description.heading')} className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-medium text-muted-foreground">
          {t('tasks:description.heading')}
        </h3>
        {canEdit ? (
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={t('tasks:description.edit')}
            onClick={startEditing}
          >
            <Pencil aria-hidden />
          </Button>
        ) : null}
      </div>

      {description === null || description.trim() === '' ? (
        <button
          type="button"
          // A non-editor sees the same sentence without a control around it:
          // `disabled` keeps it out of the tab order and off the pointer.
          disabled={!canEdit}
          onClick={startEditing}
          className="rounded-[var(--radius)] border border-dashed border-border px-3 py-4 text-start text-xs text-muted-foreground transition-colors duration-[var(--speed)] enabled:hover:border-ring enabled:hover:text-foreground"
        >
          {canEdit ? t('tasks:description.add') : t('tasks:description.empty')}
        </button>
      ) : (
        <Markdown source={description} />
      )}
    </section>
  );
}

export default TaskDescription;
