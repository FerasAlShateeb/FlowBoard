/**
 * Object storage for task attachments (MinIO in dev, any S3-compatible service
 * in production).
 *
 * The API never proxies file bytes: the browser PUTs straight to a presigned
 * URL and later GETs from one. That keeps large uploads off the Node event loop
 * and means an attachment download never occupies a request slot.
 *
 * `forcePathStyle` is mandatory for MinIO — the virtual-hosted style AWS
 * defaults to would resolve `bucket.localhost:9000`, which does not exist.
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env';

/** How long a presigned URL stays valid. Long enough for a slow upload, short
 *  enough that a leaked URL is not a standing grant. */
export const PRESIGN_TTL_SECONDS = 15 * 60;

/** The shared S3 client. Construction is local — no network call happens here. */
export const s3Client = new S3Client({
  region: env.S3_REGION,
  endpoint: env.S3_ENDPOINT,
  forcePathStyle: true,
  credentials: {
    accessKeyId: env.S3_ACCESS_KEY,
    secretAccessKey: env.S3_SECRET_KEY,
  },
});

/** Bucket every attachment lives in. Keys are `{orgId}/{projectId}/{taskId}/{uuid}-{name}`. */
export const S3_BUCKET = env.S3_BUCKET;

/**
 * Presign a PUT for a browser upload.
 *
 * `ContentType` and `ContentLength` are part of the signature, so the client
 * cannot swap a 2 MB image for a 2 GB one after the server approved the upload:
 * a mismatched header fails the signature check at the storage service.
 */
export function presignUpload(key: string, mimeType: string, sizeBytes: number): Promise<string> {
  const command = new PutObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    ContentType: mimeType,
    ContentLength: sizeBytes,
  });
  return getSignedUrl(s3Client, command, { expiresIn: PRESIGN_TTL_SECONDS });
}

/**
 * Presign a GET, forcing a download with the ORIGINAL file name.
 *
 * Stored keys are uuid-prefixed to stay unique; without the override the
 * browser would save `9f2c…-report.pdf`.
 */
export function presignDownload(key: string, fileName: string): Promise<string> {
  const command = new GetObjectCommand({
    Bucket: S3_BUCKET,
    Key: key,
    ResponseContentDisposition: `attachment; filename="${sanitizeFileName(fileName)}"`,
  });
  return getSignedUrl(s3Client, command, { expiresIn: PRESIGN_TTL_SECONDS });
}

/** Delete an object. Used when an attachment row is removed. */
export async function deleteObject(key: string): Promise<void> {
  await s3Client.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: key }));
}

/**
 * Strip the characters that would break out of the quoted `filename="…"` in the
 * Content-Disposition header (a header-injection vector, since the value is
 * signed and then echoed back by the storage service).
 */
function sanitizeFileName(fileName: string): string {
  // eslint-disable-next-line no-control-regex -- stripping control chars is the point
  return fileName.replace(/[\u0000-\u001f\u007f"\\]/gu, '_').slice(0, 200) || 'download';
}
