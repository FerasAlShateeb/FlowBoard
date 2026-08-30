# Motion

FlowBoard's default answer to "should this animate?" is **no**. Chrome moves at
one duration (`--speed`, 130 ms) and nothing else moves on its own. Six things
are allowed to break that, each one registered by hand with a reason and a
reduced-motion branch.

This document is the doctrine and the mechanics. The **list itself lives in
code** — `apps/web/src/lib/motion-registry.ts` — and is cited here rather than
restated, because a list in prose drifts and a list a test asserts cannot. Read
this before adding any animation, before importing the `motion` library, and
before touching the gate block at the bottom of `apps/web/src/index.css`.

## 1. The doctrine

| Rule                                                                          | Why                                                                                                                                                                                                                             |
| ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Perceptible motion is a bug.** Chrome transitions run at `--speed` (130 ms) | The design direction is Linear-minimal (see [design-system.md](./design-system.md) §1). A transition you can watch is a transition that is costing the reader time on every interaction.                                        |
| **CSS first.** If CSS can express it, the answer is CSS                       | A CSS animation is gated by one attribute selector and cannot leak into a bundle. A JS animation runtime is invisible to that gate, which is why it has to be counted by hand (§5).                                             |
| **Every exception is registered, with three answers**                         | What CSS could not express · how it is driven · what the reduced branch renders. A rule with unregistered exceptions is a rule nobody can apply — the next reader cannot tell an argued animation from one that merely arrived. |
| **Reduced motion removes MOVEMENT, never information**                        | Every reduced branch renders the same content, the same affordances, the same numbers and the same `data-testid`. Only the travel between two states disappears.                                                                |
| **The user's choice beats the OS**                                            | The default is `full` even while the OS asks for reduced (§2). A blunt system toggle must not be able to strip an interface with no way back.                                                                                   |

The policy governs **animations** — things that move on a timeline the user did
not start. **Transitions stay with the theme**: `--speed` is written by
`applyTheme()` as an inline custom property on `<html>`, the Theme Studio's
Layout tab already exposes an `Instant` (0 ms) option, and an inline style beats
any stylesheet rule, so the gate layer could not touch it even if it wanted to.

## 2. The policy module — `apps/web/src/lib/motion-policy.ts`

**Nothing else in the codebase reads `prefers-reduced-motion` directly.** The
module is deliberately shaped like `lib/lang-policy.ts` (see
[i18n.md](./i18n.md) §1): lazily-read module state, a listener set, a `<html>`
stamp applied before React mounts, and a `useSyncExternalStore` hook on top. It
imports no component and not the `motion` library, so a policy read stays cheap
and synchronous — `prefersReducedMotion()` is called from render paths and from
`components/reports/chart-theme.ts`, where a hook is not available.

```ts
export type MotionPref = 'full' | 'reduced' | 'system';
export type EffectiveMotion = 'full' | 'reduced';
export const MOTION_STORAGE_KEY = 'fb-motion-v1';

getMotionPref(): MotionPref          // stored, else 'full'
effectiveMotion(): EffectiveMotion   // resolves 'system' against the OS
prefersReducedMotion(): boolean      // effectiveMotion() === 'reduced'
setMotionPref(next): void            // persist + restamp <html data-motion> + notify
subscribeMotion(onChange): () => void
initMotionPolicy(): void             // pre-paint stamp; called from main.tsx
useMotionPref(): MotionPref          // useSyncExternalStore over the above
```

**`full` is the default and it outranks a reducing OS.** That is the property
`motion-policy.test.ts` exists to prove, and the reasoning is written at the
call site: Windows' Accessibility → "Animation effects" toggle flips the media
feature system-wide, and some remote-desktop and power-saving setups assert it
without anyone asking. Honouring it unconditionally would kill every transition
FlowBoard has with **no way to opt back in from inside the app**. The OS is
consulted only when the user explicitly picks `system` — and then it is
consulted live, through a `matchMedia` `change` listener attached exactly once
however many times `initMotionPolicy()` runs.

**The stamp, not a media query, is what CSS gates on.** `stamp()` writes
`document.documentElement.dataset.motion` with the _effective_ value, so the
attribute is only ever `full` or `reduced` — never the literal `system`. A bare
`@media (prefers-reduced-motion)` could not be overridden from inside the app,
which is the whole reason the attribute exists.

