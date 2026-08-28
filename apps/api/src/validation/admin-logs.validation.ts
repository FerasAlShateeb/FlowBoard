/**
 * Query validation for the diagnostics log feed.
 *
 * The schema itself lives in `@flowboard/shared` (`diagnostics.schema.ts`): the
 * drawer's poll loop builds this query string and parses the response, so both
 * ends must agree on ONE definition rather than two that happen to match today.
 * This module is a thin re-export so route files keep importing validation from
 * `src/validation/*` like every other quartet.
 *
 * Unlike the API-local predecessor, the shared schema DEFAULTS `sinceId` to 0
 * and `limit` to the ring capacity instead of leaving them optional — which
 * means `snapshot()` receives a fully-specified request and the controller has
 * no defaulting logic of its own.
 */
import { serverLogsQuerySchema, type ServerLogsQuery } from '@flowboard/shared';
import { RING_CAPACITY } from '../utils/log-ring';

export { serverLogsQuerySchema };
export type { ServerLogsQuery };

/**
 * The shared schema caps `limit` at a literal 500 (it cannot import a Node-side
 * constant). This asserts that literal still equals the ring's real capacity —
 * a compile error here is the signal to change both.
 */
type AssertRingCapacity<T extends 500> = T;
export type _RingCapacityMatchesContract = AssertRingCapacity<typeof RING_CAPACITY>;
