import * as React from 'react';
import { AnimatePresence, motion, useMotionValue, useSpring, useTransform } from 'motion/react';

import { cn } from '@/lib/utils';
import { prefersReducedMotion, useMotionPref } from '@/lib/motion-policy';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

/**
 * The avatar-group hover tooltip — a spring pop plus a pointer-x parallax.
 *
 * ═══ WHY THIS IS ALLOWED TO USE THE `motion` LIBRARY AT ALL ════════════════
 *
 * FlowBoard's default answer for chrome movement is a CSS transition at
 * `--speed`, or a keyframe wired under `index.css`'s `data-motion='full'` gate.
 * That answer cannot produce this interaction: the floating label's horizontal
 * shift and tilt are a function of WHERE THE CURSOR IS, not of how much time has
 * passed, and CSS has no way to read a pointer position mid-transition. A
 * transition can only interpolate between two committed states, so it lags the
 * cursor by its own duration.
 *
 * So this is entry #1 of the sanctioned motion registry — `lib/motion-registry.ts`
 * is the closed list, and `lib/motion-imports.test.ts` fails the build if a
 * `motion` import appears in a file that is not on it.
 *
 * ═══ THE THREE CONSTRAINTS THAT COME WITH THAT SANCTION ════════════════════
 *
 * 1. **A reduced-motion branch is MANDATORY.** Under `prefersReducedMotion()`
 *    this renders the plain `ui/tooltip` primitive instead — same copy, same
 *    tokens, same `data-testid`, zero movement. The gate is the APP POLICY, not
 *    `@media (prefers-reduced-motion)`: `motion` drives its animations from JS,
 *    so a CSS gate cannot touch them, and `index.css`'s `data-motion` layer is
 *    blind to everything in this file.
 * 2. **It subscribes with {@link useMotionPref}, not just `prefersReducedMotion`.**
 *    The bare predicate is a synchronous read with no subscription; without the
 *    hook a user flipping the Motion card on `/me` would keep the branch they
 *    mounted with until the next navigation. With it, the swap is immediate.
 * 3. **Every hook runs before the branch.** `useMotionValue`/`useSpring`/
 *    `useTransform` are declared unconditionally at the top, above the early
 *    return, so switching preference mid-session changes what is RENDERED and
 *    never how many hooks were called.
 *
 * ═══ THE IMPORT IS `motion/react`, NEVER `framer-motion` ═══════════════════
 *
 * `framer-motion` appears in the lockfile only because it is `motion`'s own
 * internal dependency. Importing it directly would pull a second copy of the
 * animation runtime into the bundle.
 *
 * Bare `motion.*` (rather than the lighter `m.*`) is correct here: `m.*` only
 * animates inside a `<LazyMotion>` boundary, and this is app-wide chrome that
 * has no provider above it. FlowBoard mounts no `LazyMotion` anywhere.
 */

/** Pointer travel (px from the trigger's centre) mapped to the full parallax. */
const FOLLOW_RANGE = 100;
/** Peak horizontal parallax of the floating label, in px. */
const FOLLOW_SHIFT = 22;
/** Peak tilt of the floating label, in degrees. */
const FOLLOW_ROTATE = 10;

/**
 * The parallax spring — deliberately UNDER-damped and slack (ζ ≈ 0.68).
 *
 * This one is not chasing `--speed`. It is the lag between the cursor and the
 * label, and a little trailing is the whole effect; a critically damped spring
 * here would pin the label to the pointer and look like a hard `translateX`.
 */
const FOLLOW_SPRING = { stiffness: 140, damping: 16 } as const;

/**
 * The enter/exit spring.
 *
 * 260/20 settles in roughly 250ms — about 2× `--speed` (130ms), which is the
 * right ratio for an overshooting ENTRANCE against the linear chrome transitions
 * around it: a pop that resolved in exactly `--speed` would read as a jump, and
 * one much slower than 2× would read as sluggish next to a hover state that has
 * already finished. The tooltip is also gated behind the shared 200ms Radix-style
 * hover intent in practice, so this never fires on a cursor merely passing by.
 */
const POP_SPRING = { type: 'spring', stiffness: 260, damping: 20 } as const;

