# .agents — Master Router

This is the entry point for every agent working on FlowBoard. Read
[`../CLAUDE.md`](../CLAUDE.md) for the hard rules and [`../AGENTS.md`](../AGENTS.md)
for the quickstart, then use the table below to jump to what you need.

Every folder listed here has its own `INDEX.md` describing each file inside it.

## Where to go

| I want to…                                                                                        | Read                                                                                                             |
| ------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Understand the monorepo layout, the request lifecycle, the layering rule and its three exceptions | [docs/architecture.md](./docs/architecture.md)                                                                   |
| Follow naming, the no-`any` gate, zod-at-boundaries, or the trio every mutation owes              | [docs/coding-standards.md](./docs/coding-standards.md)                                                           |
| Find a `fb-*-v1` storage key, or register a new one                                               | [docs/coding-standards.md](./docs/coding-standards.md) → the storage-key registry                                |
| Style anything, find a token, or hand-copy a shadcn primitive                                     | [docs/design-system.md](./docs/design-system.md)                                                                 |
| Know whether a colour literal is allowed in a file                                                | [docs/design-system.md](./docs/design-system.md) → the hex-literal exemption table                               |
| Touch the Drizzle schema, indexes, soft delete, or the seed                                       | [docs/database.md](./docs/database.md) + [workflows/db-migration.md](./workflows/db-migration.md)                |
| Work on login, refresh, invites, `tokenVersion`, or the role matrix                               | [docs/auth.md](./docs/auth.md)                                                                                   |
| Swap the auth backend for LDAP/AD                                                                 | [docs/auth.md](./docs/auth.md) → the `AuthProvider` seam                                                         |
| **Add a translated string** or change user-facing copy                                            | [workflows/add-translated-string.md](./workflows/add-translated-string.md) → then [docs/i18n.md](./docs/i18n.md) |
| Make a layout work right-to-left, or check whether a physical property is sanctioned              | [docs/i18n.md](./docs/i18n.md) → RTL mechanics + the exception table                                             |
| Add a REST endpoint                                                                               | [workflows/add-api-endpoint.md](./workflows/add-api-endpoint.md)                                                 |
| Build a new page or view                                                                          | [workflows/add-view.md](./workflows/add-view.md)                                                                 |
| Broadcast a change to other clients                                                               | [workflows/add-socket-event.md](./workflows/add-socket-event.md) + [docs/realtime.md](./docs/realtime.md)        |
| Notify someone when something happens                                                             | [workflows/add-notification-trigger.md](./workflows/add-notification-trigger.md)                                 |
| Understand why an optimistic drag does not double-apply                                           | [docs/realtime.md](./docs/realtime.md) → echo suppression                                                        |
| Emit a telemetry event or build an admin analytics chart                                          | [docs/telemetry.md](./docs/telemetry.md)                                                                         |
| Touch the log ring buffer, `/api/admin/logs`, or the diagnostics drawer                           | [docs/diagnostics.md](./docs/diagnostics.md)                                                                     |
| Write or run tests (unit, supertest integration, Playwright e2e)                                  | [docs/testing.md](./docs/testing.md)                                                                             |
| Know my role, model, must-read docs, and definition-of-done as a subagent                         | [subagents/INDEX.md](./subagents/INDEX.md)                                                                       |
| Verify FlowBoard against its spec                                                                 | [checklists/project-checklist.md](./checklists/project-checklist.md)                                             |
| Review someone else's code                                                                        | [checklists/review-checklist.md](./checklists/review-checklist.md)                                               |
| Learn what the product actually does, screen by screen                                            | [../docs/features-tour.md](../docs/features-tour.md)                                                             |
| Get the stack running on a fresh machine                                                          | [../README.md](../README.md) + [../docs/docker-guide.md](../docs/docker-guide.md)                                |

## Folder map

| Folder                                 | Purpose                                                                                                                                                                               |
| -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`docs/`](./docs/INDEX.md)             | Reference documentation: architecture, coding standards, design system, database, auth, i18n, diagnostics, telemetry, realtime, testing. **What is true**, verified against the code. |
| [`workflows/`](./workflows/INDEX.md)   | Step-by-step procedures for the six multi-file tasks that are easy to get wrong. **What to do**, in order, with a checklist.                                                          |
| [`checklists/`](./checklists/INDEX.md) | The master project checklist (the verification backbone) and the reviewer checklist. **What to prove**, with evidence.                                                                |
| [`subagents/`](./subagents/INDEX.md)   | Role cards: mission, model/effort, must-reads, file ownership, definition-of-done. **Who does what**, and with which model.                                                           |

## Conventions for this tree

- **Docs describe shipped reality.** Every path, identifier, endpoint, and token
  name in these files was read out of the code. If a doc and the code disagree,
  **the code wins and the doc is the bug** — fix it in the same change, do not
  work around it.
- **Every folder has an `INDEX.md`** listing one line per child (what it is +
  when to read it). Add a row when you add a file; add an `INDEX.md` when you add
  a folder.
- **Back-link to the parent index** at the bottom of every file, so a reader who
  lands deep can always navigate up.
- **Docs are written for an agent, not a blog.** Say what the rule is, why it
  exists, and where the code lives. Prefer a table or a numbered recipe over
  prose.
- **Exemption tables are closed sets.** The hex-literal list in `design-system.md`
  and the physical-property list in `i18n.md` are the enforcement contract a
  reviewer checks against. Being on one is not a finding; adding to one without a
  stated reason is.
- **Keep docs and code in the same change.** A change that adds a feature updates
  the doc that describes it and, where it verifies something, its row in
  [checklists/project-checklist.md](./checklists/project-checklist.md).

## How this repo was built

FlowBoard was built by parallel subagents across six sequential waves, each wave
a gate that required `pnpm build lint typecheck test` green before the next
started. Packages within a wave owned **disjoint paths**, and each wave ended with
a sequential integration pass that owned the stitch files.

That history explains three things you will otherwise find odd, and all three are
still load-bearing:

- **The domain-events bus** (`apps/api/src/utils/domain-events.ts`) exists so that
  realtime and notifications could be written in a later wave without ever
  editing a service file. It still means those features can change independently.
- **`apps/web/src/components/ui/*` is frozen** because seven view agents each
  "improving" `Button` in parallel would have been unrecoverable. It stays frozen
  because those primitives now render every screen in the product.
- **The stitch files** (`apps/api/src/routes/index.ts`,
  `apps/web/src/routes/index.tsx`, `apps/web/src/locales/{en,ar}/index.ts`,
  `apps/web/src/lib/query-keys.ts`, `packages/shared/src/index.ts`) are still the
  files two parallel agents will collide on. Request an entry rather than editing
  one mid-flight.

The build is complete: the tree carries no `TODO(wave-N)` markers, and an
unticked checklist box means "not yet verified with evidence", never "not yet
built".
