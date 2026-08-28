// Attachment contracts — the three-step MinIO/S3 upload.
//
// THE FLOW, and why it is three calls rather than one multipart POST:
//   1. `POST /tasks/:taskId/attachments/presign` -> `{ uploadUrl, s3Key }`
//   2. the browser PUTs the bytes STRAIGHT TO MinIO at `uploadUrl`
//   3. `POST /tasks/:taskId/attachments` confirms the key and writes the row
//
// The file bytes never touch the API process: no request-size ceiling to raise,
// no memory spike per upload, and the API stays a small stateless container. The
// cost is that step 2 can succeed while step 3 never arrives, leaving an orphan
// object in the bucket — accepted deliberately (an orphan blob is cheap; a
// missing row is visible), and a lifecycle rule sweeps unconfirmed keys.
//
// Runtime-neutral: zod only, no DOM/Node globals.
import { z } from 'zod';
import { isoDateTime, uuid } from './common';
import { userSummarySchema } from './users.schema';
import {
  VM_ATTACHMENT_REFERENCE_REQUIRED,
  VM_FILE_EMPTY,
  VM_FILE_NAME_REQUIRED,
  VM_FILE_TOO_LARGE,
  VM_FILE_TYPE_REQUIRED,
  VM_TOO_LONG,
  VM_URL_INVALID,
} from './validation-messages';

/** Hard attachment ceiling: 25 MB, enforced at presign AND at confirm. */
export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

/** The original file name as the uploader had it on disk. */
export const fileNameSchema = z.string().trim().min(1, VM_FILE_NAME_REQUIRED).max(255, VM_TOO_LONG);

/** The browser-reported MIME type; trusted for display only, never for safety. */
export const mimeTypeSchema = z.string().trim().min(1, VM_FILE_TYPE_REQUIRED).max(255, VM_TOO_LONG);

/** File size in bytes, floor 1 and ceiling {@link MAX_ATTACHMENT_BYTES}. */
export const fileSizeSchema = z
  .number()
  .int()
  .min(1, VM_FILE_EMPTY)
  .max(MAX_ATTACHMENT_BYTES, VM_FILE_TOO_LARGE);

/**
 * The object key inside the bucket:
 * `{orgId}/{projectId}/{taskId}/{uuid}-{fileName}`. Server-generated — the
 * random uuid segment is what stops a caller confirming someone else's key or
 * overwriting an existing object by re-uploading the same name.
 */
export const s3KeySchema = z.string().min(1).max(1024);

/** An attachment row on a task. */
export const attachmentSchema = z.object({
  id: uuid,
  taskId: uuid,
  fileName: fileNameSchema,
  mimeType: mimeTypeSchema,
  sizeBytes: fileSizeSchema,
  s3Key: s3KeySchema,
  uploadedBy: userSummarySchema,
  createdAt: isoDateTime,
});
export type Attachment = z.infer<typeof attachmentSchema>;

/** `POST /tasks/:taskId/attachments/presign` — step 1 of the upload. */
export const presignAttachmentInputSchema = z.object({
  fileName: fileNameSchema,
  mimeType: mimeTypeSchema,
  sizeBytes: fileSizeSchema,
});
export type PresignAttachmentInput = z.infer<typeof presignAttachmentInputSchema>;

/**
 * Step 1's response. `uploadUrl` is a short-lived presigned PUT; `s3Key` is what
 * the client hands back at confirm, so it never invents a key of its own.
 *
 * `attachmentId` is the id of the PENDING row the server wrote at presign time
 * (`confirmed_at IS NULL`, invisible to the UI). It is returned because it is
 * the cheaper of the two confirm references — an id instead of a 100-character
 * key — and because it lets a client that abandons an upload say so.
 */
export const presignAttachmentResponseSchema = z.object({
  uploadUrl: z.url(VM_URL_INVALID),
  s3Key: s3KeySchema,
  attachmentId: uuid,
  expiresAt: isoDateTime,
});
export type PresignAttachmentResponse = z.infer<typeof presignAttachmentResponseSchema>;

/**
 * `POST /tasks/:taskId/attachments` — step 3.
 *
 * The pending row is identified by EITHER reference the presign handed back:
 * `attachmentId` or `s3Key`. At least one is required; supplying both is fine
 * and must agree, because they name the same row.
 *
 * The metadata fields are optional and, when present, re-validated: the server
 * already stored them at presign time, but a presign is a permission to upload
 * rather than a promise about what was uploaded, so a client that knows better
 * (a rename mid-flight) may correct them.
 */
export const confirmAttachmentInputSchema = z
  .object({
    attachmentId: uuid.optional(),
    s3Key: s3KeySchema.optional(),
    fileName: fileNameSchema.optional(),
    mimeType: mimeTypeSchema.optional(),
    sizeBytes: fileSizeSchema.optional(),
  })
  .refine((value) => value.attachmentId !== undefined || value.s3Key !== undefined, {
    message: VM_ATTACHMENT_REFERENCE_REQUIRED,
    path: ['s3Key'],
  });
export type ConfirmAttachmentInput = z.infer<typeof confirmAttachmentInputSchema>;

/** `GET /attachments/:attachmentId/url` — a short-lived presigned GET. */
export const attachmentUrlSchema = z.object({
  url: z.url(VM_URL_INVALID),
  expiresAt: isoDateTime,
});
export type AttachmentUrl = z.infer<typeof attachmentUrlSchema>;
