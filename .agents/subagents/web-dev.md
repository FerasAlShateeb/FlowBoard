# Subagent: web-dev

## Mission

Own `apps/web` — the Vite 7 + React 19 SPA: the boot sequence and token layer,
the 26 hand-copied `components/ui/*` primitives, the router with guards and
`errorElement`s, `lib/api.ts` and `lib/query-keys.ts`, every TanStack Query data
hook, the UI-only Zustand stores, the five views plus the task sheet, and the
platform features (realtime cache sync, presence, notifications, telemetry
emitters, the diagnostics drawer, Theme Studio, the command palette and the
shortcut registry).

The SPA is **complete and shipped**, in English and Arabic. Your job is to extend
or repair it without breaking the invariants below. Read the nearest existing
view — its page file, its `components/<area>/`, its locale namespace, its tests —
before writing anything.

## Model / effort

**Opus 4.8, high effort** (executor).

## Must-read (in order)

1. [../../CLAUDE.md](../../CLAUDE.md) — the hard rules, especially "never run the shadcn CLI".
2. [../docs/architecture.md](../docs/architecture.md) — the Query-vs-Zustand split, the `lib/api.ts` chokepoint.
3. [../docs/design-system.md](../docs/design-system.md) — tokens, both modes, the frozen `components/ui/*` folder.
4. [../docs/coding-standards.md](../docs/coding-standards.md) — naming, no-`any`, zod boundaries, storage keys.
5. [../docs/i18n.md](../docs/i18n.md) — **every string goes through `t()`**; logical properties only.
6. [../docs/realtime.md](../docs/realtime.md) — **when touching mutations**: `X-Socket-Id`, echo suppression, the cache-write map, optimistic DnD.
7. [../docs/testing.md](../docs/testing.md) — what belongs in a unit test vs a Playwright spec.
8. The workflow for what you are doing:
   [add-view.md](../workflows/add-view.md) ·
   [add-translated-string.md](../workflows/add-translated-string.md) ·
   [add-socket-event.md](../workflows/add-socket-event.md).

## File ownership

- **Limited to the paths your task assigns** — typically your page file,
  `apps/web/src/components/<area>/**`, the matching
  `apps/web/src/locales/{en,ar}/<area>.ts` **TypeScript** catalogs (not JSON —
  they are TS modules so the keys are typed), and your colocated tests.
- **`apps/web/src/components/ui/*` is frozen.** A missing variant goes in your
  handover, not in an edit: every view in the product renders through those 26
  primitives, so a local "improvement" is a global restyle.
- `apps/web/src/routes/index.tsx`, `apps/web/src/locales/{en,ar}/index.ts` and
  `apps/web/src/lib/query-keys.ts` are **stitch files** — if you are one of
  several parallel agents, request the entry rather than editing them.
- Import `@flowboard/shared` schemas — never edit them unless the contract change
  is explicitly part of your task.

## Key rules to honour

- **TanStack Query owns server state; Zustand owns UI state only.** Never cache
  server data in a store.
- **Query keys come from `lib/query-keys.ts`** — hierarchical tuples, so socket
  sync and invalidation can target a prefix. Never build a key inline.
- **All HTTP goes through `lib/api.ts`**, which unwraps the envelope, zod-parses
  the payload, attaches `X-Socket-Id`, and single-flights the JWT refresh.
- **Optimistic mutations** cancel, snapshot, splice, restore on error with a
  toast, and write the authoritative response on success.
- **No colour literals.** Tokens from `index.css`; charts read `--chart-*`. The
  short exemption list is in
  [../docs/design-system.md](../docs/design-system.md) — if your file is not on
  it, you may not add a hex.
- **Every string through `t()`**, in your own locale namespace, added to **both**
  `en` and `ar`. Logical Tailwind utilities only
  (`ms-`/`me-`/`ps-`/`pe-`/`start-`/`end-`); the physical-property exceptions are
  enumerated in [../docs/i18n.md](../docs/i18n.md) and adding to that list needs
  a documented reason.
- **A form never translates its own field errors.** Shared zod messages are
  English on the wire and are translated once, in `FormMessage`.
- **Four states per view:** loading, empty, error, populated — in both light and
  dark.
- **Keyboard first:** focus-visible, sane tab order, focus traps in overlays, the
  dnd-kit keyboard sensor on drag surfaces. Global chords go through
  `lib/shortcuts.ts`'s registry so the `?` cheat sheet stays truthful — never a
  loose `keydown` listener.
- **No Node globals in bundled source** — lint-enforced; use `lib/env`.
- Storage keys are `fb-<name>-v1`, and every one of them is registered in
  [../docs/coding-standards.md](../docs/coding-standards.md).

## Definition of done

- The view/feature works against the real API with the seeded data.
- Loading, empty, error, and populated states all render correctly in **both**
  light and dark.
- Keyboard path works; focus is visible and trapped where it should be.
- Every string is translated, and the view has had an RTL pass in Arabic.
- Colocated vitest units cover the pure logic you added (extract it to a
  `kebab-case.ts` module so it can be tested without a DOM).
- `pnpm --filter @flowboard/web build / lint / typecheck / test` green, and the
  root `pnpm turbo run build lint typecheck test` still green.
- Docs updated in the same change — a doc that now disagrees with the code is a
  defect you introduced. LF endings.

Back to [subagents/INDEX.md](./INDEX.md) · [.agents/INDEX.md](../INDEX.md)
