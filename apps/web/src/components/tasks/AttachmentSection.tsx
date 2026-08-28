import { useEffect, useReducer, useRef, useState, type DragEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Download, FileText, ImageIcon, Loader2, Paperclip, Trash2, Upload, X } from 'lucide-react';
import { MAX_ATTACHMENT_BYTES, type Attachment } from '@flowboard/shared';

import { cn } from '@/lib/utils';
import { useLang } from '@/lib/lang-policy';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { formatRelativeTime } from '@/components/tasks/task-dates';
import {
  formatFileSize,
  initialUploadState,
  uploadReducer,
  type UploadItem,
} from '@/components/tasks/upload-state';

/**
 * Attachments: a dropzone, per-file progress, and the list of what is already
 * there.
 *
 * ── The upload is three steps and the bytes skip the API ────────────────────
 *
 * `presign` → PUT straight to MinIO (XHR, for the progress events `fetch` still
 * cannot give) → `confirm`. `useUploadAttachment` owns that sequence; this
 * component owns only what the user SEES while it runs, and that state lives in
 * `upload-state.ts` as a pure reducer so its awkward cases — a progress event
 * arriving after a dismiss, two files finishing out of order, one failure among
 * four successes — are testable without mocking XHR inside a rendered tree.
 *
 * ── Thumbnails are lazy and minted per row ──────────────────────────────────
 *
 * A download URL is a short-lived presigned GET, so it cannot be cached under a
 * query key (the second click would hand the user a dead link — which is why
 * `useAttachmentUrl` is a MUTATION). Image rows therefore mint one on mount, and
 * only image rows do: a task with twenty PDFs must not fire twenty signing
 * requests for previews nobody can see.
 */

export interface AttachmentSectionProps {
  attachments: readonly Attachment[];
  /** The signed-in user — an uploader may delete their own file. */
  currentUserId: string | null;
  /** Project admins may delete anyone's. */
  canModerate: boolean;
  canEdit: boolean;
  isPending: boolean;
  /**
   * Runs the presign → PUT → confirm sequence for one file, reporting progress.
   * Resolves `true` on success. Supplied by the panel so this component never
   * touches a hook and stays renderable in isolation.
   */
  onUpload: (file: File, onProgress: (percent: number) => void) => Promise<boolean>;
  onDelete: (attachmentId: string) => void;
  /** Mints a fresh presigned GET. Used for both downloads and thumbnails. */
  onResolveUrl: (attachmentId: string) => Promise<string | null>;
}

