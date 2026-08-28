# Auth & Permissions

How a FlowBoard session is born, proven, revoked and scoped: the JWT pair and
`tokenVersion`, the `AuthProvider` seam that a directory backend swaps into, the
invite flow, the three-level role chain, and the browser half of all of it. Read
it before touching any endpoint, guard, socket handshake, or anything shaped like
a permission.

## 1. The token model

### 1.1 The pair

`POST /api/auth/login` answers a matched **access + refresh** pair, minted
together in `signTokenPair()` (`apps/api/src/services/auth.service.ts`) from a
freshly-read `UserRow`. There is **no server-side session store** — a token is
believed because it verifies, and disbelieved because the row it names moved on.

| Half      | TTL source              | Default | Secret               | Where it is used                          |
| --------- | ----------------------- | ------- | -------------------- | ----------------------------------------- |
| `access`  | `env.ACCESS_TOKEN_TTL`  | `15m`   | `JWT_SECRET`         | `Authorization: Bearer`, socket handshake |
| `refresh` | `env.REFRESH_TOKEN_TTL` | `30d`   | `JWT_REFRESH_SECRET` | `POST /api/auth/refresh` body only        |

Both are `HS256`. The TTL strings are `ms`-style durations validated by
`durationSchema` in `apps/api/src/config/env.ts` and converted to whole seconds
by `parseDuration()` (`apps/api/src/utils/jwt.ts`), which also exports
`accessTokenTtlSeconds` / `refreshTokenTtlSeconds`.

**Never sign both halves with one secret.** `sign()` picks `JWT_SECRET` for an
access token and `JWT_REFRESH_SECRET` for a refresh token, so a leaked access
secret cannot mint 30-day sessions. The `type` claim is the second belt: `verify()`
takes the expected type and `toPayload()` rejects any mismatch, so a refresh token
replayed as a Bearer credential fails on both the secret and the claim.

### 1.2 Claims

`TokenPayload` (`apps/api/src/utils/jwt.ts`), mirrored by
`accessTokenPayloadSchema` in `packages/shared/src/auth.schema.ts`:

| Claim           | Source                  | Why it is in the token                                             |
| --------------- | ----------------------- | ------------------------------------------------------------------ |
| `sub`           | `users.id` (uuid)       | The identity; stamped via jsonwebtoken's `subject` option.         |
| `tokenVersion`  | `users.token_version`   | The revocation lever — see §1.3.                                   |
| `isGlobalAdmin` | `users.is_global_admin` | A **cache**, so admin routes need no lookup to reject a non-admin. |
| `type`          | literal                 | `'access'` \| `'refresh'`.                                         |
| `iat` / `exp`   | jsonwebtoken            | Stamped on sign; optional on the way in.                           |

Nothing richer belongs here. `AuthenticatedUser` (`apps/api/src/types/auth.ts`) is
exactly these three fields plus nothing, and its doc comment says why: **anything
that needs the email, the name or a membership is a service call, not a claim.**

### 1.3 `tokenVersion` — the entire revocation mechanism

Every token carries the `token_version` it was minted with.
`bumpTokenVersion()` (`apps/api/src/services/auth/user-lookup.ts`) issues
`SET token_version = token_version + 1` **computed inside the statement**, never
read-then-written, so a concurrent password change and force-revoke both land.

Four operations bump it. All four were verified against shipped code:

| Operation                                                             | File                                                | Mechanism                                                               |
| --------------------------------------------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------- |
| `POST /auth/logout?all=true`                                          | `services/auth.service.ts` → `logout()`             | `loadLiveUser` then `bumpTokenVersion`. Without `?all` it is a no-op.   |
| `POST /auth/change-password`                                          | `services/auth.service.ts` → `changePassword`       | Bumps, then mints a fresh pair from the bumped row.                     |
| `PATCH /admin/users/:userId` (`isActive:false` or `forceLogout:true`) | `services/admin-users.service.ts` → `updateUser`    | `revokeSessions` is the OR of the two; both flags collapse to one bump. |
| `POST /admin/users/:userId/reset-password`                            | `services/admin-users.service.ts` → `resetPassword` | Hash write + bump in one `withTx`.                                      |

Where the version is actually **checked** is deliberately uneven:

| Door                                                        | Checked? | Where                                                    |
| ----------------------------------------------------------- | -------- | -------------------------------------------------------- |
| `requireAuth`                                               | **No**   | `middlewares/require-auth.ts` — signature only, no I/O.  |
| `requireOrgRole` / `requireProjectRole`                     | **Yes**  | `assertSessionLive()` in `middlewares/require-roles.ts`. |
| `/auth/me`, `/auth/refresh`, change-password, invite attach | **Yes**  | `loadLiveUser()` in `services/auth/user-lookup.ts`.      |
| Socket handshake                                            | **Yes**  | `authenticate()` in `sockets/io.ts` — see §6.            |

