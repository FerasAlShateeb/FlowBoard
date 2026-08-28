import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Loader2, Pencil, Trash2 } from 'lucide-react';
import type { Comment } from '@flowboard/shared';

import { useLang } from '@/lib/lang-policy';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { UserAvatar } from '@/components/common/UserAvatar';
import { Markdown } from '@/components/tasks/Markdown';
import { MentionTextarea } from '@/components/tasks/MentionTextarea';
import { formatDateTime, formatRelativeTime } from '@/components/tasks/task-dates';

/**
 * The comment thread — oldest first, as a conversation reads.
 *
 * ── Who may edit what ───────────────────────────────────────────────────────
 *
 * Editing is AUTHOR-ONLY (a comment is a person's words, and rewriting someone
 * else's is not a permission a project admin should have). Deleting is the
 * author OR a project admin, because moderation is a real need and an admin is
 * who a team escalates to. Both are re-checked server-side; the chrome here just
 * hides controls that would fail.
 *
 * ── `editedAt`, not a timestamp comparison ──────────────────────────────────
 *
 * The "(edited)" marker keys off `editedAt !== null`. Comparing `updatedAt` to
 * `createdAt` would mark almost every comment as edited — the two differ by
 * microseconds on insert.
 */

export interface CommentThreadProps {
  comments: readonly Comment[];
  orgId: string | null | undefined;
  /** The signed-in user, for the author check. */
  currentUserId: string | null;
  /** Project admins may delete anyone's comment. */
  canModerate: boolean;
  isPending: boolean;
  isSaving: boolean;
  onUpdate: (commentId: string, body: string) => void;
  onDelete: (commentId: string) => void;
}

export function CommentThread({
  comments,
  orgId,
  currentUserId,
  canModerate,
  isPending,
  isSaving,
  onUpdate,
  onDelete,
}: CommentThreadProps) {
  const { t } = useTranslation(['tasks', 'common']);

  if (isPending) {
    return (
      <div className="flex flex-col gap-3" aria-busy>
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  if (comments.length === 0) {
    return <p className="py-4 text-xs text-muted-foreground">{t('tasks:comments.empty')}</p>;
  }

  return (
    <ul className="flex flex-col gap-4">
      {comments.map((comment) => (
        <li key={comment.id}>
          <CommentRow
            comment={comment}
            orgId={orgId}
            canEdit={comment.author.id === currentUserId}
            canDelete={comment.author.id === currentUserId || canModerate}
            isSaving={isSaving}
            onUpdate={onUpdate}
            onDelete={onDelete}
          />
        </li>
      ))}
    </ul>
  );
}

function CommentRow({
  comment,
  orgId,
  canEdit,
  canDelete,
  isSaving,
  onUpdate,
  onDelete,
}: {
  comment: Comment;
  orgId: string | null | undefined;
  canEdit: boolean;
  canDelete: boolean;
  isSaving: boolean;
  onUpdate: (commentId: string, body: string) => void;
  onDelete: (commentId: string) => void;
}) {
  const { t } = useTranslation(['tasks', 'common']);
  const lang = useLang();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(comment.body);
  const [confirming, setConfirming] = useState(false);

  const save = () => {
    const trimmed = draft.trim();
    if (trimmed === '' || trimmed === comment.body) {
      setEditing(false);
      return;
    }
    onUpdate(comment.id, trimmed);
    setEditing(false);
  };

  return (
    <article className="flex gap-2.5">
      <UserAvatar user={comment.author} size="sm" label="" className="mt-0.5" />

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="text-xs font-medium text-foreground">{comment.author.name}</span>
          {/* The absolute instant lives in `title`, so hovering a relative time
              answers "when exactly?" without spending a line on it. */}
          <time
            dateTime={comment.createdAt}
            title={formatDateTime(comment.createdAt, lang)}
            className="text-[11px] text-muted-foreground"
          >
            {formatRelativeTime(comment.createdAt, lang)}
          </time>
          {comment.editedAt === null ? null : (
            <span className="text-[11px] text-muted-foreground">
              ({t('tasks:comments.edited')})
            </span>
          )}

          <span className="ms-auto flex items-center gap-0.5">
            {canEdit && !editing ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t('tasks:comments.editLabel')}
                onClick={() => {
                  setDraft(comment.body);
                  setEditing(true);
                }}
              >
                <Pencil aria-hidden />
              </Button>
            ) : null}
            {canDelete ? (
              <Button
                type="button"
                variant="ghost"
                size="icon-xs"
                aria-label={t('tasks:comments.deleteLabel')}
                onClick={() => {
                  setConfirming(true);
                }}
              >
                <Trash2 aria-hidden />
              </Button>
            ) : null}
          </span>
        </div>

        {editing ? (
          <div className="flex flex-col gap-2">
            <MentionTextarea
              orgId={orgId}
              value={draft}
              onChange={setDraft}
              onSubmit={save}
              onCancel={() => {
                setEditing(false);
              }}
              autoFocus
              rows={3}
              ariaLabel={t('tasks:comments.editLabel')}
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
          </div>
        ) : (
          <Markdown source={comment.body} className="text-xs" />
        )}
      </div>

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('tasks:comments.deleteTitle')}
        description={t('tasks:comments.deleteBody')}
        confirmLabel={t('common:actions.delete')}
        onConfirm={() => {
          onDelete(comment.id);
          setConfirming(false);
        }}
      />
    </article>
  );
}

export default CommentThread;
