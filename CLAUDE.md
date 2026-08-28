# FlowBoard — read AGENTS.md first

This file exists so agents land here first. The real routing lives in
**[AGENTS.md](./AGENTS.md)**, which points into the `.agents/` documentation
tree (start at [`.agents/INDEX.md`](./.agents/INDEX.md)).

FlowBoard is a pnpm + Turborepo monorepo: a **Jira-like project-management web
app** — multi-org, Kanban / backlog / roadmap / table / calendar / reports,
custom per-project workflows, realtime collaboration, Arabic + RTL, and a
Linear-style dark-first design system.

## Hard rules (non-negotiable)

- **pnpm only. Never `npm` or `yarn`.** They ignore the workspace protocol and
  the catalog and will corrupt the hoisted `node_modules`. Node `>= 22`; the
  package manager is pinned via `packageManager` in the root `package.json`
  (`pnpm@11.x`). Target a workspace with `pnpm --filter @flowboard/<pkg> <script>`.
  → [AGENTS.md § Quickstart](./AGENTS.md)
- **Never run the shadcn CLI.** Tailwind v4 is CSS-first (there is no
  `tailwind.config.js`) and `shadcn add` cannot read our token layer, so it
  rewrites styles it does not understand. Copy the primitives into
  `apps/web/src/components/ui/` **by hand** on unified `radix-ui`.
  → [.agents/docs/design-system.md](./.agents/docs/design-system.md)
- **LF line endings everywhere.** Enforced by `.gitattributes`
  (`* text=auto eol=lf`); the API and web images are built on Linux, where a CRLF
  in a script or entrypoint is a runtime failure. On Windows keep
  `git config core.autocrlf false`.
  → [.agents/docs/coding-standards.md](./.agents/docs/coding-standards.md)
- **No `any` — lint-enforced.** `@typescript-eslint/no-explicit-any` is `error`
  in the base config, because `any` silently disables the type system exactly at
  the boundaries where FlowBoard's bugs are cheapest to catch. Use `unknown` plus
  a zod parse, or a real generic. There is no approved escape hatch.
  → [.agents/docs/coding-standards.md](./.agents/docs/coding-standards.md)
- **Validate every cross-boundary payload with zod from `@flowboard/shared`.**
  HTTP request/response bodies, socket event payloads, and web form inputs all
  parse against the shared schemas, so a contract change breaks the build instead
  of production. Responses always use the `{success,data,meta?,error?}` envelope.
  → [.agents/docs/architecture.md](./.agents/docs/architecture.md)
- **Respect the layering: `routes → controllers → services → db`.** A controller
  that touches Drizzle directly makes the operation impossible to reuse inside a
  transaction — and every FlowBoard mutation is a transaction that also writes
  its activity row. (Telemetry and the domain event fire _after_ the commit, on
  purpose: a broadcast must never be able to roll back a task move.) There are
  exactly three sanctioned exceptions, all documented — `sockets/socket-reads.ts`,
  `bootstrap.ts` and `middlewares/require-roles.ts` (the guards resolve
  resource→project→membership _before_ a controller runs; a service detour would
  put a service above the middleware layer). Do not add a fourth.
  → [.agents/docs/architecture.md](./.agents/docs/architecture.md)
- **Every user-facing string goes through i18next.** FlowBoard ships English and
  Arabic with full RTL; a hardcoded string is a string that can never be
  translated and a layout that can never mirror. Use logical Tailwind utilities
  (`ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-`), never `ml-`/`pr-`/`left-`.
  → [.agents/docs/i18n.md](./.agents/docs/i18n.md)
- **Colours live in `apps/web/src/index.css` and the theme presets — nowhere
  else.** A hex literal in a component cannot follow the Theme Studio or the
  light/dark switch. Charts read `--chart-*` only. The handful of files that
  legitimately hold a colour literal (persisted label/status colours, the colour
  input's fallback, the example hex inside a validation message) are enumerated
  as a closed exemption table in design-system.md — if your file is not on it,
  you may not add one.
  → [.agents/docs/design-system.md](./.agents/docs/design-system.md)
- **Subagent model policy:** execution subagents run **Opus 4.8 (high effort)**;
  read / verify / review subagents run **Sonnet 5** (effort chosen per task).
  **Never Haiku.** Cheap models produce plausible code that fails the checklist,
  which costs more than it saves.
  → [.agents/subagents/INDEX.md](./.agents/subagents/INDEX.md)
- **Workspace layout is fixed** (`node-linker=hoisted` in `.npmrc`) — it avoids
  Windows symlink/junction breakage and keeps Vite's dependency scanner sane. Do
  not switch to the isolated linker.

For quickstart commands and the full documentation map, go to
**[AGENTS.md](./AGENTS.md)**.
