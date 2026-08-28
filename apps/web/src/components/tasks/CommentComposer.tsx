import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { MentionTextarea } from '@/components/tasks/MentionTextarea';

/**
 * The comment box.
 *
 * ── The draft is NOT lifted into the thread ─────────────────────────────────
 *
 * Keeping it here means a re-render of the thread above — which happens on every
 * poll, socket push and cache write — cannot disturb what is being typed. The
 * only thing that clears it is a SUCCESSFUL submit: a failed one keeps the text
 * exactly where it was, because losing a written paragraph to a network blip is
 * the single worst thing a comment box can do.
 *
 * ── Mentions ────────────────────────────────────────────────────────────────
 *
 * Nothing here sends a recipient list. The body carries `@[Name](userId)` inline
 * and the SERVER derives the notification targets from what it stored, so
 * editing a mention out of a comment stops the notification, and a hand-crafted
 * request cannot notify someone the text never named.
 */
export function CommentComposer({
  orgId,
  isPending,
  onSubmit,
  autoFocus = false,
}: {
  orgId: string | null | undefined;
  isPending: boolean;
  /** Resolves `true` when the comment was created — that is what clears the box. */
  onSubmit: (body: string) => Promise<boolean>;
  autoFocus?: boolean;
}) {
  const { t } = useTranslation(['tasks', 'common']);
  const [body, setBody] = useState('');

  const submit = () => {
    const trimmed = body.trim();
    if (trimmed === '' || isPending) return;
    void onSubmit(trimmed).then((created) => {
      if (created) setBody('');
    });
  };

  return (
    <div className="flex flex-col gap-2">
      <MentionTextarea
        orgId={orgId}
        value={body}
        onChange={setBody}
        onSubmit={submit}
        autoFocus={autoFocus}
        rows={3}
        placeholder={t('tasks:comments.placeholder')}
        ariaLabel={t('tasks:comments.heading')}
      />
      <div className="flex justify-end">
        <Button type="button" size="sm" disabled={isPending || body.trim() === ''} onClick={submit}>
          {isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
          {t('tasks:comments.submit')}
        </Button>
      </div>
    </div>
  );
}

export default CommentComposer;
