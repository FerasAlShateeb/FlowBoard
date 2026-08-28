/**
 * Task attachments — metadata only. The bytes never touch this process.
 *
 * THE THREE-STEP FLOW (attachments.schema.ts, normative):
 *   1. `POST …/attachments/presign` writes an UNCONFIRMED row and hands back a
 *      short-lived PUT url;
 *   2. the browser uploads straight to MinIO;
 *   3. `POST …/attachments` confirms the key, which stamps `confirmed_at`.
 *
 * The row is written at step 1 rather than step 3 so the server, not the
 * client, owns the `s3_key` — the random uuid segment in it is exactly what
 * stops a caller confirming somebody else's object or overwriting an existing
 * one by re-uploading the same file name. `confirmed_at IS NULL` therefore
 * means "presigned but never uploaded": invisible to every read here, and what
 * a future sweeper reaps.
 */
import { randomUUID } from 'node:crypto';
import { and, asc, eq, isNull, isNotNull } from 'drizzle-orm';
import type { Attachment, AttachmentUrl, PresignAttachmentInput } from '@flowboard/shared';

import { attachments, db, projects, tasks, users, withTx, type Db, type Tx } from '../db';
import { ApiError } from '../utils/api-error';
import { PRESIGN_TTL_SECONDS, presignDownload, presignUpload } from '../utils/s3';
import { recordActivity } from './activity.service';
import {
  publishTaskUpdated,
  requireTaskRow,
  toIsoDateTime,
  type ProjectScope,
  type TaskActor,
} from './tasks.service';
import type { ProjectRole } from '../middlewares/require-roles';

type Executor = Db | Tx;

/**
 * Step 1's response. A superset of the shared
 * `presignAttachmentResponseSchema`: `attachmentId` is added so a client can
 * confirm by row id instead of echoing the key back (both are accepted).
 */
export interface PresignResult {
  uploadUrl: string;
  s3Key: string;
  expiresAt: string;
  attachmentId: string;
}

/** What a caller may send to confirm an upload. Either identifier works. */
export interface ConfirmAttachmentParams {
  attachmentId?: string | undefined;
  s3Key?: string | undefined;
  fileName?: string | undefined;
  mimeType?: string | undefined;
  sizeBytes?: number | undefined;
}

const UNKNOWN_UPLOADER = {
  id: '00000000-0000-4000-8000-000000000000',
  name: 'Unknown user',
  avatarUrl: null,
} as const;

/**
 * Reduce a user-supplied file name to something safe inside an object key.
 *
 * The original name is still stored verbatim on the row (and is what a download
 * is renamed to); this only governs the key, where a slash would silently
 * create a directory level and a control character would poison the signature.
 */
export function sanitizeKeySegment(fileName: string): string {
  const cleaned = fileName
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/gu, '_')
    .replace(/^[._]+/u, '')
    .slice(0, 120);
  return cleaned.length > 0 ? cleaned : 'file';
}

/** `{orgId}/{projectId}/{taskId}/{uuid}-{name}` — server-generated, always. */
export function buildAttachmentKey(scope: ProjectScope, taskId: string, fileName: string): string {
  return `${scope.orgId}/${scope.projectId}/${taskId}/${randomUUID()}-${sanitizeKeySegment(fileName)}`;
}

const attachmentSelection = {
  id: attachments.id,
  taskId: attachments.taskId,
  fileName: attachments.fileName,
  mimeType: attachments.mimeType,
  sizeBytes: attachments.sizeBytes,
  s3Key: attachments.s3Key,
  createdAt: attachments.createdAt,
  uploaderId: users.id,
  uploaderName: users.name,
  uploaderAvatarUrl: users.avatarUrl,
};

function toAttachment(row: {
  id: string;
  taskId: string;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  s3Key: string;
  createdAt: Date;
  uploaderId: string | null;
  uploaderName: string | null;
  uploaderAvatarUrl: string | null;
}): Attachment {
  return {
    id: row.id,
    taskId: row.taskId,
    fileName: row.fileName,
    mimeType: row.mimeType,
    sizeBytes: row.sizeBytes,
    s3Key: row.s3Key,
    uploadedBy:
      row.uploaderId === null || row.uploaderName === null
        ? { ...UNKNOWN_UPLOADER }
        : { id: row.uploaderId, name: row.uploaderName, avatarUrl: row.uploaderAvatarUrl },
    createdAt: toIsoDateTime(row.createdAt),
  };
}

/** The attachment's owning task and project — the route carries only its id. */
export async function requireAttachmentContext(
  executor: Executor,
  attachmentId: string,
): Promise<{
  id: string;
  taskId: string;
  projectId: string;
  uploadedById: string | null;
  s3Key: string;
  fileName: string;
}> {
  const [row] = await executor
    .select({
      id: attachments.id,
      taskId: attachments.taskId,
      projectId: tasks.projectId,
      uploadedById: attachments.uploadedById,
      s3Key: attachments.s3Key,
      fileName: attachments.fileName,
    })
    .from(attachments)
    .innerJoin(tasks, eq(attachments.taskId, tasks.id))
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(
      and(
        eq(attachments.id, attachmentId),
        isNull(attachments.deletedAt),
        isNull(tasks.deletedAt),
        isNull(projects.deletedAt),
      ),
    )
    .limit(1);
  if (!row) throw ApiError.notFound('Attachment not found');
  return row;
}

function expiryIso(): string {
  return new Date(Date.now() + PRESIGN_TTL_SECONDS * 1000).toISOString();
}