**Do not add a `SELECT` to `requireAuth`.** It would put a database round-trip in
front of every request to shorten a 15-minute window that the role guards already
close for free — they read the user row anyway. The socket is the exception
because a connection outlives the request that opened it.

`loadLiveUser(userId, tokenVersion)` throws **401 `unauthorized` / "Session has
been revoked"** when the row is missing, `isActive === false`, or the version
disagrees. **One message for all three** — which of them happened is not the
client's business.

### 1.4 Rotation on refresh

`refresh()` verifies the refresh token, re-reads the row through `loadLiveUser`,
and returns a **new pair — both halves**. The spent refresh token is _not_
denylisted (there is no store to deny it in); the account state re-read is what
kills a stolen one the moment the real user changes their password or an admin
revokes. See §7.1 for why the client must funnel concurrent refreshes through one
promise.

### 1.5 Password hashing

`apps/api/src/utils/password.ts` uses **Node's built-in `crypto.scrypt`** — zero
new dependencies for a security-critical primitive. Parameters: `N = 16384`,
`r = 8`, `p = 1`, 64-byte key, 16-byte salt. The stored value is self-describing:

```text
scrypt$N$r$p$<salt base64url>$<hash base64url>
```

`verifyPassword` reads the parameters back out of the string and finishes with
`timingSafeEqual`, so raising the cost later applies to newly written hashes only
and needs no migration. **Never hand-roll a comparison** — a `===` on the derived
key is a timing oracle.

> Contract note: `passwordSchema` in `packages/shared/src/users.schema.ts` is
> `min(8).max(128)` and its comment still says "on its way to bcrypt". The API
> hashes with scrypt. The 128 ceiling is the live rule; the bcrypt sentence is
> stale prose, not a second implementation.

## 2. The `AuthProvider` seam

This is the headline section. **Never call password logic from a controller or a
route** — the only credential check in the codebase goes through `AuthProvider`,
which is FlowBoard's designated LDAP / Active-Directory swap point.

### 2.1 The interface, verbatim

`apps/api/src/services/auth/auth-provider.ts`:

```ts
export interface AuthProvider {
  readonly id: string;
  readonly supportsPasswordChange: boolean;
  verifyCredentials(email: string, password: string): Promise<UserRow | null>;
}
```

Three members, and each carries a rule:

| Member                   | Contract                                                                                                                                                                                                                                                   |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `id`                     | Stable identifier stamped on the `auth_login` telemetry event, so a mixed local/LDAP rollout can be charted.                                                                                                                                               |
| `supportsPasswordChange` | `false` when the directory owns the password. `changePassword()` then throws **400** "Passwords are managed by your organization directory" instead of writing a hash nothing will read.                                                                   |
| `verifyCredentials`      | Returns the `UserRow`, or `null` for **every** failure — unknown address, wrong password, deactivated account. It **must not throw** for a bad credential; a throw means the provider itself is broken (directory unreachable), which is a 5xx, not a 401. |

It returns a **row, not a boolean**, so a provider that resolves the account
itself (a directory lookup, a case-folded match) does not force the service into a
second query.

### 2.2 `LocalAuthProvider` — the reference implementation

`apps/api/src/services/auth/local-auth.provider.ts`, exported as the singleton
`localAuthProvider`. `id = 'local'`, `supportsPasswordChange = true`.

`verifyCredentials` does three things, in this order:

1. `findUserByEmail(email)` — case-insensitive, `lower(email)`, because
   `users_email_lower_unique` is a functional index (§4 and
   `apps/api/src/db/schema/users.ts`).
2. **When no row matches, it still runs a scrypt verification against a decoy
   hash** (`getDecoyHash()`, computed once, lazily). Without it "unknown address"
   answers in microseconds while "wrong password" pays the full KDF cost — a
   remotely measurable account-enumeration oracle that the rate limiter slows but
   does not close.
3. `verifyPassword` **before** the `isActive` test, so a deactivated account pays
   the same KDF cost as everyone else. Returns `null` if either fails.

### 2.3 Where the provider is selected

`apps/api/src/services/auth.service.ts` holds a module-level binding:

```ts
let provider: AuthProvider = localAuthProvider;
export function setAuthProvider(next: AuthProvider | null): void;
export function getAuthProvider(): AuthProvider;
```

`setAuthProvider(null)` restores the local provider — that is what the route
suites in `apps/api/src/routes/__tests__/` use to reset between cases. Today
**nothing in production code calls `setAuthProvider`**; the default binding is the
whole configuration. A module binding rather than constructor injection is
deliberate: `auth.service` is imported by controllers as a module, and threading a
container through four layers to swap one method buys nothing.

