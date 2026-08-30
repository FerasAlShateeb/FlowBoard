// Instance-level configuration: the singleton row that decides whether this
// deployment behaves as a MULTI-organization platform or as a SINGLE-org
// install, and the display name it wears.
//
// WHY A DB SINGLETON RATHER THAN AN ENV VAR (the GitLab pattern). FlowBoard is
// open-sourced, and the overwhelmingly common self-hosted shape is one company,
// one organization — where the org switcher, the `/o/:orgSlug` prefix and the
// "pick an organization" empty states are all noise. That has to be a runtime
// setting an admin can flip from the UI, not a restart: an env var cannot be
// validated against the data (single mode needs a default org that EXISTS), and
// a fork of the data model would double every query in the product. So the mode
// is a row, `instance_settings`, with `id = 1` enforced by a CHECK; the env only
// SEEDS it on a fresh install.
//
// TWO SHAPES, TWO AUDIENCES:
//   - {@link instanceConfigSchema}   `GET /api/instance/config` — any signed-in
//     user. Exactly what the web shell needs to lay itself out, and nothing an
//     admin would consider configuration. Long `staleTime`: it changes about
//     once per deployment.
//   - {@link instanceSettingsSchema} `GET|PATCH /api/admin/settings` — global
//     admin. The full row, including the raw `defaultOrgId` the settings form
//     edits.
//
// `defaultOrgSlug` is RESOLVED server-side on both. The client renders links
// (`/o/:orgSlug`), never ids, and asking it to join a settings payload against
// the org list to find the slug is how a redirect target ends up `undefined`.
//
// Runtime-neutral: zod only, no DOM/Node globals.
import { z } from 'zod';
import { isoDateTime, slugSchema, uuid } from './common';
import { nameSchema } from './users.schema';
import { VM_UPDATE_AT_LEAST_ONE_FIELD } from './validation-messages';

/**
 * How this deployment presents organizations.
 *
 * `multi` — the shipped SaaS shape: a user may belong to many orgs, the
 * switcher is visible, and `/` resolves to the last-used org.
 * `single` — one organization is THE workspace: the switcher is hidden, `/`
 * short-circuits to {@link instanceConfigSchema.shape.defaultOrgSlug}, and the
 * admin Organizations page explains the mode instead of offering a picker.
 *
 * Deliberately NOT a boolean. `orgMode: 'single'` reads the same in a settings
 * form, an API payload and a migration; `isSingleOrg: true` has to be re-read
 * as a question every time, and a third mode later would be a schema break.
 */
export const orgModeSchema = z.enum(['multi', 'single']);
export type OrgMode = z.infer<typeof orgModeSchema>;

/**
 * `GET /api/instance/config` — the shell's copy of the instance identity.
 *
 * `defaultOrgSlug` is `null` in `multi` mode, and in `single` mode ONLY while an
 * install has no organization yet (a fresh, unseeded deployment). The web must
 * render an empty state for that pair rather than assuming it away — see the
 * "zero-org single mode" risk in the Round 2 plan.
 */
export const instanceConfigSchema = z.object({
  orgMode: orgModeSchema,
  defaultOrgSlug: slugSchema.nullable(),
  instanceName: nameSchema,
});
export type InstanceConfig = z.infer<typeof instanceConfigSchema>;

/**
 * `GET /api/admin/settings` — the whole singleton, as the settings form edits
 * it.
 *
 * A superset of {@link instanceConfigSchema}: it adds the raw `defaultOrgId`
 * (what a `<Select>` of organizations binds to) alongside the resolved slug
 * (what a link needs), plus the row's timestamps so the page can say when the
 * instance was configured and when it last changed. The `id` column is not on
 * the wire — there is exactly one row, so carrying its primary key would be
 * ceremony.
 */
export const instanceSettingsSchema = instanceConfigSchema.extend({
  defaultOrgId: uuid.nullable(),
  createdAt: isoDateTime,
  updatedAt: isoDateTime,
});
export type InstanceSettings = z.infer<typeof instanceSettingsSchema>;

/**
 * `PATCH /api/admin/settings` — every field optional, at least one required.
 *
 * `defaultOrgId` is the id, never the slug: the slug is a display detail an
 * admin may rename, and binding the mode to a renameable string is how single
 * mode ends up pointing at nothing after an org is re-slugged.
 *
 * THE CROSS-FIELD RULE — "`single` mode requires a default org that exists" —
 * is deliberately NOT expressed here. It is a DATABASE question (does that org
 * row exist, and is it not soft-deleted?), and a zod refinement could only
 * check the weaker "is the field present", which would then have to be
 * re-checked server-side anyway. The service validates it and answers 422; see
 * `services/instance-settings.service.ts`.
 */
export const updateInstanceSettingsInputSchema = z
  .object({
    orgMode: orgModeSchema,
    defaultOrgId: uuid.nullable(),
    instanceName: nameSchema,
  })
  .partial()
  .refine((value) => Object.keys(value).length > 0, { message: VM_UPDATE_AT_LEAST_ONE_FIELD });
export type UpdateInstanceSettingsInput = z.infer<typeof updateInstanceSettingsInputSchema>;