/** Step 1 — reserve the key and hand back a presigned PUT. */
export async function presignAttachment(
  scope: ProjectScope,
  actor: TaskActor,
  taskId: string,
  input: PresignAttachmentInput,
): Promise<PresignResult> {
  await requireTaskRow(db, taskId);
  const s3Key = buildAttachmentKey(scope, taskId, input.fileName);

  const [row] = await db
    .insert(attachments)
    .values({
      taskId,
      uploadedById: actor.userId,
      fileName: input.fileName,
      mimeType: input.mimeType,
      sizeBytes: input.sizeBytes,
      s3Key,
      confirmedAt: null,
    })
    .returning({ id: attachments.id });
  if (!row) throw ApiError.internal('Attachment insert returned no row');

  // Signing is local arithmetic over the credentials — no network call, so a
  // presign works (and is testable) without MinIO being reachable.
  const uploadUrl = await presignUpload(s3Key, input.mimeType, input.sizeBytes);
  return { uploadUrl, s3Key, expiresAt: expiryIso(), attachmentId: row.id };
}

/** Step 3 — the upload happened; stamp `confirmed_at` and make the row visible. */
export async function confirmAttachment(
  scope: ProjectScope,
  actor: TaskActor,
  taskId: string,
  params: ConfirmAttachmentParams,
): Promise<Attachment> {
  if (params.attachmentId === undefined && params.s3Key === undefined) {
    throw ApiError.badRequest('Provide the attachmentId or the s3Key returned by presign');
  }

  const attachmentId = await withTx(async (tx) => {
    await requireTaskRow(tx, taskId);
    const [pending] = await tx
      .select({ id: attachments.id, confirmedAt: attachments.confirmedAt })
      .from(attachments)
      .where(
        and(
          eq(attachments.taskId, taskId),
          isNull(attachments.deletedAt),
          params.attachmentId === undefined
            ? eq(attachments.s3Key, params.s3Key ?? '')
            : eq(attachments.id, params.attachmentId),
        ),
      )
      .limit(1);
    if (!pending) throw ApiError.notFound('No presigned attachment matches that key');
    if (pending.confirmedAt !== null) {
      throw ApiError.conflict('That attachment has already been confirmed');
    }

    // The metadata is re-sent at confirm and re-validated by the schema: a
    // presign is a permission to upload, not a promise about what was uploaded.
    const updates: Record<string, unknown> = { confirmedAt: new Date() };
    if (params.fileName !== undefined) updates['fileName'] = params.fileName;
    if (params.mimeType !== undefined) updates['mimeType'] = params.mimeType;
    if (params.sizeBytes !== undefined) updates['sizeBytes'] = params.sizeBytes;
    await tx.update(attachments).set(updates).where(eq(attachments.id, pending.id));

    await recordActivity(
      {
        projectId: scope.projectId,
        taskId,
        actorId: actor.userId,
        action: 'attachment.added',
        newValue: { attachmentId: pending.id, fileName: params.fileName ?? null },
      },
      tx,
    );

    return pending.id;
  });

  publishTaskUpdated(scope, actor, taskId, ['attachments']);

  const [row] = await db
    .select(attachmentSelection)
    .from(attachments)
    .leftJoin(users, eq(attachments.uploadedById, users.id))
    .where(eq(attachments.id, attachmentId))
    .limit(1);
  if (!row) throw ApiError.internal('Attachment vanished after confirmation');
  return toAttachment(row);
}

/**
 * `GET /tasks/:taskId/attachments` — CONFIRMED rows only.
 *
 * The task detail payload carries `attachmentCount` but not the list (see the
 * gap note in the WP report), so the detail sheet fetches it here.
 */
export async function listAttachments(taskId: string): Promise<Attachment[]> {
  await requireTaskRow(db, taskId);
  const rows = await db
    .select(attachmentSelection)
    .from(attachments)
    .leftJoin(users, eq(attachments.uploadedById, users.id))
    .where(
      and(
        eq(attachments.taskId, taskId),
        isNull(attachments.deletedAt),
        isNotNull(attachments.confirmedAt),
      ),
    )
    .orderBy(asc(attachments.createdAt));
  return rows.map(toAttachment);
}

/** `GET /attachments/:attachmentId/url` — a short-lived presigned GET. */
export async function getAttachmentUrl(attachmentId: string): Promise<AttachmentUrl> {
  const context = await requireAttachmentContext(db, attachmentId);
  const url = await presignDownload(context.s3Key, context.fileName);
  return { url, expiresAt: expiryIso() };
}

/**
 * `DELETE /attachments/:attachmentId` — uploader or project admin.
 *
 * Soft delete only: the object is deliberately LEFT in the bucket, because a
 * soft-deleted row is recoverable and deleting the bytes would make it not be.
 */
export async function deleteAttachment(
  scope: ProjectScope,
  actor: TaskActor,
  role: ProjectRole,
  attachmentId: string,
): Promise<void> {
  const taskId = await withTx(async (tx) => {
    const context = await requireAttachmentContext(tx, attachmentId);
    if (context.uploadedById !== actor.userId && role !== 'admin') {
      throw ApiError.forbidden('Only the uploader or a project admin can delete this attachment');
    }

    await tx
      .update(attachments)
      .set({ deletedAt: new Date() })
      .where(eq(attachments.id, attachmentId));

    await recordActivity(
      {
        projectId: scope.projectId,
        taskId: context.taskId,
        actorId: actor.userId,
        action: 'attachment.deleted',
        oldValue: { attachmentId, fileName: context.fileName },
      },
      tx,
    );

    return context.taskId;
  });

  publishTaskUpdated(scope, actor, taskId, ['attachments']);
}
