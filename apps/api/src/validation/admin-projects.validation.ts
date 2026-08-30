/**
 * Request validation for `/api/admin/projects`.
 *
 * The list query lives in `@flowboard/shared`'s `projects.schema.ts` — the admin
 * Projects page builds the same URL the API parses, and its `sort` parameter is
 * a CLOSED field list (`adminProjectSortFields`) so an unknown column is a 422
 * at the boundary instead of a string reaching a query builder.
 *
 * Nothing server-only to add: the endpoint has no route parameters and no body.
 */
export { adminProjectsListQuerySchema } from '@flowboard/shared';

export type { AdminProjectRow, AdminProjectsListQuery } from '@flowboard/shared';
