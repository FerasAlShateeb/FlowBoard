import { useMemo, useSyncExternalStore, type ReactNode } from 'react';

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * TopbarSlots — the topbar's extension point.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * THE PROBLEM IT SOLVES. `Topbar.tsx` is chrome every wave wants a piece of:
 * WP4.2 needs the notification bell, WP4.4 the diagnostics toggle, WP4.6 the
 * command-palette trigger, WP4.3 an environment badge. Those packages run in
 * PARALLEL and own disjoint paths. If each one had to edit `Topbar.tsx`, that
 * single file would be a four-way merge conflict — and `Topbar.tsx` belongs to
 * WP1.4, which by then is finished.
 *
 * THE DESIGN: a module-scope registry, read through `useSyncExternalStore`.
 * A feature registers a renderer at import time (or in an effect) and the
 * topbar re-renders with it. `Topbar.tsx` is never touched again.
 *
 * WHY A REGISTRY AND NOT CHILDREN-COMPOSITION. `<Topbar><Bell/></Topbar>` would
 * work, but it just moves the edit: something has to compose that tree, and
 * that something is `AppShell.tsx` — also a WP1.4 file, and also then a
 * four-way conflict. A registry moves the coupling to the FEATURE side, which
 * is the side that is actually changing.
 *
 * WHY NOT A PORTAL. A React portal into a DOM node inside the topbar would also
 * work and would keep each feature's own context. It was rejected because the
 * topbar has to LAY OUT its extras (ordering, gaps, the `md:` hiding rules),
 * and a portal target must exist and be sized before its content arrives — so
 * an empty feature would still cost a gap. The registry hands the topbar real
 * children it can order and space normally.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * USAGE (this is the contract Wave 4 codes against)
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Register once, from a module in the entry graph — a `Bridge` component that
 * `AppShell` already mounts, or the feature's own barrel:
 *
 * ```tsx
 * // components/notifications/register-bell.ts  (WP4.2)
 * import { registerTopbarSlot } from '@/components/layout/TopbarSlots';
 * import NotificationBell from './NotificationBell';
 *
 * registerTopbarSlot({
 *   id: 'notifications-bell',   // unique; re-registering replaces
 *   zone: 'end',                // 'start' | 'center' | 'end'
 *   order: 20,                  // ascending; leave gaps of 10
 *   render: () => <NotificationBell />,
 * });
 * ```
 *
 * Or scoped to a component's lifetime — `registerTopbarSlot` returns its own
 * unregister function, so it drops straight into an effect:
 *
 * ```tsx
 * useEffect(() => registerTopbarSlot({ id: 'diag-toggle', zone: 'end', order: 30,
 *   render: () => <DiagToggle /> }), []);
 * ```
 *
 * RULES:
 *   - `id` must be unique and stable. Registering the same id twice REPLACES
 *     (idempotent under React StrictMode's double-invoke and under HMR).
 *   - `render` is called during the topbar's render, so it must be a pure
 *     component-returning function — hooks live inside the returned component,
 *     never in `render` itself.
 *   - Order values are conventions, not law: 10 palette, 20 bell, 30
 *     diagnostics, 40 appearance. Leave gaps.
 *   - A slot renders inside the topbar's own flex row. Keep it to an icon
 *     button sized `size-7`, or the dense 48px bar will not hold it.
 */

export type TopbarZone = 'start' | 'center' | 'end';

export interface TopbarSlot {
  /** Unique, stable id. Re-registering the same id replaces the entry. */
  id: string;
  zone: TopbarZone;
  /** Ascending sort within the zone. Ties fall back to insertion order. */
  order: number;
  render: () => ReactNode;
}

const registry = new Map<string, TopbarSlot>();
const listeners = new Set<() => void>();

/**
 * A cached, sorted array.
 *
 * `useSyncExternalStore` requires `getSnapshot` to return a REFERENTIALLY
 * STABLE value between changes — returning a fresh `[...map.values()]` each
 * call is an infinite render loop. So the array is rebuilt only when the
 * registry actually changes.
 */
let snapshot: readonly TopbarSlot[] = [];

/** Server snapshot: always empty, and always the same reference. */
const EMPTY: readonly TopbarSlot[] = [];

function rebuild(): void {
  snapshot = [...registry.values()].sort((a, b) => a.order - b.order);
  for (const listener of listeners) listener();
}

/**
 * Adds (or replaces) a topbar slot. Returns the unregister function, so the
 * call can be the body of a `useEffect` — or ignored entirely for a permanent
 * module-scope registration.
 */
export function registerTopbarSlot(slot: TopbarSlot): () => void {
  registry.set(slot.id, slot);
  rebuild();
  return () => {
    // Only remove if this exact registration is still the live one: a
    // StrictMode remount runs register → register → unregister, and without
    // this check the second (winning) registration would be torn down.
    if (registry.get(slot.id) === slot) {
      registry.delete(slot.id);
      rebuild();
    }
  };
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  return () => {
    listeners.delete(onChange);
  };
}

function getSnapshot(): readonly TopbarSlot[] {
  return snapshot;
}

function getServerSnapshot(): readonly TopbarSlot[] {
  return EMPTY;
}

/** Subscribes to the slots registered for one zone, in `order`. */
export function useTopbarSlots(zone: TopbarZone): readonly TopbarSlot[] {
  const all = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  return useMemo(() => all.filter((slot) => slot.zone === zone), [all, zone]);
}

/**
 * Renders every slot registered for `zone`. This is the ONLY thing `Topbar.tsx`
 * has to contain for a feature to reach it.
 */
export function TopbarSlotZone({ zone }: { zone: TopbarZone }) {
  const slots = useTopbarSlots(zone);
  if (slots.length === 0) return null;

  return (
    <>
      {slots.map((slot) => (
        <span key={slot.id} data-topbar-slot={slot.id} className="contents">
          {slot.render()}
        </span>
      ))}
    </>
  );
}

/** TEST SEAM: clears the registry between suites. Not for application code. */
export function __resetTopbarSlotsForTests(): void {
  registry.clear();
  rebuild();
}
