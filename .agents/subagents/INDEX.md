# subagents — Role Cards

FlowBoard was built by parallel subagents orchestrated across sequential waves,
and it is maintained the same way. Each card below defines a role: its mission,
the model and effort it runs at, the docs it must read first, its file-ownership
boundaries, the rules it must honour, and its definition-of-done.

The product is complete, so a card's mission now reads as **own and extend**, not
**build from nothing**. The invariants on each card are what the existing code
already satisfies — breaking one is a regression, not a style disagreement.

## Model policy (applies to every role)

- **Executors** (agents that write code) run **Opus 4.8, high effort**.
- **Readers / verifiers / reviewers** run **Sonnet 5** (effort chosen per task).
- **Never Haiku.** A cheap model produces plausible code that fails the
  checklist, and re-doing the work costs more than the model ever saved.
- The orchestrator plans, assigns effort per task, and owns wave sequencing.

## Ownership etiquette (applies to every role)

- **Ownership is strictly disjoint.** Touch only the paths your task assigns.
  Never edit a shared router, barrel, index, or locale-index file that another
  agent owns — list your needed entry in your handover instead. The stitch files
  are `apps/api/src/routes/index.ts`, `apps/web/src/routes/index.tsx`,
  `apps/web/src/locales/{en,ar}/index.ts`, `apps/web/src/lib/query-keys.ts`, and
  `packages/shared/src/index.ts`.
- **A batch of parallel agents ends with a sequential integration pass** that
  owns those stitch files and gets `pnpm turbo run build lint typecheck test`
  green.
- **Do not commit** and **do not create a worktree** unless explicitly told to.
  Work in place and leave the tree for review.
- **Validate every boundary with zod from `@flowboard/shared`.**
- **State an unknown rather than guessing.** An invented convention is more
  expensive to remove than a gap is to fill. (The tree is now free of
  `TODO(wave-N)` markers — do not reintroduce one without a dated owner.)
- **Update the doc that describes what you changed, in the same change.** A doc
  that disagrees with the code is a defect you introduced, and the code wins.

## Cards

| Card                         | Role                                                                                                                                                                                                                          | Model           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------- |
| [api-dev.md](./api-dev.md)   | Own `apps/api` — Express 5, Drizzle, the domain quartets, the domain-events bus, the socket layer and its bridge, the notification subscriber, and the supertest suites.                                                      | Opus 4.8 (high) |
| [web-dev.md](./web-dev.md)   | Own `apps/web` — the shell and token layer, the router, the data hooks and UI stores, the five views plus the task sheet, and the platform features (realtime, notifications, telemetry, diagnostics, Theme Studio, palette). | Opus 4.8 (high) |
| [reviewer.md](./reviewer.md) | Verify work against the hard rules, the standards, and the checklists — with evidence, and without writing product code.                                                                                                      | Sonnet 5        |

Three cards is deliberate. A change that spans both apps is two assignments with
**disjoint paths** plus a handover, not one agent with a wider mandate — that
constraint is what makes parallel work reviewable.

Definition-of-done for every executor card includes: **`pnpm build`,
`pnpm lint`, `pnpm typecheck`, and the relevant `pnpm test` all green**, LF
endings, and updated docs plus checklist rows.

See the master [.agents/INDEX.md](../INDEX.md).
