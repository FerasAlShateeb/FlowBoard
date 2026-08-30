# Instance Administration

Everything above an organization: the `instance_settings` singleton and
single-org mode, the five `/admin/*` console pages, the navigation shell that
makes the console escapable, and view-as-member. Read this before touching
anything under `/admin`, before adding an instance-level setting, and before
changing how `/` resolves.

The analytics half of the console is [analytics.md](./analytics.md); the ops
half is [telemetry.md](./telemetry.md). This file owns the identity,
configuration and navigation surfaces.

## 1. Who an instance admin is

**One boolean, `users.is_global_admin`, baked into the access token at
sign-in.** There is no platform-role enum: FlowBoard's permission chain widens
global admin ⊃ org admin ⊃ project role, and the top rung is a flag rather than
a row so a guard can answer it with no query.

| Middleware           | File                                       | Does                                                                                                       |
| -------------------- | ------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `requireAuth`        | `apps/api/src/middlewares/require-auth.ts` | Verifies the Bearer access token, attaches `req.user = { id, isGlobalAdmin, tokenVersion }`. Zero DB cost. |
| `requireGlobalAdmin` | same file                                  | Stacks after it; 401 with no user, 403 otherwise.                                                          |

**Every instance-admin router applies the pair once, at the router level**, so a
route added later cannot be born unguarded. That is the same arrangement
`admin-telemetry.routes.ts` uses and it is the one to copy.

The web mirror is `RequireGlobalAdmin` in `apps/web/src/routes/guards.tsx`,
which makes two checks rather than one: the persisted flag, and `GET /auth/me`.
A token in localStorage proves only that somebody was an admin on this device
once. It waits on `/auth/me` **only when the persisted flag says "no"** —
showing a refusal for a beat and then revealing the page is worse than a brief
spinner, while an admin whose flag already says yes should never see one.

## 2. Instance settings and single-org mode

### 2.1 The singleton

`apps/api/src/db/schema/instance-settings.ts`, migration
`apps/api/drizzle/0001_instance_settings.sql`.

| Column                      | Type                                           | Notes                                                                                                     |
| --------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `id`                        | `integer` PK, default `1`                      | CHECK `instance_settings_singleton`: `id = 1`. **The database enforces the singleton**, not a convention. |
| `org_mode`                  | `text NOT NULL default 'multi'`                | `'multi' \| 'single'`, parsed by the shared `orgModeSchema` on every read.                                |
| `default_org_id`            | `uuid NULL → organizations ON DELETE SET NULL` | The org single mode collapses onto.                                                                       |
| `instance_name`             | `text NOT NULL default 'FlowBoard'`            | Deployment label.                                                                                         |
| `created_at` / `updated_at` | `timestamptz` via `timestamps()`               |                                                                                                           |

`org_mode` is `text` rather than a pg enum for the reason
[database.md](./database.md) gives for the others: a third deployment shape must
not be a migration, the closed set lives in `@flowboard/shared`, and the column
has exactly one writer.

**The row is created twice over, idempotently.** The migration appends an
`INSERT … ON CONFLICT DO NOTHING` for row 1, and
`apps/api/src/services/instance-settings.service.ts`'s `readRow()` lazily
inserts the same defaults with `onConflictDoNothing()` — because the integration
suites reset with `TRUNCATE`, not by re-migrating, so a service that assumed the
row was there would fail in `beforeEach`.

**`defaultOrgSlug` is never stored.** `resolveDefaultOrgSlug()` recomputes it on
every read: use `default_org_id` if it still resolves to a live (non-archived)
org; otherwise, **only in `single` mode**, adopt the oldest live org
(`ORDER BY created_at, id ASC LIMIT 1`); otherwise `null`. Storing a slug would
mean a rename or an archive could leave the shell pointing at a URL that 404s.

### 2.2 The endpoints

| Method  | Path                   | Guard                             | Body / response                                                                                        |
| ------- | ---------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `GET`   | `/api/instance/config` | `requireAuth`                     | `instanceConfigSchema` — `{ orgMode, defaultOrgSlug, instanceName }`. Read by every signed-in session. |
| `GET`   | `/api/admin/settings`  | `requireAuth, requireGlobalAdmin` | `instanceSettingsSchema` — the config plus `defaultOrgId`, `createdAt`, `updatedAt`.                   |
| `PATCH` | `/api/admin/settings`  | `requireAuth, requireGlobalAdmin` | `updateInstanceSettingsInputSchema` (partial, at-least-one-field).                                     |