### 2.4 Recipe — adding an `LdapAuthProvider`

Follow these steps in order. Everything outside step 1 and step 4 is a file you
**do not touch**.

1. **Write the provider.** New file `apps/api/src/services/auth/ldap-auth.provider.ts`,
   a class implementing `AuthProvider`:
   - `readonly id = 'ldap'` — it lands in telemetry, so make it stable.
   - `readonly supportsPasswordChange = false` — the directory owns the password,
     and `changePassword()` already reads this flag and returns the right 400.
   - `verifyCredentials(email, password)`:
     a. Bind against the directory with the supplied credentials.
     b. On a bind failure return `null`. **Do not throw.**
     c. On success, resolve the local `users` row: `findUserByEmail(email)` from
     `services/auth/user-lookup.ts`; if there is none, INSERT one (the local row
     is what memberships, activity rows and comments hang off — the directory
     has no opinion about any of it). Give it a random unusable
     `password_hash`; nothing will ever verify against it.
     d. Return `null` when `row.isActive === false`, exactly like the local
     provider, so the login endpoint still cannot be used to enumerate.
     e. Return the `UserRow`.
   - Directory-unreachable is the one case that **should** throw — that is a 5xx.
2. **Add its configuration to `apps/api/src/config/env.ts`.** Every
   `process.env` read in the API goes through that zod schema and nowhere else, so
   a missing `LDAP_URL` must fail at boot, not at the first login.
3. **Export a singleton** from the new file the way `localAuthProvider` is
   exported, so the composition root imports a value, not a constructor.
4. **Wire it in the composition root** — `apps/api/src/bootstrap.ts`, the only
   place injection points are wired (`setTelemetrySink`, `setRequestLogSink`,
   `setSocketUserResolver`, `setDbHealthChecker` all live there). Add
   `setAuthProvider(ldapAuthProvider)` behind whatever env flag step 2 defined.
   `bootstrap()` is called once by `server.ts` before it listens, and deliberately
   _not_ by `app.ts`, so supertest keeps building the app without a directory.
5. **Add a unit suite** beside the provider covering: bind failure → `null`,
   unknown user → row created, inactive row → `null`, directory error → throws.
6. **Update the login-page error map if — and only if — the new provider can
   distinguish a disabled account.** `ERROR_KEYS` in
   `apps/web/src/pages/LoginPage.tsx` already reserves `account_disabled` for
   exactly this; its comment says it is unreachable through `LocalAuthProvider`.

Files that change: **two new** (`ldap-auth.provider.ts`, its test) and **two
edited** (`config/env.ts`, `bootstrap.ts`). That is the whole diff.

### 2.5 What must NOT change

`auth.service.ts`'s own doc comment draws the line, and the line is the point of
the seam:

- **Token minting** (`signTokenPair`, `utils/jwt.ts`) stays FlowBoard's. A
  directory server has no opinion about our JWT claims.
- **`tokenVersion` revocation** stays FlowBoard's. LDAP cannot revoke our tokens.
- **Org / project role resolution** (`middlewares/require-roles.ts`) stays
  FlowBoard's. Group-to-role mapping, if it is ever wanted, belongs in the
  provider's row-upsert step — not in the guards.
- **The `null`-for-every-failure contract.** A provider that returns a reason
  turns `POST /auth/login` into an account directory.
- **`utils/jwt.ts` must stay unreachable from a provider.** The seam deliberately
  does not import it.

## 3. Endpoint reference

Every body, query and param below is zod-parsed by `validate(schema, part)`; a
parse failure is **422 `validation_error`**. Responses are the standard
`{ success, data, meta?, error? }` envelope
(`apps/api/src/utils/respond.ts`).

### 3.1 `/api/auth` — `apps/api/src/routes/auth.routes.ts`

| Method  | Path                     | Guard          | Rate limit      | Request schema                                       | Returns (200 unless noted)                                  | Notable errors                                                                  |
| ------- | ------------------------ | -------------- | --------------- | ---------------------------------------------------- | ----------------------------------------------------------- | ------------------------------------------------------------------------------- |
| `POST`  | `/login`                 | public         | `authRateLimit` | `loginInputSchema` (body)                            | `loginResponseSchema` — `{user, accessToken, refreshToken}` | 401 `invalid_credentials`                                                       |
| `POST`  | `/refresh`               | public         | `authRateLimit` | `refreshInputSchema` (body)                          | `refreshResponseSchema` — the rotated pair                  | 401 `unauthorized` / `token_expired`                                            |
| `POST`  | `/logout`                | `requireAuth`  | —               | `logoutQuerySchema` (query)                          | `logoutResponseSchema` — `{revokedAll}`                     | 401                                                                             |
| `GET`   | `/me`                    | `requireAuth`  | —               | —                                                    | `meResponseSchema` — `{user, memberships, isGlobalAdmin}`   | 401 (revoked)                                                                   |
| `PATCH` | `/me`                    | `requireAuth`  | —               | `updateMeInputSchema` (body)                         | `userSchema`                                                | 401, 404                                                                        |
| `POST`  | `/change-password`       | `requireAuth`  | `authRateLimit` | `changePasswordInputSchema` (body)                   | `loginResponseSchema` — a **fresh pair**                    | 400 wrong current / same-as-new / provider-managed                              |
| `GET`   | `/invites/:token`        | public         | `authRateLimit` | `inviteTokenParamSchema` (params)                    | `invitePreviewSchema`                                       | 404 not found                                                                   |
| `POST`  | `/invites/:token/accept` | `optionalAuth` | `authRateLimit` | `inviteTokenParamSchema` + `acceptInviteInputSchema` | **201** `acceptInviteResponseSchema`                        | 400 expired / 409 already accepted / 401 attach-without-token / 403 wrong email |

