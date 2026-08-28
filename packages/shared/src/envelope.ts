import { z } from 'zod';

/**
 * THE response envelope. Every FlowBoard HTTP response — success or failure —
 * is shaped by this module, and the web client unwraps it in exactly one place
 * (`apps/web/src/lib/api.ts`).
 *
 * Why an envelope at all: it gives errors a machine-readable `code` that the UI
 * can branch on without string-matching messages, and it gives list endpoints a
 * place to put pagination that is not the payload itself.
 *
 * ```
 * { success: true,  data: T, meta?: PaginationMeta }
 * { success: false, error: { code, message, details? } }
 * ```
 *
 * The two shapes are a discriminated union on `success`, so narrowing on
 * `envelope.success` gives TypeScript `data` on one branch and `error` on the
 * other with no casts.
 */

/** Machine-readable failure. `code` is stable API surface; `message` is not. */
export const apiErrorSchema = z.object({
  /**
   * Stable lower_snake_case identifier — `not_found`, `validation_error`,
   * `token_expired`, `invalid_credentials`. The vocabulary is the one
   * `apps/api/src/utils/api-error.ts` mints and `apps/web/src/i18n/errors.ts`
   * translates, and the web client branches on it (`lib/api.ts` spends a
   * refresh token on `token_expired` and on nothing else).
   *
   * The convention is lower_snake_case, not SCREAMING_SNAKE — this comment
   * claimed the latter, with an example (`TASK_NOT_FOUND`) that has never been
   * emitted by anything. A schema that only demands `min(1)` cannot enforce the
   * shape, so the documentation IS the contract here; anyone who took it
   * literally would ship a code the error catalog cannot translate.
   */
  code: z.string().min(1),
  /** Human-readable, English, for logs and as a last-resort toast. */
  message: z.string().min(1),
  /**
   * Optional structured context — for validation failures this is the flattened
   * zod issue list, keyed by field path, which is what RHF binds to.
   */
  details: z.unknown().optional(),
});

export type ApiErrorPayload = z.infer<typeof apiErrorSchema>;

/** Pagination block returned by every list endpoint (`?page&pageSize`). */
export const paginationMetaSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
  totalPages: z.number().int().nonnegative(),
});

export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

/** The failure half of the envelope. Not generic — errors carry no `data`. */
export const errorEnvelopeSchema = z.object({
  success: z.literal(false),
  error: apiErrorSchema,
});

export type ErrorEnvelope = z.infer<typeof errorEnvelopeSchema>;

/**
 * Builds the success half of the envelope around a payload schema.
 *
 * @example
 *   const schema = successEnvelopeSchema(z.array(taskSchema));
 */
export function successEnvelopeSchema<TData extends z.ZodType>(data: TData) {
  return z.object({
    success: z.literal(true),
    data,
    meta: paginationMetaSchema.optional(),
  });
}

/**
 * Builds the full discriminated envelope around a payload schema. This is what
 * `apps/web/src/lib/api.ts` parses every response with.
 *
 * @example
 *   const parsed = envelopeSchema(taskSchema).parse(await res.json());
 *   if (!parsed.success) throw new ApiError(parsed.error);
 *   return parsed.data; // typed as Task
 */
export function envelopeSchema<TData extends z.ZodType>(data: TData) {
  return z.discriminatedUnion('success', [successEnvelopeSchema(data), errorEnvelopeSchema]);
}

/** Success envelope as a plain type — handy for typing controller returns. */
export interface SuccessEnvelope<TData> {
  success: true;
  data: TData;
  meta?: PaginationMeta;
}

/** Either half of the envelope, discriminated on `success`. */
export type Envelope<TData> = SuccessEnvelope<TData> | ErrorEnvelope;

/** Convenience constructor so controllers never hand-write the literal. */
export function ok<TData>(data: TData, meta?: PaginationMeta): SuccessEnvelope<TData> {
  return meta === undefined ? { success: true, data } : { success: true, data, meta };
}

/** Convenience constructor for the error half (used by the error handler). */
export function fail(error: ApiErrorPayload): ErrorEnvelope {
  return { success: false, error };
}