**The split is the point.** Every user needs to know whether the shell has an
org switcher; only an admin may see or change the row behind that answer. Two
endpoints, two guards, one service.

### 2.3 What `PATCH` refuses, and why

`updateInstanceSettings` runs read-then-write inside one transaction:

- **Any `defaultOrgId` explicitly sent is validated against live orgs, in either
  mode** → `422 default_org_invalid` if it is unknown or archived.
- **Switching to `single`** drops a stale configured default silently (its org
  was archived) and then tries to re-adopt: exactly one live org → adopt it;
  more than one → `422 default_org_required`; **zero → allowed**, with
  `defaultOrgId` left `null`.
- **Zero-org single mode is a real supported state**, not an oversight: a fresh
  open-source install is exactly that, and the shell has an explicit empty state
  with a create-org route out of it (§3.3).
- **Flipping back to `multi` keeps `defaultOrgId`**, which the shell simply
  ignores. Clearing it would lose the setting on a there-and-back.

**The two error codes name the field the reader can change.** They are
`default_org_invalid` and `default_org_required`, not a bare `conflict`, and
`AdminSettingsPage` attaches both to the `defaultOrgId` form field with
`setError` rather than raising a toast. The same discipline is why the org slug
clash is `slug_taken` on create/rename and `org_slug_conflict` on restore rather
than one generic 409 (§5.4): a conflict the user cannot act on is an error
message that wastes their time.

### 2.4 What collapses in single mode — the GitLab precedent

Single-org mode is a **deployment shape, not a fork of the data model**. Every
table, every route and every id keeps its org dimension; the shell stops asking
about it. That is the pattern GitLab uses for a single-group install, and it is
why `orgMode` is one row rather than a build flag.

`apps/web/src/hooks/useInstanceConfig.ts` is the source of truth:
`useInstanceConfig()` always returns a resolved value, degrading to
`FALLBACK_INSTANCE_CONFIG = { orgMode: 'multi', defaultOrgSlug: null,
instanceName: 'FlowBoard' }` on any failure — **`multi` is the shape that hides
nothing**, so a failed config read can never make an org disappear.
`useIsSingleOrgMode()` is the convenience wrapper.

| Site                                          | In single mode                                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `components/layout/OrgSwitcher.tsx`           | `if (orgMode === 'single') return null` — the switcher renders nothing at all.                                            |
| `hooks/useLastOrg.ts` → `resolveHomeTarget()` | `/` short-circuits to `defaultOrgSlug` **before `GET /orgs` resolves**; `null` default falls to the picker.               |
| `pages/HomePage.tsx`                          | Redirects accordingly; an effective admin still gets a "Create organization" CTA into `/admin/orgs`.                      |
| `components/layout/Sidebar.tsx`               | Reads `defaultOrgSlug` (not `orgMode`) and passes it into `buildSections`, so workspace links resolve on org-less routes. |
| `components/navigation/breadcrumb-trail.ts`   | Same fallback through `ScopeContext.defaultOrgSlug`.                                                                      |
| `components/palette/CommandPalette.tsx`       | Threads `defaultOrgSlug` into the palette's scope — plumbing, not an independent branch.                                  |
| `pages/admin/AdminOrgsPage.tsx`               | Renders the `single-org-banner` alert naming the default org and linking to `/admin/settings`. **Create stays enabled.**  |

`/admin/users` and `/admin/projects` deliberately do **not** branch on
`orgMode`: the account directory and the cross-org project list are the same
list either way.

A successful `PATCH /api/admin/settings` invalidates `qk.instance.all()`, which
covers both `config()` and `settings()` — so the shell collapses or expands
live, without a reload.

### 2.5 The flip does **not** propagate to other sessions — an accepted decision

**In the admin's OWN tab the flip is live** (the invalidation above). **Every
other open session learns about it on its next reload**, or whenever its
`instanceConfig` query is refetched by ordinary staleness. There is no socket
event for `orgMode`, and R2 W3.5 reviewed that and **decided to keep it that
way**. The reasoning, recorded here so it is not re-litigated as a bug:

