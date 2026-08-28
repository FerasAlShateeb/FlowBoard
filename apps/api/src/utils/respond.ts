/**
 * The success half of the response contract.
 *
 * Every controller answers through `respond()`, so the `{ success, data, meta? }`
 * envelope is constructed in exactly one place on the happy path — the mirror of
 * `errorHandler` owning every failure envelope.
 */
import type { Response } from 'express';
import { ok, type PaginationMeta, type SuccessEnvelope } from '@flowboard/shared';

/**
 * Send `data` wrapped in the success envelope.
 *
 * @param meta   Pagination block for list endpoints (`?page&pageSize`).
 * @param status HTTP status; `201` for creates, `200` otherwise.
 *
 * @example
 *   respond(res, task, undefined, 201);
 *   respond(res, tasks, { page, pageSize, total, totalPages });
 */
export function respond<TData>(
  res: Response,
  data: TData,
  meta?: PaginationMeta,
  status = 200,
): void {
  const body: SuccessEnvelope<TData> = ok(data, meta);
  res.status(status).json(body);
}

/** `204 No Content` — for deletes with nothing meaningful to return. */
export function respondNoContent(res: Response): void {
  res.status(204).end();
}