`authRateLimit` on `/change-password` is mounted **before** `requireAuth`, so it
keys by IP (§8). Rate limiting is per-route, not router-wide, on purpose:
`GET /me` is hit on every navigation and must not share the brute-force budget.

`optionalAuth` is a local handler in `auth.routes.ts`: it attaches `req.user` when
a Bearer token is present and **still fails loudly on a malformed or expired one**.
Silently treating a bad token as anonymous would turn an expired session into a
surprise second account.

### 3.2 `/api/orgs/:orgId/invites` — `apps/api/src/routes/invites.routes.ts`

Router-wide `requireAuth, requireOrgRole('admin')`. `Router({ mergeParams: true })`
is load-bearing — `:orgId` belongs to the mount path.

| Method   | Path         | Request schema                                      | Returns                                   | Notable errors                              |
| -------- | ------------ | --------------------------------------------------- | ----------------------------------------- | ------------------------------------------- |
| `GET`    | `/`          | `orgInviteParamsSchema` (params)                    | `Invite[]` (pending + accepted < 30 days) | 403, 404 org                                |
| `POST`   | `/`          | `orgInviteParamsSchema` + `createInviteInputSchema` | **201** `Invite`                          | 400 cross-org project, 409 already a member |
| `DELETE` | `/:inviteId` | `orgInviteIdParamsSchema` (params)                  | **204** no content                        | 404, 409 already accepted                   |

### 3.3 `/api/admin/users` — `apps/api/src/routes/admin-users.routes.ts`

Router-wide `requireAuth, requireGlobalAdmin`.

| Method  | Path                      | Request schema                                                 | Returns                      | Notable errors                                          |
| ------- | ------------------------- | -------------------------------------------------------------- | ---------------------------- | ------------------------------------------------------- |
| `GET`   | `/`                       | `adminUserListQuerySchema` (query: `page,pageSize,q,isActive`) | `User[]` + pagination `meta` | 401, 403                                                |
| `POST`  | `/`                       | `provisionUserInputSchema` (body)                              | **201** `User`               | 409 email taken, 400 unknown `orgId`                    |
| `PATCH` | `/:userId`                | `adminUserParamsSchema` + `adminUpdateUserInputSchema`         | `User`                       | 400 self-deactivate / self-demote, 404, 409 email clash |
| `POST`  | `/:userId/reset-password` | `adminUserParamsSchema` + `resetPasswordInputSchema`           | **204** no content           | 404                                                     |

`q` matches name **or** email with `ilike '%q%'` — an admin looking for a person
types a fragment, not a prefix.

### 3.4 Error codes this surface emits

From `ApiError`'s factories (`apps/api/src/utils/api-error.ts`). `code` is stable
API surface; `message` is English prose for logs.

| Status | `code`                | Emitted by                                                                          |
| ------ | --------------------- | ----------------------------------------------------------------------------------- |
| 400    | `bad_request`         | expired invite, wrong current password, self-lockout guards                         |
| 401    | `unauthorized`        | missing/invalid token, revoked session                                              |
| 401    | `invalid_credentials` | `login()` only — its own code so the form can say something specific                |
| 401    | `token_expired`       | `verify()` on a `TokenExpiredError` — the **one** 401 the client refreshes          |
| 403    | `forbidden`           | `requireGlobalAdmin`, `requireOrgRole`, `requireProjectRole`, invite email mismatch |
| 404    | `not_found`           | unknown invite / user / org / project                                               |
| 409    | `conflict`            | email taken, invite already accepted                                                |
| 422    | `validation_error`    | any `validate()` failure                                                            |
| 429    | `rate_limited`        | a tripped limiter (§8)                                                              |

## 4. Invite lifecycle

`apps/api/src/services/invites.service.ts`. Invites are the **only** way an
account is born besides admin provisioning (§9).