- **The degradation is graceful, and was verified.** A stale session keeps the
  shape it booted with. A tab that still shows the org switcher after a flip to
  `single` shows a switcher over the orgs that user really is in; clicking one
  navigates to a URL that still resolves, because single mode collapses the
  _shell_, not the data model (§2.4) — every route keeps its org dimension. A
  tab that has not yet learned about a flip back to `multi` is missing a
  switcher it can reach through `/` in any case. Neither direction can produce a
  404, a wrong permission, or a lost write.
- **The blast radius is one field on one row, changed by one person, rarely.**
  `org_mode` is a deployment shape set at install time and touched perhaps once
  more in an instance's life. Every other live-propagation mechanism in
  FlowBoard exists for something that changes many times a minute (a board) or
  that is a security boundary (`user.revoked`, `org.archived` — see
  `utils/domain-events.ts`). This is neither.
- **The alternative costs a new socket event, a new room and a new client
  handler** for a value the client already refetches, and would be the first
  broadcast in the product that no user action in that room caused.

The rule this leaves is worth stating plainly for anyone reading the code: **the
server is always the authority.** Nothing about a stale `orgMode` grants access —
`instanceConfig` is chrome, exactly like view-as-member (§4), and every endpoint
re-checks its own guard regardless of what any client believes.

## 3. The navigation shell

The Round-2 problem this solves was a real trap: on `/admin/*` the sidebar
dropped every org link, the switcher rendered as a disabled button for
single-org users, the brand mark was not a link, and the breadcrumb slot was
empty. A global admin could get stuck.

### 3.1 One model, three surfaces — `components/navigation/nav.config.ts`

A pure data module: no React, no i18next, no router.

```ts
export type NavLabelKey   = 'common:nav.home' | 'common:nav.board' | …;  // a hand-written literal union
export type NavSectionKey = 'common:nav.projectSection' | 'common:nav.workspaceSection'
                          | 'common:nav.adminSection'   | 'common:nav.analyticsSection';

export interface NavItem    { id; labelKey: NavLabelKey; icon; path; end?; inPalette?; keywords? }
export interface NavSection { id; labelKey: NavSectionKey; items: NavItem[] }
export interface NavScope   { orgSlug; projectKey; effectiveAdmin; defaultOrgSlug; lastOrgSlug }

resolveNavOrgSlug(scope)   // orgSlug ?? lastOrgSlug ?? defaultOrgSlug — "the ladder"
buildSections(scope)       // project? + workspace + (admin + analytics if effectiveAdmin)
flattenNav(sections) · findByPath(pathname) · scopeFromNavPath(pathname)
isActiveNavPath(item, pathname) · searchNav(sections, query, translate, limit = 9)
```

Three surfaces consume it and **cannot disagree**, because none of them owns a
second list: `components/layout/Sidebar.tsx` renders `buildSections(scope)`;
`components/navigation/breadcrumb-trail.ts` resolves against `findByPath` /
`flattenNav`; `components/palette/palette-items.ts` imports the same builders
and adds only its own section headings and two verbs.

**The ladder is what fixes the trap.** On `/admin/*` there is no org in the URL,
so `resolveNavOrgSlug` falls through to the last org the reader used and then to
the instance default — and the workspace section still renders real links.

### 3.2 Breadcrumbs — `components/navigation/breadcrumb-trail.ts`

`buildCrumbs({ pathname, orgName })` returns `Crumb[]`, a discriminated union of
`KeyCrumb` (an i18n key) and `TextCrumb` (a name — an org, a project key, a task
key). It tries four route families in order: root, project routes, org routes,
then everything else through `findByPath` and a deepest-prefix fallback; an
unmodelled path degrades to prettified segments rather than rendering nothing.
`sealTrail` nulls the last crumb's `path`, so the current page is not a link.

`Breadcrumbs.tsx` is the render layer and exports `useBreadcrumbs()` and
`useCurrentPageTitle()` — the second is the mobile heading, from the same data,
so the two can never say different things. It is rendered directly by
`Topbar.tsx` in the start zone (`data-testid="breadcrumb-slot"`), not through
the `TopbarSlots` registry.