export function AttachmentSection({
  attachments,
  currentUserId,
  canModerate,
  canEdit,
  isPending,
  onUpload,
  onDelete,
  onResolveUrl,
}: AttachmentSectionProps) {
  const { t } = useTranslation(['tasks', 'common']);
  const [uploads, dispatch] = useReducer(uploadReducer, initialUploadState);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  /** Monotonic client ids — a File has no identity a reducer can key on. */
  const nextId = useRef(0);

  const startUploads = (files: FileList | null) => {
    if (!files || !canEdit) return;

    for (const file of Array.from(files)) {
      nextId.current += 1;
      const id = `upload-${String(nextId.current)}`;
      dispatch({ type: 'start', id, fileName: file.name, sizeBytes: file.size });

      void onUpload(file, (percent) => {
        dispatch({ type: 'progress', id, percent });
      }).then(
        (ok) => {
          dispatch(ok ? { type: 'succeed', id } : { type: 'fail', id });
          // A finished row is redundant the moment the real list refetches, so
          // it clears itself; a FAILED one stays until it is dismissed.
          if (ok)
            setTimeout(() => {
              dispatch({ type: 'dismiss', id });
            }, 1200);
        },
        () => {
          dispatch({ type: 'fail', id });
        },
      );
    }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    setDragging(false);
    startUploads(event.dataTransfer.files);
  };

  return (
    <section aria-label={t('tasks:attachments.heading')} className="flex flex-col gap-2">
      <h3 className="text-xs font-medium text-muted-foreground">
        {t('tasks:attachments.heading')}
      </h3>

      {canEdit ? (
        <div
          // A dropzone is a drop TARGET, not a control: the keyboard path is the
          // real `<button>` inside it, which opens the file picker.
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => {
            setDragging(false);
          }}
          onDrop={onDrop}
          data-dragging={dragging || undefined}
          className={cn(
            'flex flex-col items-center gap-1 rounded-[var(--radius)] border border-dashed border-border px-3 py-4 text-center transition-colors duration-[var(--speed)]',
            'data-[dragging]:border-ring data-[dragging]:bg-accent data-[dragging]:ring-2 data-[dragging]:ring-ring/40',
          )}
        >
          <Upload className="size-4 text-muted-foreground" aria-hidden />
          <p className="text-xs text-muted-foreground">
            {dragging ? (
              t('tasks:attachments.dropActive')
            ) : (
              <>
                {t('tasks:attachments.drop')}{' '}
                <button
                  type="button"
                  className="text-primary underline underline-offset-2"
                  onClick={() => {
                    inputRef.current?.click();
                  }}
                >
                  {t('tasks:attachments.browse')}
                </button>
              </>
            )}
          </p>
          <p className="text-[11px] text-muted-foreground">
            {t('tasks:attachments.maxSize', { size: formatFileSize(MAX_ATTACHMENT_BYTES) })}
          </p>
          <input
            ref={inputRef}
            type="file"
            multiple
            className="sr-only"
            // Its OWN name, not the section's: two things called "Attachments"
            // are indistinguishable to anyone navigating by label.
            aria-label={t('tasks:attachments.choose')}
            onChange={(event) => {
              startUploads(event.target.files);
              // Reset, so re-picking the SAME file fires `change` again.
              event.target.value = '';
            }}
          />
        </div>
      ) : null}

      {uploads.length > 0 ? (
        <ul className="flex flex-col gap-1">
          {uploads.map((upload) => (
            <li key={upload.id}>
              <UploadRow
                upload={upload}
                onDismiss={() => {
                  dispatch({ type: 'dismiss', id: upload.id });
                }}
              />
            </li>
          ))}
        </ul>
      ) : null}

      {isPending ? (
        <p className="text-xs text-muted-foreground">{t('common:states.loading')}</p>
      ) : attachments.length === 0 && uploads.length === 0 ? (
        <p className="text-xs text-muted-foreground">{t('tasks:attachments.empty')}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {attachments.map((attachment) => (
            <li key={attachment.id}>
              <AttachmentRow
                attachment={attachment}
                canDelete={attachment.uploadedBy.id === currentUserId || canModerate}
                onDelete={onDelete}
                onResolveUrl={onResolveUrl}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** One in-flight (or just-failed) upload. */
function UploadRow({ upload, onDismiss }: { upload: UploadItem; onDismiss: () => void }) {
  const { t } = useTranslation(['tasks', 'common']);
  const failed = upload.status === 'error';

  return (
    <div className="flex items-center gap-2 rounded-[var(--radius)] border border-border bg-surface-raised px-2 py-1.5">
      {failed ? (
        <X className="size-3.5 text-danger" aria-hidden />
      ) : (
        <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-hidden />
      )}

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        {/* A file name is user content — see `UserChip` in `UserAvatar`. */}
        <span dir="auto" className="truncate text-xs">
          {upload.fileName}
        </span>
        <div
          role="progressbar"
          aria-valuenow={upload.progress}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label={upload.fileName}
          className="h-1 w-full overflow-hidden rounded-full bg-secondary"
        >
          <div
            className={cn('h-full rounded-full', failed ? 'bg-danger' : 'bg-primary')}
            style={{ inlineSize: `${String(upload.progress)}%` }}
          />
        </div>
      </div>

      <span className="shrink-0 text-[11px] text-muted-foreground tabular-nums">
        {failed ? t('tasks:attachments.failed') : `${String(upload.progress)}%`}
      </span>

      {failed ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={t('tasks:attachments.dismiss')}
          onClick={onDismiss}
        >
          <X aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}

/** True for a mime type that can be shown as a picture. */
function isImage(mimeType: string): boolean {
  return mimeType.startsWith('image/');
}

/** One stored attachment. */
function AttachmentRow({
  attachment,
  canDelete,
  onDelete,
  onResolveUrl,
}: {
  attachment: Attachment;
  canDelete: boolean;
  onDelete: (attachmentId: string) => void;
  onResolveUrl: (attachmentId: string) => Promise<string | null>;
}) {
  const { t } = useTranslation(['tasks', 'common']);
  const lang = useLang();
  const [thumbnail, setThumbnail] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  const image = isImage(attachment.mimeType);

  // Only images mint a URL up front, and only once. Everything else waits for a
  // click, because a signing request per non-previewable row is pure latency.
  useEffect(() => {
    if (!image) return;
    let cancelled = false;
    void onResolveUrl(attachment.id).then((url) => {
      if (!cancelled) setThumbnail(url);
    });
    return () => {
      cancelled = true;
    };
  }, [image, attachment.id, onResolveUrl]);

  const download = () => {
    void onResolveUrl(attachment.id).then((url) => {
      if (url !== null) window.open(url, '_blank', 'noopener,noreferrer');
    });
  };

  return (
    <div className="flex items-center gap-2 rounded-[var(--radius)] border border-border px-2 py-1.5">
      {image && thumbnail !== null ? (
        <img
          src={thumbnail}
          alt=""
          loading="lazy"
          className="size-8 shrink-0 rounded-[calc(var(--radius)-2px)] border border-border object-cover"
        />
      ) : (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-[calc(var(--radius)-2px)] border border-border bg-surface-raised text-muted-foreground">
          {image ? (
            <ImageIcon className="size-3.5" aria-hidden />
          ) : attachment.mimeType.startsWith('text/') ||
            attachment.mimeType === 'application/pdf' ? (
            <FileText className="size-3.5" aria-hidden />
          ) : (
            <Paperclip className="size-3.5" aria-hidden />
          )}
        </span>
      )}

      <div className="flex min-w-0 flex-1 flex-col leading-tight">
        {/* A file name is user content — see `UserChip` in `UserAvatar`. */}
        <span dir="auto" className="truncate text-xs text-foreground">
          {attachment.fileName}
        </span>
        <span className="truncate text-[11px] text-muted-foreground">
          {formatFileSize(attachment.sizeBytes)} ·{' '}
          {t('tasks:attachments.uploadedBy', { name: attachment.uploadedBy.name })} ·{' '}
          {formatRelativeTime(attachment.createdAt, lang)}
        </span>
      </div>

      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        aria-label={`${t('tasks:attachments.download')} ${attachment.fileName}`}
        onClick={download}
      >
        <Download aria-hidden />
      </Button>

      {canDelete ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label={`${t('tasks:attachments.remove')} ${attachment.fileName}`}
          onClick={() => {
            setConfirming(true);
          }}
        >
          <Trash2 aria-hidden />
        </Button>
      ) : null}

      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={t('tasks:attachments.removeTitle', { name: attachment.fileName })}
        description={t('tasks:attachments.removeBody')}
        confirmLabel={t('common:actions.delete')}
        onConfirm={() => {
          onDelete(attachment.id);
          setConfirming(false);
        }}
      />
    </div>
  );
}

export default AttachmentSection;
