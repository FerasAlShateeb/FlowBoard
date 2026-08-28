/**
 * Attachment controllers — the three-step upload's HTTP surface.
 *
 * None of these ever sees a byte of the file: step 2 of the flow is the browser
 * talking straight to MinIO with a URL step 1 signed.
 */
import type { Request, Response } from 'express';
import type { PresignAttachmentInput } from '@flowboard/shared';

import { getParsed } from '../middlewares/validate';
import { getProjectAccess } from '../middlewares/require-roles';
import { respond, respondNoContent } from '../utils/respond';
import {
  confirmAttachment,
  deleteAttachment,
  getAttachmentUrl,
  listAttachments,
  presignAttachment,
} from '../services/attachments.service';
import { actorOf, scopeOf } from './tasks.controller';
import type {
  AttachmentParams,
  ConfirmAttachmentBody,
  TaskAttachmentsParams,
} from '../validation/attachments.validation';

/** Step 1 — `POST /api/tasks/:taskId/attachments/presign`. */
export async function presignTaskAttachment(req: Request, res: Response): Promise<void> {
  const { taskId } = getParsed<TaskAttachmentsParams>(res, 'params');
  const input = getParsed<PresignAttachmentInput>(res);
  const result = await presignAttachment(scopeOf(res), actorOf(req, res), taskId, input);
  respond(res, result, undefined, 201);
}

/** Step 3 — `POST /api/tasks/:taskId/attachments`. */
export async function confirmTaskAttachment(req: Request, res: Response): Promise<void> {
  const { taskId } = getParsed<TaskAttachmentsParams>(res, 'params');
  const input = getParsed<ConfirmAttachmentBody>(res);
  const attachment = await confirmAttachment(scopeOf(res), actorOf(req, res), taskId, input);
  respond(res, attachment, undefined, 201);
}

/** `GET /api/tasks/:taskId/attachments` — confirmed rows only. */
export async function listTaskAttachments(_req: Request, res: Response): Promise<void> {
  const { taskId } = getParsed<TaskAttachmentsParams>(res, 'params');
  respond(res, await listAttachments(taskId));
}

/** `GET /api/attachments/:attachmentId/url` — a short-lived presigned GET. */
export async function getTaskAttachmentUrl(_req: Request, res: Response): Promise<void> {
  const { attachmentId } = getParsed<AttachmentParams>(res, 'params');
  respond(res, await getAttachmentUrl(attachmentId));
}

/** `DELETE /api/attachments/:attachmentId` — uploader or project admin. */
export async function removeTaskAttachment(req: Request, res: Response): Promise<void> {
  const { attachmentId } = getParsed<AttachmentParams>(res, 'params');
  await deleteAttachment(scopeOf(res), actorOf(req, res), getProjectAccess(res).role, attachmentId);
  respondNoContent(res);
}