**The analytics drill-down is why `metric-catalog.ts` exists.** A breadcrumb for
`/admin/analytics/engagement/dau` must read "… › Engagement › Daily active
users" rather than the prettified segment "Dau", and the trail's whole value is
being a pure function of a URL. See [analytics.md](./analytics.md) §4.

### 3.3 The escape routes

An "escape route" is a way out of a page that needs no org, no membership and no
resolved query. There are four, and each is named at its own site:

| Escape route                          | Where                                                                                                                                                                                                                                    |
| ------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **The brand mark is a `Link to="/"`** | `components/layout/Sidebar.tsx`, `data-testid="brand-home"`                                                                                                                                                                              |
| **The Home nav row**                  | `nav.config.ts`'s workspace section — the guaranteed hatch out of `/admin/*`                                                                                                                                                             |
| **The switcher's footer**             | `components/layout/OrgSwitcher.tsx` — "All organizations" → `/`, plus "Manage organizations" → `/admin/orgs` for an effective admin. **It sits outside `CommandList`**, so a search that matches nothing cannot filter the way out away. |
| **The 404's back-link**               | `pages/NotFoundPage.tsx` renders _inside_ the shell, so the sidebar and org context survive an unknown URL                                                                                                                               |

`pages/HomePage.tsx` is the destination all of them share, and it is an escape
route rather than only a choice: on a fresh install with no orgs at all, an
effective admin gets a create-org CTA into `/admin/orgs` so the picker is never
a dead end.

The org switcher is a **searchable combobox that is always enabled** — command
inside a popover — rather than the disabled button a single-org user used to
get. In single-org mode it renders nothing at all (§2.4), which is a different
statement from "there is a control here and it does not work".

## 4. View-as-member

**Chrome only. Never authorization.** The server re-checks `isGlobalAdmin` on
every admin endpoint regardless of what the client believes, and
`components/navigation/view-as.ts` says so in its header.

### 4.1 Real versus effective

`apps/web/src/stores/useAuthStore.ts`:

```ts
isGlobalAdmin(); // the REAL flag from the session payload
isEffectiveGlobalAdmin(); // isGlobalAdmin() && !viewingAsMember
```

**Every chrome surface reads the effective flag; only the switch itself reads
the real one.** Consumers: `Sidebar` (the admin and analytics sections),
`palette-items`, `OrgSwitcher`'s admin footer row, `HomePage`'s create CTA,
`RequireGlobalAdmin`, and `DiagnosticsDrawer` (R2 W3.5 — its trigger, its two
chords and the panel itself; it read the real flag until then, so a preview kept
a live server-log tail and Ctrl+J).

`viewingAsMember` is persisted under `fb-view-mode-v1` (its own key, **not**
folded into `fb-auth-v1` — it is a posture, not a session) via
`loadViewingAsMember` / `persistViewingAsMember`, both `try`/`catch`-wrapped.
`clearSession()` resets it: a preference about how to look at the app must not
outlive the person looking.

### 4.2 The bounce, and the pill

`view-as.ts` is pure and exports the two rules:

```ts
isAdminPath(pathname); // '/admin' or '/admin/…'
viewChangeBounceTarget(pathname, nextViewingAsMember); // '/' only when switching INTO
// member view on an admin path
```

Switching **into** member view while standing on `/admin/*` navigates to `/`
with `replace: true`. Switching back never bounces — you are where you were, now
with more visible.

`components/layout/ViewAsPill.tsx` renders only when
`realAdmin && viewingAsMember`: an amber pill in the topbar's end zone
(`data-testid="view-as-pill"`) whose single click returns you.
`useViewAsSwitch()` is the shared hook behind both the pill and the user-menu
item (`data-testid="view-as-toggle"`), and it toasts on both directions.

`RequireGlobalAdmin` handles the case the bounce cannot — a deep link straight
into `/admin/*` while in member view — by rendering an `EmptyState` with a
"return to admin view" button (`data-testid="view-as-exit"`) rather than a bare
redirect. A silent redirect from a pasted link reads as a broken link.

### 4.3 `?scope=member` — the server half

**One endpoint accepts it: `GET /api/orgs`.** The query contract is
`orgListQuerySchema` in `packages/shared/src/orgs.schema.ts`
(`{ q?, scope?: 'member', includeDeleted? }`).