`initMotionPolicy()` is called from `apps/web/src/main.tsx`'s `bootstrap()`,
immediately after `initLangPolicy()` and before the awaited `initI18n(...)`:

```text
import '@/stores/useThemeStore'   // tokens + `dark` at MODULE SCOPE
  → initLangPolicy()              // <html lang|dir>
  → initMotionPolicy()            // <html data-motion>
  → initFaviconUpdater()
  → await initI18n(getLangPref())
  → createRoot(...).render(...)
```

Both stamps are synchronous and land before the first paint, so a `reduced`
session never sees a frame of an animation it asked not to have.

The one UI that writes the preference is
`apps/web/src/components/common/MotionCard.tsx`, a three-radio group
(`full` / `reduced` / `system`, in that order, each with a hint) mounted on
`pages/ProfilePage.tsx` (`/me`) under `data-testid="motion-card"`. It applies
live — no reload — because every consumer subscribes.

`fb-motion-v1` is registered in the storage-key table in
[coding-standards.md](./coding-standards.md) §7 like every other persisted key,
and every access is wrapped: a throwing `localStorage.setItem` (Safari private
mode) must not take the preference control down with it.

## 3. The gate layer — `apps/web/src/index.css`

The last block in the stylesheet is the **motion gate layer**, and it is
append-only: nothing may be added after it. Three mechanics make it work, and
all three are stated in the block's own header.

### 3.1 The block is UNLAYERED, on purpose

Tailwind v4 emits everything — `theme`, `base`, `components`, `utilities` —
inside `@layer`. **An unlayered rule beats every layered rule regardless of
specificity**, so these gates win over `animate-in` and `animate-pulse` without
a single `!important` and without an arms race against utility specificity.

**Do not wrap this block in a layer, and do not append anything after it.** A
later unlayered rule would take the same precedence and could silently
re-enable what the gate kills.

### 3.2 Every gate is wrapped in `:where(…)`

`:where()` contributes **zero specificity**. The gate is a switch, not a claim
to win a cascade fight: `:where(html[data-motion='full']) .fb-drawer-in` is
exactly as specific as a bare `.fb-drawer-in`, so a consumer can still override
it with one class of its own. Dropping `:where()` would add the gate's compound
specificity to every rule below it and quietly reorder that cascade.

### 3.3 The two halves

| Half                                     | Selector                                                          | Does                                                                                                                                  |
| ---------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **§A1** — primitive enter/exit           | `:where(html[data-motion='reduced']) [data-slot][data-state]`     | Floors the `tw-animate-css` enter/exit animations on every shadcn primitive to `animation-duration: 1ms`.                             |
| **§A2** — the skeleton breath            | `:where(html[data-motion='reduced']) .animate-pulse`              | `animation-name: none` and `opacity: 0.72` — a paused pulse. The placeholder stays: "content is loading" is information.              |
| **§A3** — `animate-spin`                 | _(deliberately absent)_                                           | The one exception; see below.                                                                                                         |
| **§B1** — `fb-badge-pop`                 | `:where(html[data-motion='full']) .fb-badge-pop`                  | `260ms cubic-bezier(0.34, 1.56, 0.64, 1)`, one iteration.                                                                             |
| **§B2** — `fb-drawer-in` / `fb-scrim-in` | `:where(html[data-motion='full']) .fb-drawer-in` / `.fb-scrim-in` | `var(--speed) ease-out`, one iteration. Direction-aware: `:where(html[dir='rtl']) .fb-drawer-in` flips `--fb-drawer-from` to `-100%`. |

**§A1 floors the duration to 1 ms rather than setting `animation: none`,** and
that is not a stylistic preference: Radix's `Presence` waits for an
`animationend` event before unmounting. Removing the animation removes the
event, and a dialog would never close.

**§B declares Round 2's own keyframes only under `data-motion='full'`.** That is
the CSS half of the enforcement story (§5): a `reduced` session never starts
them, so there is no kill rule anyone can forget to write.