### 4.1 Creation

Who: an **org admin** (`requireOrgRole('admin')` on the whole router).
`createInviteInputSchema` (`packages/shared/src/orgs.schema.ts`):

| Field           | Default    | Meaning                                                                           |
| --------------- | ---------- | --------------------------------------------------------------------------------- |
| `email`         | `null`     | The **email lock**. `null` = a shareable link anyone holding it may redeem.       |
| `orgRole`       | `'member'` | The org membership the link always grants.                                        |
| `projectId`     | `null`     | Optional **direct project grant** — "invite a contractor straight into PROJ".     |
| `projectRole`   | `null`     | Required whenever `projectId` is set (`.refine` in the schema, and a DB `CHECK`). |
| `expiresInDays` | `7`        | 1–90. `expiresAt = now + days`.                                                   |

The token is `randomBytes(24).toString('base64url')` — **192 bits of CSPRNG
entropy, 32 URL-safe characters**. `createInvite` rejects a `projectId` belonging
to another org (or a deleted one) with 400: a cross-org grant would be privilege
escalation dressed as a typo. It rejects an already-member address with 409.

### 4.2 Preview vs accept

**`GET /api/auth/invites/:token` never consumes anything.** It is the
unauthenticated landing-page read, and `invitePreviewSchema` **carries no ids by
contract** — a stranger holding a leaked token learns the org's name and who
invited them, and nothing they could address a row with:

`{ orgName, orgRole, projectName, projectRole, invitedByName, email, expiresAt, requiresAccount, status }`

`requiresAccount` decides which form `apps/web/src/pages/InvitePage.tsx` renders:
signup, or the one-button "join as you" attach. An unlocked link cannot know, so
it defaults to `true`. Expired and accepted links **still preview** (200 with a
`status`) — the page has to be able to say _why_ it is not offering a form.

`POST /api/auth/invites/:token/accept` is the consuming half, with two modes
(`acceptInviteInputSchema`, a discriminated union on `mode`):

| Mode         | Caller            | Body                                 | Rule                                                                                                                                                                  |
| ------------ | ----------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `'register'` | anonymous visitor | `name`, `password`, optional `email` | **Refuses a Bearer token** (400). `email` is read **only** when the invite is unlocked; supplying one that disagrees with the lock is a 400, never a silent override. |
| `'attach'`   | signed-in user    | nothing                              | **Requires** a Bearer token (401 without). 403 when the caller's email differs from the lock.                                                                         |

Both modes answer the **same shape** — `acceptInviteResponseSchema`, a login
response plus `orgId` / `projectId`. `attach` gets a fresh pair too, and that is
not redundancy: the caller's access token was minted _before_ this org grant.

### 4.3 What accept creates, and single-use semantics

`acceptAsNewAccount` runs inside one `withTx`: insert the `users` row, then
`grantMemberships` (an `orgMembers` row at `orgRole`, plus a `projectMembers` row
when the invite carried a grant — both `onConflictDoNothing`), then
`consumeInvite`.

**Single use is enforced by the database, not by application code.**
`consumeInvite` is a _conditional_ update:

```sql
UPDATE invites SET accepted_at = now(), accepted_by_id = $user
 WHERE id = $invite AND accepted_at IS NULL RETURNING id
```

Zero rows returned ⇒ **409**. Checking `acceptedAt` first and updating second
would let a double-click through twice. The same posture covers the email race:
`users_email_lower_unique` is the arbiter and `isUniqueViolation(error)`
(`services/pg-errors.ts`, which walks the Drizzle `cause` chain) turns the loser
into a 409 instead of a 500.

Revocation (`DELETE`) is a **hard delete**: an unspent invite is a credential, and
the right way to store a revoked credential is not at all. An already-accepted row
refuses deletion with 409 — it is the audit trail of how someone got in.

## 5. Role resolution chain

**global admin ⊃ org admin ⊃ org member ⊃ project admin / member / viewer.**

### 5.1 The chain, as code

`resolveProjectRole(user, {projectId, orgId})` in
`apps/api/src/middlewares/require-roles.ts` — exported, because sockets need the
same answer outside a request:

1. `user.isGlobalAdmin` → `'admin'`, no lookup.
2. `findOrgRole(user.id, orgId) === 'admin'` → `'admin'` (an org admin is an
   implicit admin of every project in the org).
3. otherwise the explicit `project_members.role`, or `null` for no access.

Ranks are `ORG_ROLE_RANK = {member:1, admin:2}` and
`PROJECT_ROLE_RANK = {viewer:1, member:2, admin:3}`. The guard compares ranks, so
a higher role always satisfies a lower floor.

### 5.2 The guard factories

