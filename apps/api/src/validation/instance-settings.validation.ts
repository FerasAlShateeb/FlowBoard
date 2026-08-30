/**
 * Request validation for `/api/instance/config` and `/api/admin/settings`.
 *
 * Both contracts already live in `@flowboard/shared`'s `instance.schema.ts` —
 * the settings form posts the same body the API parses — so this module only
 * re-exports them, keeping every route file importing its validation from
 * `src/validation/*` like the rest of the quartets.
 *
 * There is nothing server-only to add: neither endpoint takes a route parameter
 * or a query string. `GET /config` and `GET /` read the singleton; `PATCH /`
 * carries the whole payload in its body.
 */
export { updateInstanceSettingsInputSchema } from '@flowboard/shared';

export type {
  InstanceConfig,
  InstanceSettings,
  OrgMode,
  UpdateInstanceSettingsInput,
} from '@flowboard/shared';