`listOrgsForUser` in `apps/api/src/services/orgs.service.ts` takes its
global-admin "every org" branch only when
`actor.isGlobalAdmin && query.scope !== 'member'`; otherwise it falls through to
the ordinary membership join. **It is a pure narrowing and can never widen
access.**

The web side asks for it automatically:

```ts
const asMember = useAuthStore((s) => s.isGlobalAdmin() && s.viewingAsMember);
// query key: [...qk.orgs.mine(), asMember ? 'member' : 'all']
```

The key carries the scope, so the two answers cannot overwrite each other in the
cache — which is the whole reason the switch is instant.

## 5. The console — five pages

All five sit inside one `<RequireGlobalAdmin />` route group in
`apps/web/src/routes/index.tsx`; `/admin` itself is a
`<Navigate to="/admin/overview" replace />`.

| Route             | File                                | Shape                                                                                 | Kit                                      |
| ----------------- | ----------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------- |
| `/admin/overview` | `pages/admin/AdminOverviewPage.tsx` | Five linked `StatTile` KPIs + two fixed-window trend panels; opt-in 30 s auto-refresh | `StatTile`, `PanelCard`, `SectionHeader` |
| `/admin/orgs`     | `pages/admin/AdminOrgsPage.tsx`     | Org CRUD + archive + restore, archived toggle, single-org banner                      | `DataTable`, `useGridUrlState`           |
| `/admin/projects` | `pages/admin/AdminProjectsPage.tsx` | Read-only cross-org project list, server-sorted and server-paged                      | `DataTable`, `useGridUrlState`           |
| `/admin/settings` | `pages/admin/AdminSettingsPage.tsx` | Instance name, org mode, default org                                                  | `SectionHeader` + `Card`/`Form` only     |
| `/admin/users`    | `pages/admin/AdminUsersPage.tsx`    | The account directory and every capability it exposes (§5.2)                          | `useGridUrlState` + the older `ui/table` |

**`AdminUsersPage` is the one grid still on the older table.** It uses
`ui/table` plus `components/datatable/TablePagination.tsx` rather than
`components/dashboard/DataTable`, while already following the new URL-state
convention. That is a known, bounded inconsistency — not a second pattern to
copy.

### 5.1 Overview

One request (`GET /admin/analytics/overview`) feeds all five tiles, so there is
no per-tile error state: a failure shows `NO_VALUE` (`—`) rather than five
identical error boxes for one fact. Each tile is a link to where the number can
be investigated (`/admin/users`, `/admin/orgs`, `/admin/projects`,
`/admin/analytics/work`, `/admin/analytics/traffic`) — the tile-is-the-link rule
from [analytics.md](./analytics.md) §1.

`errorRate24h` is a **share in `[0,1]`**, rendered with `formatShare(v, 1)`.
There is an explicit anti-regression test for reading it as a percentage.

### 5.2 The users console — every capability

| Capability                      | Request                                            | Component                                 | Self-guard                                                                |
| ------------------------------- | -------------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------------- |
| Provision                       | `POST /admin/users`                                | `ProvisionDialog` + `OrgMembershipPicker` | n/a — password generated client-side and revealed once                    |
| Reset password                  | `POST /admin/users/:userId/reset-password`         | `ResetPasswordDialog`                     | offered for self too                                                      |
| Force logout                    | `PATCH { forceLogout: true }`                      | menu → `ConfirmDialog`                    | offered for self                                                          |
| Promote / demote global admin   | `PATCH { isGlobalAdmin }`                          | menu → `ConfirmDialog`                    | **hidden for self**, and the server 400s it                               |
| Deactivate / reactivate         | `PATCH { isActive }`                               | menu → `ConfirmDialog`                    | **hidden for self**, and the server 400s it                               |
| Delete (anonymize)              | `DELETE /admin/users/:userId`                      | `DeleteUserDialog` (`AlertDialog`)        | **never offered for self**; gate is the typed **email**, case-insensitive |
| Org memberships                 | `POST/PATCH/DELETE /orgs/:orgId/members[/:userId]` | `MembershipsDialog`                       | writes live, no Save button                                               |
| CSV export                      | none — the rows on screen                          | `downloadCsvBlob` + `lib/csv`             | disabled at zero rows                                                     |
| Search + active/inactive filter | `GET /admin/users?q&isActive&page&pageSize`        | `useGridUrlState`                         | —                                                                         |

