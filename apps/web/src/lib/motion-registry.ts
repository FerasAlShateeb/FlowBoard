/**
 * THE SANCTIONED MOTION REGISTRY — the closed list of things in FlowBoard that
 * are allowed to move on their own.
 *
 * ═══ WHY A LIST AND NOT A RULE ═════════════════════════════════════════════
 *
 * "Chrome moves at `--speed`, nothing else animates" is the rule, and it is
 * still the default answer. But a rule with exceptions and no register of them
 * is a rule nobody can apply: the next person cannot tell whether the animation
 * they are looking at was argued for or merely arrived. So the exceptions live
 * here, each with the same three answers:
 *
 *   1. WHAT CSS COULD NOT EXPRESS — because if CSS could, the answer is CSS.
 *   2. HOW IT IS DRIVEN — a `data-motion`-gated keyframe, the `motion` library,
 *      or a third-party animation prop.
 *   3. WHAT THE REDUCED BRANCH RENDERS — mandatory, no exceptions. An entry
 *      that keeps moving under Reduced motion is not an entry, it is a bug.
 *
 * Reduced motion removes MOVEMENT, never information. Every branch below still
 * shows the same content, the same affordances and the same numbers; only the
 * travel between two states disappears.
 *
 * ═══ THE TWO ENFORCEMENT SEAMS ═════════════════════════════════════════════
 *
 *   • {@link MOTION_LIBRARY_FILES} is asserted against the real source tree by
 *     `lib/motion-imports.test.ts`. Importing `motion` (or `framer-motion`)
 *     from anywhere else fails that suite — which is the point: the animation
 *     runtime is the part that is invisible to `index.css`'s gate, so it is the
 *     part that has to be counted by hand.
 *   • The CSS half enforces itself. `index.css` §B declares Round 2's keyframes
 *     ONLY under `:where(html[data-motion='full'])`, so a `reduced` session
 *     never starts them and no kill rule can be forgotten.
 *
 * ADDING AN ENTRY means adding a row to {@link MOTION_REGISTRY} first, with all
 * three answers filled in — and, if it uses the library, its file to
 * {@link MOTION_LIBRARY_FILES}.
 *
 * This module is DATA AND DOCUMENTATION ONLY. It imports nothing, runs at no
 * point in the app's lifetime, and is the anchor `.agents/docs/…/motion.md`
 * cites rather than restating the list in prose that can drift.
 */

/** How an entry's movement is actually produced. */
export type MotionDriver =
  /** A keyframe in `index.css` §B, wired only under `html[data-motion='full']`. */
  | 'css-gate'
  /** The `motion` library (`motion/react`), driven from JS. */
  | 'motion-lib'
  /** A third-party library's own animation, switched by a prop we compute. */
  | 'library-prop';

export interface MotionRegistryEntry {
  /** Stable id, used by tests and by the docs that cite this table. */
  readonly id: string;
  /** What the reader sees move. */
  readonly what: string;
  /** The file that owns it, relative to `apps/web/src/`. */
  readonly file: string;
  readonly driver: MotionDriver;
  /** Why `--speed` and a CSS transition could not do this. */
  readonly whyNotCss: string;
  /** What renders instead when `prefersReducedMotion()` is true. */
  readonly reducedBranch: string;
}

/**
 * The six entries. Exhaustive — anything not here stays a `--speed` transition.
 *
 * Ordered by how much of the app they touch, widest first, so the table reads
 * as "app chrome → one surface → one control".
 */