export interface AnimatedTooltipProps {
  /** Tooltip copy — always exposed to assistive tech, in both branches. */
  label: string;
  children: React.ReactNode;
  /** Extra classes for the trigger wrapper (never the floating label). */
  className?: string;
}

/**
 * The floating surface, shared by both branches so they read identically.
 *
 * Every value is a token: the same `--radius`, `--border`, `--surface-raised`
 * and `--shadow-2` that `ui/tooltip`'s `TooltipContent` uses, so a Theme Studio
 * change or a light/dark flip moves both branches together and neither one can
 * drift into being "the animated tooltip that looks slightly different".
 */
const LABEL_SURFACE =
  'w-fit rounded-[var(--radius)] border border-border bg-surface-raised px-2 py-1 text-xs whitespace-nowrap text-foreground shadow-[var(--shadow-2)]';

function AnimatedTooltip({ label, children, className }: AnimatedTooltipProps) {
  // Subscribe to the preference so a live change on `/me` swaps branches
  // immediately; `prefersReducedMotion()` is what resolves it against the OS.
  useMotionPref();
  const reduced = prefersReducedMotion();

  const [open, setOpen] = React.useState(false);

  // Hooks run unconditionally — they are declared ABOVE the branch below.
  const pointerX = useMotionValue(0);
  const followX = useSpring(pointerX, FOLLOW_SPRING);
  const x = useTransform(followX, [-FOLLOW_RANGE, FOLLOW_RANGE], [-FOLLOW_SHIFT, FOLLOW_SHIFT]);
  const rotate = useTransform(
    followX,
    [-FOLLOW_RANGE, FOLLOW_RANGE],
    [-FOLLOW_ROTATE, FOLLOW_ROTATE],
  );

  const handleMove = React.useCallback(
    (event: React.MouseEvent<HTMLSpanElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      pointerX.set(event.clientX - rect.left - rect.width / 2);
    },
    [pointerX],
  );

  if (reduced) {
    return (
      <Tooltip>
        {/* The span idiom, not a bare `asChild` child: Radix merges its own
            `data-state` onto whatever it wraps, which would clobber the state
            attribute of a control that has one of its own. The span absorbs it. */}
        <TooltipTrigger asChild>
          <span className={cn('inline-flex', className)}>{children}</span>
        </TooltipTrigger>
        <TooltipContent side="bottom" data-testid="animated-tooltip">
          {label}
        </TooltipContent>
      </Tooltip>
    );
  }

  return (
    <span
      className={cn('relative inline-flex', className)}
      onMouseEnter={() => {
        setOpen(true);
      }}
      onMouseLeave={() => {
        setOpen(false);
        pointerX.set(0);
      }}
      onMouseMove={handleMove}
      onFocus={() => {
        setOpen(true);
      }}
      onBlur={() => {
        setOpen(false);
      }}
    >
      {children}
      {/* The copy stays readable to assistive tech whichever branch renders and
          whatever the animation is doing — the floating label is decorative, and
          a label that only exists while a spring is mid-flight is not a label. */}
      <span className="sr-only">{label}</span>
      <AnimatePresence>
        {open ? (
          // Floating tier (design-system.md's z-index scale, same z as
          // `TooltipContent`): may overlap anything, must never eat a click.
          //
          // Centred with `inset-x-0` + `justify-center` rather than the usual
          // `left-1/2 -translate-x-1/2`, and that is not stylistic: `left-*` is
          // a physical utility the house rules forbid, and its logical sibling
          // `start-1/2` is genuinely WRONG here — under RTL it resolves to
          // `right: 50%`, and the negative translate then pushes the label off
          // centre instead of onto it. A zero-width-inset flex row centres in
          // both directions with no transform at all, leaving `x` free for the
          // parallax below.
          <span className="pointer-events-none absolute inset-x-0 bottom-full z-[110] flex justify-center pb-2">
            <motion.span
              data-testid="animated-tooltip"
              aria-hidden="true"
              initial={{ opacity: 0, y: 8, scale: 0.94 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 8, scale: 0.94 }}
              transition={POP_SPRING}
              style={{ x, rotate }}
              className={LABEL_SURFACE}
            >
              {label}
            </motion.span>
          </span>
        ) : null}
      </AnimatePresence>
    </span>
  );
}

export { AnimatedTooltip };
export default AnimatedTooltip;