**`animate-spin` is the one un-gated animation, and it is a decision.** A
spinner is not decoration — it is the only thing on screen asserting that a
request is still in flight. Freezing it turns "working…" into "stuck", which is
a worse outcome for the reader who asked for reduced motion than the rotation
they wanted to avoid. Every `animate-spin` in the app is on a `Loader2` inside a
busy button, a `PageSpinner`, or a pending-state icon; there is no decorative
spin anywhere. **If a decorative one is ever added, gate that instance — not the
class.**

## 4. The registry — six entries

`apps/web/src/lib/motion-registry.ts` exports `MOTION_REGISTRY`, an array of
`MotionRegistryEntry`:

```ts
export type MotionDriver = 'css-gate' | 'motion-lib' | 'library-prop';

export interface MotionRegistryEntry {
  id: string;
  what: string;
  file: string;
  driver: MotionDriver;
  whyNotCss: string;
  reducedBranch: string; // mandatory — an entry with no reduced branch is a bug
}
```

The module is **data and documentation only**: it imports nothing and runs at no
point in the app's lifetime. It exists to be read and to be asserted against.

| #   | `id`                     | What moves                                                                                                               | Driver         | Reduced branch                                                                                                |
| --- | ------------------------ | ------------------------------------------------------------------------------------------------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------- |
| 1   | `animated-tooltip`       | Presence-avatar tooltip: a spring pop plus a pointer-x parallax on the floating label                                    | `motion-lib`   | The plain `ui/tooltip` primitive — same copy, same tokens, same `data-testid="animated-tooltip"`, no movement |
| 2   | `route-skeleton-pulse`   | The `animate-pulse` breath on every `Skeleton`, including the route placeholder                                          | `css-gate`     | Animation name dropped, opacity pinned at `0.72`. The placeholder itself stays                                |
| 3   | `board-drop-settle`      | A board card plays one spring settle (`scale 1.02 → 1`) where it lands                                                   | `motion-lib`   | The settle key is never incremented, so no `motion` component mounts at all — a plain `<div>`                 |
| 4   | `theme-drawer-in`        | The Theme Studio drawer sliding in from the reading **end**, and its scrim fading up                                     | `css-gate`     | The keyframes exist only under `data-motion='full'`; the drawer and scrim simply appear, already in place     |
| 5   | `notification-badge-pop` | The bell's unread badge pops once each time the count changes                                                            | `css-gate`     | The remount still happens and is visually inert — `fb-badge-pop` matches no rule under `reduced`              |
| 6   | `report-chart-cold-draw` | Every Recharts plot — the five report tiles and the analytics console's `MetricChart` — draws in on a **cold** load only | `library-prop` | `isAnimationActive: false`; Recharts paints the final geometry on the first frame                             |

Four of the six are worth a sentence of their own, because each names a
different reason the doctrine's "CSS first" default did not apply:

- **`animated-tooltip`** — the shift and tilt are a function of the **cursor
  position**, not of elapsed time. CSS cannot read a pointer mid-transition, and
  a transition would lag the cursor by its own duration. Springs:
  `POP_SPRING { stiffness: 260, damping: 20 }` for enter/exit,
  `FOLLOW_SPRING { stiffness: 140, damping: 16 }` — deliberately under-damped —
  for the follow.
- **`board-drop-settle`** — a keyframe would have to be retriggered per drop
  (so: re-keyed anyway), and a hand-tuned cubic-bezier approximation of a spring
  has to be re-guessed every time the numbers move.
  `SETTLE_SPRING { stiffness: 420, damping: 30, mass: 0.6 }` is near-critically
  damped: it settles in roughly 150 ms with no overshoot.
- **`route-skeleton-pulse`** is registered as a **kill rule**, not an opt-in
  one — Tailwind ships `animate-pulse` un-gated, and the gate is exactly the
  thing that is easy to forget when a new skeleton is added.
- **`report-chart-cold-draw`** — Recharts animates its own SVG geometry through
  `react-smooth`; there is no element for a CSS gate to reach, so the switch has
  to be a prop computed from the policy. **Cold loads only**: `useColdChart()`
  in `components/reports/chart-theme.ts` flips a ref (not state, so it cannot
  interrupt the sweep with a re-render) after the first render, and
  `chartAnimation(cold)` composes that with `prefersReducedMotion()`. A warm
  refetch takes the same branch as reduced motion, so a dashboard being scanned
  never redraws itself under the reader.