| Guard                                        | File               | Reads         | Attaches                   |
| -------------------------------------------- | ------------------ | ------------- | -------------------------- |
| `requireAuth`                                | `require-auth.ts`  | Bearer header | `req.user`                 |
| `requireGlobalAdmin`                         | `require-auth.ts`  | `req.user`    | —                          |
| `requireOrgRole(minRole)`                    | `require-roles.ts` | `:orgId`      | `res.locals.orgAccess`     |
| `requireProjectRole(minRole, source='auto')` | `require-roles.ts` | see below     | `res.locals.projectAccess` |

`requireGlobalAdmin` **must be mounted after `requireAuth`** — it reads `req.user`
and 401s when it is absent.

`requireProjectRole`'s `source` is a `ProjectIdSource`:
`'projectId' | 'taskId' | 'sprintId' | 'commentId' | 'attachmentId'`. `'auto'`
probes them in that order (`AUTO_SOURCES`); **name one explicitly when a route
carries more than one candidate**. `resolveProjectRef` joins each back to
`{projectId, orgId}`, filtering soft-deleted rows at every hop.

### 5.3 Where the role lands

**Not on `req`.** `req.user` (typed in `apps/api/src/types/express.d.ts`, the one
`declare global` block in the API) holds only what a signature proves:
`{ id, isGlobalAdmin, tokenVersion }`. The **resolved access** lands on
`res.locals` and is read back with the typed helpers:

```ts
getOrgAccess(res); // → { orgId, role: 'admin' | 'member' }
getProjectAccess(res); // → { projectId, orgId, role: 'admin' | 'member' | 'viewer' }
```

Both throw `ApiError.internal` when the matching guard was not mounted, which
turns a wiring bug into a loud 500 rather than a silent permission hole.
**Controllers never re-derive membership** — `invites.controller.ts` reads `orgId`
from `getOrgAccess(res)` rather than `req.params` precisely because the guard
already authorized that value.

### 5.4 The floor mapping

Reads = `viewer`, writes = `member`, settings = `admin`. As mounted today:

| Intent                                         | Guard                                      | Example                                                           |
| ---------------------------------------------- | ------------------------------------------ | ----------------------------------------------------------------- |
| Read a board, a report, an activity feed       | `requireProjectRole('viewer', …)`          | `reports.routes.ts`, `activity.routes.ts`                         |
| Create/edit a task, comment, label, attachment | `requireProjectRole('member', …)`          | `comments.routes.ts`, `attachments.routes.ts`, `labels.routes.ts` |
| Project settings, workflow, project membership | `requireProjectRole('admin', 'projectId')` | `projects.routes.ts`, `project-members.routes.ts`                 |
| Any org read                                   | `requireOrgRole('member')`                 | `orgs.routes.ts`                                                  |
| Org settings, org membership, invites          | `requireOrgRole('admin')`                  | `orgs.routes.ts`, `invites.routes.ts`                             |
| Account admin, telemetry read, server logs     | `requireGlobalAdmin`                       | `admin-users.routes.ts`, `admin-logs.routes.ts`                   |

A missing entity is **404**; an authenticated caller with an insufficient role is
**403**. Existence of orgs and projects is not treated as a secret inside a
company tool — simpler to test and debug than 404-masking.

## 6. Socket handshake and revocation

`apps/api/src/sockets/io.ts`, `authenticate(socket)`:

1. The token is read from **`socket.handshake.auth.token`**, falling back to
   `extractBearerToken(socket.handshake.headers.authorization)`.
2. Absent or unverifiable → `SocketAuthError('Authentication required', 'AUTH_FAILED')`.
   Only an **access** token verifies; `verifyAccessToken` enforces `type`.
3. The user is re-resolved through the injected `SocketUserResolver`
   (`setSocketUserResolver`, wired in `bootstrap.ts` to a
   `select {tokenVersion, isActive} from users` by id).
   - no row, or `isActive === false` → **`ACCOUNT_DISABLED`**
   - `tokenVersion` mismatch → **`AUTH_FAILED`**
4. On success `socket.data` carries `{ userId, isGlobalAdmin, tokenVersion }`, and
   the connection handler joins `userRoom(userId)`.

The two codes are deliberately distinguishable on the wire: after `AUTH_FAILED`
the client should refresh and retry; after `ACCOUNT_DISABLED` it must **stop**.

**With no resolver configured the handshake fails closed in production**
(`AUTH_UNAVAILABLE` + a `logger.error`) and allows-with-a-warning in
dev/test. A foundation module that silently accepted revoked tokens in production
would be a security bug shipped by omission.

What happens to a **live** socket when a user is deactivated: nothing, until it
reconnects. The check runs **once per connection, not once per event** — that is
the trade the design makes. A deactivation therefore takes effect on the next
handshake; the HTTP side is closed immediately by `assertSessionLive` in the role
guards. If a same-instant kick is ever required, the place to add it is a
`users`-domain event that calls `io.in(userRoom(id)).disconnectSockets()` — not a
per-event check.