export const MOTION_REGISTRY: readonly MotionRegistryEntry[] = [
  {
    id: 'animated-tooltip',
    what: 'Avatar tooltip: a spring pop, plus a pointer-x parallax on the floating label.',
    file: 'components/ui/animated-tooltip.tsx',
    driver: 'motion-lib',
    whyNotCss:
      'The shift and tilt are a function of the CURSOR POSITION, not of elapsed time. CSS cannot read a pointer mid-transition, and a transition would lag the cursor by its own duration.',
    reducedBranch:
      'The plain `ui/tooltip` primitive — same copy, same tokens, same `data-testid="animated-tooltip"`, zero movement. Swapped live via `useMotionPref()`.',
  },
  {
    id: 'route-skeleton-pulse',
    what: 'The `animate-pulse` breath on every `Skeleton`, including the route placeholder.',
    file: 'components/common/RouteSkeleton.tsx (gate in index.css §A2)',
    driver: 'css-gate',
    whyNotCss:
      'It IS CSS — Tailwind ships it un-gated, so it is listed here as a KILL rule rather than as an opt-in one. Registered because the gate is easy to forget when a new skeleton is added.',
    reducedBranch:
      'The animation name is dropped and opacity is pinned at 0.72 — a paused pulse. The placeholder stays: "content is loading" is information, not movement.',
  },
  {
    id: 'board-drop-settle',
    what: 'A board card plays one spring settle (scale 1.02 → 1) where it lands.',
    file: 'components/board/DropSettle.tsx',
    driver: 'motion-lib',
    whyNotCss:
      'A keyframe would have to be retriggered per drop (so: re-keyed anyway), and a hand-tuned cubic-bezier approximation of a spring has to be re-guessed every time the numbers move. `index.css` is also append-only and owned elsewhere.',
    reducedBranch:
      'The settle key is never incremented, so the wrapper is a plain `<div>` with no `motion` component mounted at all. The card still lands, the toast and the drag announcement still fire.',
  },
  {
    id: 'theme-drawer-in',
    what: 'The Theme Studio drawer sliding in from the reading END, and its scrim fading up.',
    file: 'components/theme/* (keyframes `fb-drawer-in` / `fb-scrim-in`, index.css §B2)',
    driver: 'css-gate',
    whyNotCss:
      'It does not need to be — this one is pure CSS. It is registered because it is an ANIMATION rather than a transition: it runs on mount, on a timeline the user did not start, which is exactly the category the policy governs.',
    reducedBranch:
      'The keyframes are declared only under `html[data-motion="full"]`, so `reduced` never starts them: the drawer and its scrim simply appear, already in place.',
  },
  {
    id: 'notification-badge-pop',
    what: "The bell's unread badge pops once each time the count changes.",
    file: 'components/notifications/NotificationBell.tsx (keyframe `fb-badge-pop`, index.css §B1)',
    driver: 'css-gate',
    whyNotCss:
      'It is CSS. The interesting part is the RETRIGGER: the badge persists across counts, so the element is keyed on `unreadCount` and remounts, restarting the animation from frame zero with no JavaScript.',
    reducedBranch:
      "The remount still happens and is visually inert — `fb-badge-pop` matches no rule under `reduced`. The count is legible on every frame either way, and the exact number lives in the button's accessible name regardless.",
  },
  {
    id: 'report-chart-cold-draw',
    what: 'Every Recharts plot in the app — the five report tiles and the analytics console\'s `MetricChart` — draws itself in on a COLD load only.',
    file: 'components/reports/chart-theme.ts (`chartAnimation`, `useColdChart`)',
    driver: 'library-prop',
    whyNotCss:
      'Recharts animates its own SVG geometry through `react-smooth`; there is no element for a CSS gate to reach. The switch has to be a prop, and the prop has to be computed from the policy.',
    reducedBranch:
      '`isAnimationActive: false` — Recharts paints the final geometry on the first frame, which is byte-for-byte the pre-Round-2 behaviour. A warm refetch takes the same branch, so a dashboard being scanned never redraws itself.',
  },
] as const;

/**
 * THE ONLY FILES ALLOWED TO IMPORT THE `motion` LIBRARY, relative to
 * `apps/web/src/`. Asserted against the source tree by `lib/motion-imports.test.ts`.
 *
 * Kept narrow deliberately. The library is ~30 kB of always-shipped runtime and,
 * unlike a CSS keyframe, it is invisible to `index.css`'s `data-motion` gate —
 * every one of these files has to remember its own reduced branch by hand. Two
 * files is a set a reviewer can hold in their head; twenty is not.
 *
 * NOTE THE PACKAGE: always `motion` / `motion/react`, never `framer-motion`.
 * `framer-motion` is in the lockfile only as `motion`'s own dependency;
 * importing it directly pulls a second copy of the animation runtime.
 */
export const MOTION_LIBRARY_FILES: readonly string[] = [
  'components/ui/animated-tooltip.tsx',
  'components/board/DropSettle.tsx',
];

/**
 * Everything DELIBERATELY left un-gated, and why. Prose, not enforcement — but
 * it is the half of the policy people get wrong, so it is written down.
 *
 *   • `--speed` CHROME TRANSITIONS (hovers, colour changes, the workload bar's
 *     width). A transition is a response to something the user just did; the
 *     policy governs animations, which start on their own. `--speed` also has
 *     its own user control already — the Theme Studio's `Instant` preset.
 *   • `animate-spin`. A spinner is the only thing on screen asserting a request
 *     is still in flight; freezing it turns "working…" into "stuck".
 *   • STATIC TRANSFORMS (the lifted drag overlay's `rotate-[1.2deg]`). It never
 *     moves — it is composition, the same category as a border radius. Gating it
 *     would hand Reduced users a different board, which is what the contract
 *     forbids.
 *   • `components/reports/WorkloadBars.tsx`. The only report tile that is not
 *     Recharts: its bars are HTML with a `--speed` width transition, so it is
 *     already covered by the first bullet and takes no `chartAnimation`.
 */
export const MOTION_UNGATED_NOTE =
  'See the doc comment above this constant: --speed transitions, animate-spin, static transforms and WorkloadBars are un-gated by design.';