**Two guards, not one, on the dangerous three.** The page hides the control and
the service refuses the call, because a UI guard alone is a suggestion. There is
**no bulk-action surface** — every action is single-row and confirmed.

The memberships dialog reuses the **org's own** membership endpoints rather than
minting admin twins, with the ids travelling in the mutation variables. One
contract, one role matrix, one set of tests.

### 5.3 Anonymize-delete — what `DELETE /api/admin/users/:userId` actually does

**Users are never hard-deleted, and never soft-deleted either.** `deleteUser` in
`apps/api/src/services/admin-users.service.ts` anonymizes, in one transaction:

| Field                             | After                                                                                                                 |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `name`                            | `'Deleted user'` (`DELETED_USER_NAME`)                                                                                |
| `email`                           | `deleted+<uuid>@flowboard.invalid` — **rewritten, not nulled**: the column is `NOT NULL` and unique on `lower(email)` |
| `avatar_url`                      | `null`                                                                                                                |
| `is_active`                       | `false`                                                                                                               |
| `token_version`                   | bumped — every access and refresh token dies immediately                                                              |
| `org_members` / `project_members` | every row removed; the count is returned as `membershipsRemoved`                                                      |
| everything else                   | **kept** — the row, its id, and therefore every comment, activity entry, attachment and assignment that points at it  |

Refusals: `404` unknown, `400` on your own account, **`409` if already
anonymized** (detected by the `@flowboard.invalid` suffix, so a double-click
cannot mint a second scrub address). After the commit the service publishes
`user.revoked`, which the realtime bridge turns into a forced disconnect of that
user's live sockets — the same mechanism deactivation uses.

The response is `{ user, membershipsRemoved }` with a **200**, not a 204: the
caller needs to know how many memberships went, and the dialog says so.

### 5.4 Orgs — archive and restore

`AdminOrgsPage` is the only surface that can create an organization
(`useCreateOrg` was dead code before Round 2). Archive is the ordinary soft
delete (`DELETE /orgs/:orgId`); **restore is a new endpoint**,
`POST /api/orgs/:orgId/restore`, guarded by `requireGlobalAdmin` rather than
`requireOrgRole('admin')` — an archived org has no readable membership to check
a role against, so restoring one is a platform act.

Restore answers `404` for an unknown org, `409 conflict` if it is not archived,
and `409 org_slug_conflict` if the slug is no longer free.

Two dialog conventions differ deliberately and both are correct:
`ArchiveOrgDialog` gates on the typed **org name**, exactly; `DeleteUserDialog`
gates on the typed **email**, case-insensitively. A name is what the reader sees
in the row; an email is the unambiguous identifier for a person who may share a
display name with someone else.

The archived toggle is a **server flag** (`?includeDeleted=1`), not a client
filter — and it switches the row _shape_ the endpoint returns
(`orgAdminRowSchema` with counts and `deletedAt`, versus `orgWithRoleSchema`).
The hook widens the live rows to the admin shape so the grid has one type.
`includeDeleted` is global-admin-only and answers **403** for an org admin: it
is a platform surface, not an org surface.

Every org mutation invalidates four key prefixes — `qk.adminOrgs.all()`,
`qk.orgs.all()`, `qk.adminProjects.all()` and `qk.instance.all()` — because
archiving an org changes the project list, the switcher, and possibly the
resolved default org.

### 5.5 Projects — deliberately read-only

`GET /api/admin/projects?q&orgId&includeArchived&page&pageSize&sort` is
server-paged **and** server-sorted, over a closed sort whitelist —
`adminProjectSortFields = ['name','org','taskCount','lastActivityAt']` in
`packages/shared/src/projects.schema.ts`, composed through `sortQueryFor`.

**The whitelist is enforced twice, at two different severities, and both are
correct.** The server 422s an unknown sort field: it is a zod enum at the
boundary, and an endpoint that silently ignored half a query would be lying
about what it sorted by. The web's grid codec (`useGridUrlState`, rule 2) drops
an invalid value _before_ it becomes a request and rewrites the URL canonically,
so a hand-edited `?sort=nonsense` hydrates the default rather than turning a
pasted link into an error page. Neither behaviour is a fallback for the other.

Row actions are "Open board" and "Open organization" only — **project mutation
lives on the project's own pages**, and duplicating it here would duplicate its
role matrix.