The browser end (`apps/web/src/lib/socket.ts`) passes the token as an **auth
callback, not an auth object**: `auth: (cb) => cb({ token: tokenProvider() ?? '' })`
is re-invoked on every reconnect attempt, so a socket that dropped while the access
token was expiring reconnects with the token the single-flight refresh has since
written. A static `auth: { token }` would pin the value captured at connect time
and reconnect forever with a token the gateway rejects.

## 7. The client

### 7.1 Single-flight refresh — `apps/web/src/lib/api.ts`

```ts
let refreshInFlight: Promise<boolean> | null = null;

function refreshSession(): Promise<boolean> {
  refreshInFlight ??= performRefresh().finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}
```

Read that precisely, because the whole mechanism is those five lines:

- The **first** caller finds `refreshInFlight === null`, so `??=` assigns the
  promise returned by `performRefresh()`.
- Every **concurrent** caller finds the same promise and returns it — they all
  await one HTTP request, and there is exactly **one rotation**.
- `.finally()` clears the slot **when the shared promise settles**, so the _next_
  expiry starts a new flight rather than replaying this one's outcome forever.
  Clearing inside `performRefresh` instead would reopen the race.

**The race this exists to kill:** a board page fires six queries on mount; if the
access token has just aged out, all six 401 within milliseconds. Six independent
`POST /auth/refresh` calls would each rotate, the first invalidating the token the
other five still hold — five of six log the user out.

`performRefresh` resolves `false` and calls `clearSession()` on **any** failure and
**never throws** — callers are already inside an error path, and a rejection here
would mask the original 401. It hand-checks the two token strings rather than
zod-parsing them: this runs during error recovery, and a schema import failing here
would be the second failure in a row.

The retry is gated on **both** the status and the code:

```ts
if (res.status === 401 && envelope?.error?.code === TOKEN_EXPIRED_CODE) { … }
```

**Only `token_expired` triggers a refresh.** A 401 for a revoked `tokenVersion`, a
tampered token or a deactivated account is terminal — retrying it would spend the
refresh token on a request that can never succeed.

### 7.2 The auth store — `apps/web/src/stores/useAuthStore.ts`

Zustand + `persist`, storage key **`AUTH_STORAGE_KEY = 'fb-auth-v1'`**, in
**`localStorage`**. `partialize` persists exactly three fields:
`accessToken`, `refreshToken`, `user`. Actions are never persisted, and the
explicit allowlist means a future derived field cannot silently join the stored
payload.

The store is **deliberately dumb** — no fetching, no refresh logic, no navigation.
That keeps the dependency arrow one-way: `lib/api.ts` imports the store; the store
imports nothing of the app. Its API: `setSession` (login / invite accept),
`setTokens` (what the refresh writes back), `setUser` (what `/auth/me` and
`PATCH /me` write back, a no-op on an unchanged reference), `clearSession`,
plus the derived `isAuthenticated()` and `isGlobalAdmin()`.

`AuthSession` and `AuthUser` are **aliases** of `LoginResponse` / `User`, not
copies, so a contract change is a compile error here rather than a stored session
that no longer matches the API.

### 7.3 Route guards — `apps/web/src/routes/guards.tsx` + `auth-gate.ts`

Guards are mounted as route **elements**, so the protected subtree is declared once
and a new page cannot forget to opt in. The decision logic is extracted into the
pure, DOM-free `resolveAuthGate({hasToken, hasUser, error})` — the web suite runs
`environment: 'node'`, and four `if`s do not justify booting jsdom.

| Component            | Gate                                                       | Outcome                                                                                                     |
| -------------------- | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| `RequireAuth`        | token **and** `GET /auth/me`                               | `signed-out` / `rejected` → `/login` (stashing `from`); `checking` → `PageSpinner`; `allowed` → `<Outlet/>` |
| `RequireGlobalAdmin` | `me.isGlobalAdmin` when resolved, persisted flag otherwise | in-place `EmptyState` refusal, never a redirect                                                             |
| `PublicOnly`         | token **only**                                             | authenticated visit to `/login` → `/`                                                                       |

**Two checks, not one, in `RequireAuth`.** A token in localStorage proves someone
signed in on this device once; a `tokenVersion` bump revokes it server-side without
touching that copy. The single-flight refresh handles "expired while working"; this
guard handles "expired while away". Clearing happens in a `useEffect`, never during
render.

`isSessionRejection` treats **401 and 403** as terminal and everything else —
a 500, a dropped connection — as `allowed`. **Signing someone out because their
wifi blinked is hostile**, and a genuinely dead session surfaces on the next
request anyway.