`MOTION_UNGATED_NOTE` in the same file lists what is deliberately **not** gated
and is not an entry: the `--speed` chrome transitions, `animate-spin`, static
transforms (the drag overlay's `rotate-[1.2deg]`), and
`components/reports/WorkloadBars.tsx` — the one report tile that is HTML rather
than Recharts, whose bars widen on a `--speed` transition.

## 5. The two enforcement seams

### 5.1 The grep test — `apps/web/src/lib/motion-imports.test.ts`

**The animation runtime is the part `index.css`'s gate cannot see, so it is the
part that is counted by hand.** `MOTION_LIBRARY_FILES` is the allowlist:

```ts
export const MOTION_LIBRARY_FILES: readonly string[] = [
  'components/ui/animated-tooltip.tsx',
  'components/board/DropSettle.tsx',
];
```

The suite reads the real source tree with Vite's
`import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', eager: true })` — not
`node:fs`, because `@flowboard/config`'s base tsconfig sets `types: []` and
`apps/web` does not opt back into Node globals. It then asserts:

| Assertion                                                                                                                                                    | Catches                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------- |
| Files importing `motion` **equal** `MOTION_LIBRARY_FILES`, sorted                                                                                            | Both directions: a stray import anywhere else, **and** a stale allowlist entry for a file that stopped using it |
| No file imports `framer-motion` directly, not even an allowlisted one                                                                                        | The transitive package leaking into an import statement                                                         |
| `MotionCard.tsx` does not match the pattern                                                                                                                  | The regex mistaking `@/lib/motion-policy` for the library — it is anchored on the opening quote                 |
| The glob sees more than 100 files                                                                                                                            | The test rotting into a silent no-op if the glob root ever moves                                                |
| The registry has exactly six unique ids; every `reducedBranch` and `whyNotCss` is real prose; every `motion-lib` entry names an allowlisted file that exists | An entry added without its reduced branch filled in                                                             |

**If it fails with an EXTRA file:** add a registry entry — with its reduced
branch — _before_ adding the file to `MOTION_LIBRARY_FILES`. **If it fails with
a MISSING file:** the allowlist is stale; shrink it.

`framer-motion` is not a dependency of `apps/web` at all. It appears in
`pnpm-lock.yaml` only as `motion`'s own transitive dependency, which is why the
second assertion is worth having.

### 5.2 The CSS half enforces itself

There is no second test for §B, and none is needed: the keyframes are declared
_inside_ the `full` gate, so a `reduced` session cannot start them. That is the
structural reason to prefer a `css-gate` entry over a `motion-lib` one whenever
the animation does not need to read a pointer or a spring.

**There is no `LazyMotion` and no feature-splitting of the `motion` bundle.**
Two components, both already lazy behind route-level code splitting, do not add
up to a heavy zone worth a second abstraction; that is recorded here so the
absence reads as a decision rather than an omission.

## 6. Durations and easings — what is tokenized, and what is not

| Value                                          | Where                                           | Tokenized?                                                                                              |
| ---------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `--speed` (130 ms default)                     | `index.css`, rewritten inline by `applyTheme()` | **Yes.** Every chrome transition, plus `fb-drawer-in` / `fb-scrim-in`                                   |
| `260ms cubic-bezier(0.34, 1.56, 0.64, 1)`      | `fb-badge-pop`, `index.css` §B1                 | No — a literal in the keyframe rule. An overshoot curve is the pop; `--speed` would flatten it          |
| `CHART_ANIMATION_MS = 600`                     | `components/reports/chart-theme.ts`             | No — an exported constant. At 130 ms a line chart's sweep is a flicker; 600 ms still reads as direction |
| `POP_SPRING`, `FOLLOW_SPRING`, `SETTLE_SPRING` | `animated-tooltip.tsx`, `DropSettle.tsx`        | No — spring physics, not a duration. A spring has no equivalent expression as a `--speed` multiple      |
| `ROUTE_SKELETON_MS = 350`                      | `components/common/RouteSkeleton.tsx`           | Not an animation at all — the **minimum hold** on the route placeholder, so a fast chunk does not flash |

**Each of the four un-tokenized values carries a comment at its definition
saying why it is not `--speed`.** Keep that convention: a bare number in this
subsystem reads as an oversight unless it argues for itself.

## 7. Recipe: adding an animation

1. **Try CSS.** A transition on `--speed` needs no entry, no registry row and
   no test. Most answers stop here.
2. **If it is an animation** — it runs on a timeline the user did not start —
   write it as a keyframe **inside the `:where(html[data-motion='full'])` gate**
   in `index.css` §B. Append within the block; never after it.
3. **If CSS genuinely cannot express it** (a pointer-driven value, a spring, a
   third-party canvas), add the file to `MOTION_LIBRARY_FILES` **and** write the
   registry entry in the same change.
4. **Fill in all three answers** on the entry: `whyNotCss`, `driver`, and
   `reducedBranch`. The last is not optional and the test checks it is real
   prose.
5. **Write the reduced branch for real, and test both.** The reduced render must
   keep the same copy, the same affordances and the **same `data-testid`** — a
   test that has to know which motion preference is active in order to find an
   element is a test that will disagree with itself.
6. **Read the policy at fire time, not at mount.** `DropSettle` proves the
   difference: a drop that happens _after_ the reader switches to Full must
   animate, and a stale closure over the preference would swallow it.
7. Run `pnpm --filter @flowboard/web test -- src/lib/motion` before you call it
   done.

## 8. Testing

| File                                                       | Covers                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/web/src/lib/motion-policy.test.ts`                   | The default-full-beats-OS property; an unrecognised stored value degrading to `full`; the pre-`init` lazy read; persist + restamp + notify; a throwing `localStorage`; `system` following the OS live; one OS listener however many inits; inertness with no `window`; the stamp never being the literal `system` |
| `apps/web/src/lib/motion-imports.test.ts`                  | The import allowlist in both directions, the `framer-motion` ban, the `motion-policy` false-positive guard, the glob sanity check, and the registry's own shape (§5.1)                                                                                                                                            |
| `apps/web/src/components/common/MotionCard.test.tsx`       | Three radios in order, label + hint on each, the stored value checked, click → persist + restamp with no reload, live re-render from an external change, `aria-label` and testids                                                                                                                                 |
| `apps/web/src/components/common/RouteSkeleton.test.tsx`    | `routeViewKey` / `isRouteViewChange` (including the `/t/:taskKey` strip that must not eat `/table` or `/telemetry`), the `ROUTE_SKELETON_MS` bound, `role="status"` and the eight `aria-hidden` bars                                                                                                              |
| `apps/web/src/components/board/DropSettle.test.tsx`        | Settles only the dropped card; the signal is consumed so a later mount cannot replay it; a second drop re-settles; an unmounted card id is ignored; under `reduced` nothing is stamped **but the signal is still consumed**                                                                                       |
| `apps/web/src/components/ui/animated-tooltip.test.tsx`     | Both branches render the same copy and testid; hover **and** focus open the label; a jsdom-zeroed `getBoundingClientRect()` does not produce NaN; a live preference change swaps branches without a remount; Full outranks a reducing OS under `system`                                                           |
| `apps/web/src/components/reports/chart-animation.test.tsx` | `useColdChart()` reports cold once per mount, warm thereafter, cold again on remount, flips **without** a re-render, and composes correctly with reduced motion                                                                                                                                                   |

## Related docs

- [design-system.md](./design-system.md) — `--speed`, the Layout tab's `Instant`
  option, the `index.css` layer order this block deliberately sits outside, and
  the theme drawer the `fb-drawer-in` keyframes belong to.
- [coding-standards.md](./coding-standards.md) — §7, the `fb-*-v1` storage-key
  registry `fb-motion-v1` is listed in.
- [i18n.md](./i18n.md) — `lib/lang-policy.ts`, the module this one is
  deliberately shaped after, and the RTL direction the drawer keyframes read.
- [analytics.md](./analytics.md) — `MetricChart`, the second consumer of
  `chartAnimation` / `useColdChart`, and what "cold" means there.
- [testing.md](./testing.md) — where these suites sit in the pyramid.

Back to [docs/INDEX.md](./INDEX.md) · [.agents/INDEX.md](../INDEX.md)