## 6. Testing

| File                                                                               | Covers                                                                                                                                                                                                                                                                           |
| ---------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/src/routes/__tests__/instance-admin-test-app.ts`                         | The shared builder mounting `adminProjectsRouter`, `adminSettingsRouter`, `adminUsersRouter`, `instanceConfigRouter` and `orgsRouter` at their real paths — so one suite cannot fail on a sibling router being mid-edit                                                          |
| `.../instance-settings.routes.test.ts`                                             | The auth split (`/instance/config` vs `/admin/settings`), lazy row creation, default-org resolution and its fallbacks, zero-org single mode, an unknown `org_mode` degrading to `multi`, and every `PATCH` refusal including the transaction not committing                      |
| `.../orgs-admin.routes.test.ts`                                                    | `?q`, `?scope=member` (narrowing, real role kept, 422 on an unknown scope), `?includeDeleted=1` (403 for a member **and** for an org admin), and the full restore matrix                                                                                                         |
| `.../admin-users-lifecycle.routes.test.ts`                                         | The memberships readout, provisioning into orgs (and rolling back on an archived one), and the whole delete suite — scrub, preservation, membership count, `token_version`, `user.revoked` published only on success, the second-delete 409, a unique scrub address per deletion |
| `.../admin-projects.routes.test.ts`                                                | Guard, row shape across tenants, archived rows (including projects of an archived org), filters, the sort whitelist, and pagination meta                                                                                                                                         |
| `apps/api/src/db/schema.test.ts`                                                   | `instance_settings` in the table list, and `instance_settings_singleton` in its check list                                                                                                                                                                                       |
| `apps/web/src/pages/admin/*.test.tsx`                                              | Per page: the URL round-trip, the dialogs' gates, the confirm copy naming the consequence, the self-guards, the single-org banner, and the CSV blob read back from a stubbed `createObjectURL`                                                                                   |
| `apps/web/src/components/navigation/{nav.config,breadcrumb-trail,view-as}.test.ts` | The `buildSections` gate matrix, the four crumb families, and the bounce rule — all node-environment, no router, no i18next                                                                                                                                                      |

**Admin page suites render under a `BrowserRouter`, not a `MemoryRouter`** — see
[testing.md](./testing.md) §3.4 for why `useGridUrlState` requires it.

## 7. Console conventions, and what closed the two open items

**The Status column badges BOTH states, on every console table** (R2 W3.5). A
live row gets a `soft-success` "Live", an archived row a `soft-danger` "Archived"
whose `title` carries the date, and an archived row is additionally muted with
`opacity-60`. `/admin/orgs` always did this; `/admin/projects` rendered `null`
for a live row, so most of the table was blank under a header that promises a
value — which reads as data that failed to load, not as an answer. Both pages now
follow the one convention, both cells have tests, and the Projects column carries
an `accessor` so it can be sorted (gathering the archived rows together is the
reason anybody sorts a Status column).

**The telemetry events feed names the project** (R2 W3.5). It rendered the raw
`projectId` UUID one column away from a User cell that already showed a name.
`telemetryEventRowSchema` now carries a nullable `projectName`, joined LEFT in
`admin-telemetry.service` — LEFT because `project_id` is nullable by design, so
an inner join would delete every platform-level event from an audit feed. The id
is untouched in the payload: the feed's project filter takes it, the cell hovers
it, and the CSV gives it its own column.

## Related docs

- [analytics.md](./analytics.md) — the four analytics dashboards and the
  drill-down that share this console's shell.
- [auth.md](./auth.md) — the token model, `tokenVersion`, and the role
  resolution chain `requireGlobalAdmin` sits at the top of.
- [database.md](./database.md) — `instance_settings`, the soft-delete set, and
  why users are anonymized rather than deleted.
- [architecture.md](./architecture.md) — router mounting order, the layering
  rule, and the `{success,data,meta?,error?}` envelope these endpoints use.
- [design-system.md](./design-system.md) — the dashboard kit the console pages
  are built from.
- [i18n.md](./i18n.md) — the `admin` namespace, and the nav/breadcrumb typed-key
  modules.

Back to [docs/INDEX.md](./INDEX.md) · [.agents/INDEX.md](../INDEX.md)
