/**
 * Request schemas for the command-palette search route.
 *
 * Both limits on `q` live in the shared `searchQuerySchema`: a one-character
 * trigram query matches nearly every title in the org and turns an index scan
 * into a sequential one, and `limit` is capped at
 * {@link MAX_SEARCH_RESULTS} = 25 — the same number the service used to clamp
 * to silently. A rejected `limit=50` tells the caller its request was wrong; a
 * clamped one reads as the org having fewer matches than it does.
 */
import { z } from 'zod';
import { MAX_SEARCH_RESULTS, searchQuerySchema, uuid } from '@flowboard/shared';

export const searchParamsSchema = z.object({ orgId: uuid });
export type SearchParams = z.infer<typeof searchParamsSchema>;

export { MAX_SEARCH_RESULTS, searchQuerySchema };
export type { SearchQuery } from '@flowboard/shared';