`RequireGlobalAdmin` is **chrome, not a security boundary**. Every admin endpoint
re-checks with `requireGlobalAdmin`, so a tampered store buys a page full of failed
requests.

### 7.4 Logout paths

| Path                       | Where                                | What it does                                                                          |
| -------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------- |
| User clicks sign out       | `Topbar.tsx` → `useLogout()`         | `POST /auth/logout`, then `clearSession()` + `queryClient.clear()` in **`onSettled`** |
| Sign out everywhere        | `useLogout().mutate({ all: true })`  | `?all=true` → server bumps `token_version`                                            |
| `/auth/me` returns 401/403 | `guards.tsx` → `endSessionLocally()` | store + module-scope query client cleared, no request                                 |
| Refresh definitively fails | `lib/api.ts` → `performRefresh()`    | `clearSession()`                                                                      |

**The local teardown is unconditional.** It runs in `onSettled`, not `onSuccess`:
the user asked to sign out, and an app that stays signed in because a request 500'd
is a security surprise. `queryClient.clear()` rather than `invalidateQueries` —
every cached row belongs to the account that is leaving.

> **Known gap, documented rather than papered over.** `POST /auth/change-password`
> returns a fresh pair (the service bumps `token_version` and re-mints), but
> `useChangePassword` in `apps/web/src/hooks/useAuth.ts` types the response as
> `void` and stores nothing. The tab that changed the password therefore keeps a
> token whose `tokenVersion` is now stale, and the next role-guarded request or
> `/auth/me` refetch 401s it out. Fixing it is one line — parse
> `loginResponseSchema` and `setSession(...)` in `onSuccess`.

## 8. Rate limits

`apps/api/src/middlewares/rate-limit.ts`, `express-rate-limit` v8. A tripped
limiter **does not write its own body**: it forwards `ApiError.tooManyRequests()`
to `next()` so the single `errorHandler` renders the envelope.

| Limiter            | Window | Limit | Keyed by    | Mounted on                                                                            |
| ------------------ | ------ | ----- | ----------- | ------------------------------------------------------------------------------------- |
| `defaultRateLimit` | 60 s   | 300   | user-or-IP  | the whole `/api` mount (`app.ts`)                                                     |
| `authRateLimit`    | 60 s   | 10    | **IP only** | `/login`, `/refresh`, `/change-password`, `/invites/:token`, `/invites/:token/accept` |

**Credential endpoints key by IP only, on purpose.** If they keyed by user, an
attacker holding _any_ valid Bearer token could attach it to login attempts against
a victim's email and mint a private counter per token, sidestepping the shared
ceiling entirely (`keyByIpOnly` vs `keyByUserOrIp`).

IPv6 is collapsed to its `/56` subnet through `ipKeyGenerator` — a single IPv6
host is handed billions of addresses, and a per-address counter is no limit at all.
`app.set('trust proxy', 1)` — **`1`, never `true`**: trusting every hop lets a
client forge `X-Forwarded-For` and mint a fresh bucket per request.

Under `NODE_ENV=test` `auth.routes.ts` swaps `authRateLimit` for a pass-through
(`publicAuthLimit`): every test request comes from one loopback address, so a
thirty-case suite would spend its last twenty asserting 429s. The limiter's own
behaviour is `rate-limit.ts`'s to prove.

> ⚠️ **Scaling boundary.** Counters live in the in-process `MemoryStore`, so two
> API replicas mean two independent sets and up to N× the advertised limit — which
> matters most for `authRateLimit`, since that _is_ the brute-force ceiling.
> Horizontal scaling swaps `rate-limit-redis` in through `makeRateLimit`'s
> `overrides`; nothing else changes.

## 9. No self-registration — do not add one

**There is no public sign-up endpoint, and adding one is out of scope
permanently.** An account is born exactly two ways:

1. A global admin provisions it — `POST /api/admin/users`.
2. Somebody redeems an invite link — `POST /api/auth/invites/:token/accept` with
   `mode: 'register'`, which requires a token an org admin minted.

Both doors go through `services/auth/user-lookup.ts`, which is why the
`lower(email)` lookup lives there rather than in each service: a login that folds
case and an invite that does not means one address, two accounts.

`apps/web/src/pages/LoginPage.tsx` therefore shows a plain "ask an administrator"
line and **no sign-up link** — the page must not offer a route that does not exist.
Accounts are also **never deleted**: activity rows, comments and attachments must
keep pointing at a real person, so `is_active = false` plus a `token_version` bump
_is_ the delete (`services/admin-users.service.ts`). And an admin cannot lock
themselves out — self-deactivation and self-demotion are both refused with 400,
because recovering from either needs another global admin or a database console.

Back to [docs/INDEX.md](./INDEX.md) · [.agents/INDEX.md](../INDEX.md)
