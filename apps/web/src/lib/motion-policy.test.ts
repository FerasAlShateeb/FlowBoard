import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * `lib/motion-policy` — the animation policy's contract.
 *
 * THE PROPERTY THIS FILE EXISTS TO PROVE: the OS signal does **not** win by
 * default. With nothing stored, the effective motion is `full` even while
 * `(prefers-reduced-motion: reduce)` matches — because a Windows
 * "Animation effects" toggle, a remote-desktop session or a power-saving mode
 * can assert that media feature without anyone having asked FlowBoard for a
 * quieter interface, and there would be no way back from inside the app.
 * Everything else here is scaffolding around that one claim.
 *
 * The package's default vitest environment is `node` (see `vitest.config.ts`),
 * so `window`, `document`, `localStorage` and `matchMedia` are installed as
 * minimal fakes per test and torn down afterwards. That is not a limitation —
 * it is the point: the module has to survive a world with none of them (the
 * `no-window` case below), and hand-built fakes make the OS listener's exact
 * wiring observable in a way a real jsdom `matchMedia` would not.
 *
 * The module caches the preference and attaches its OS listener ONCE for the
 * process, both of which are module-level state, so every test re-imports it
 * through `vi.resetModules()`.
 */

/** Mirrors `MOTION_STORAGE_KEY`; asserted against the export in the last test. */
const MOTION_KEY = 'fb-motion-v1';

// `src/test/setup.ts` installs a real in-memory `localStorage` before any module
// graph loads, so these are genuine objects to put back — not `undefined`.
const savedWindow = (globalThis as { window?: unknown }).window;
const savedDocument = (globalThis as { document?: unknown }).document;
const savedLocalStorage = (globalThis as { localStorage?: unknown }).localStorage;

/** A `Storage`-shaped object, optionally pre-seeded with a stored preference. */
function makeStorage(seed?: string): Storage {
  const map: Record<string, string> = seed === undefined ? {} : { [MOTION_KEY]: seed };
  return {
    getItem: (key) => (key in map ? (map[key] as string) : null),
    setItem: (key, value) => {
      map[key] = String(value);
    },
    removeItem: (key) => {
      delete map[key];
    },
    clear: () => {
      for (const key of Object.keys(map)) delete map[key];
    },
    key: (index) => Object.keys(map)[index] ?? null,
    get length() {
      return Object.keys(map).length;
    },
  } as Storage;
}

/** A `matchMedia` stub whose `matches` can be flipped, firing `change` listeners. */
function makeMedia(initial: boolean) {
  const handlers = new Set<() => void>();
  const query = {
    matches: initial,
    addEventListener: (_type: string, handler: () => void) => {
      handlers.add(handler);
    },
    removeEventListener: (_type: string, handler: () => void) => {
      handlers.delete(handler);
    },
  };
  return {
    query,
    /** Simulate the OS accessibility toggle flipping under a live session. */
    flip(next: boolean) {
      query.matches = next;
      for (const handler of handlers) handler();
    },
  };
}

/** Stands in for `<html>` — the element the module stamps `data-motion` onto. */
let root: { dataset: Record<string, string> };

function install(options: { stored?: string; osReduce?: boolean } = {}) {
  const media = makeMedia(options.osReduce ?? false);
  root = { dataset: {} };
  (globalThis as { window?: unknown }).window = { matchMedia: () => media.query };
  (globalThis as { document?: unknown }).document = { documentElement: root };
  (globalThis as { localStorage?: unknown }).localStorage = makeStorage(options.stored);
  return media;
}

/** A fresh module instance: the pref cache and the OS listener are module state. */
async function load() {
  vi.resetModules();
  return import('@/lib/motion-policy');
}

beforeEach(() => {
  install();
});

afterEach(() => {
  for (const [key, saved] of [
    ['window', savedWindow],
    ['document', savedDocument],
    ['localStorage', savedLocalStorage],
  ] as const) {
    if (saved === undefined) delete (globalThis as Record<string, unknown>)[key];
    else (globalThis as Record<string, unknown>)[key] = saved;
  }
});

describe('lib/motion-policy', () => {
  it('defaults to Full — and Full beats an OS that asks for reduced motion', async () => {
    install({ osReduce: true });
    const policy = await load();
    policy.initMotionPolicy();

    expect(policy.getMotionPref()).toBe('full');
    expect(policy.effectiveMotion()).toBe('full');
    expect(policy.prefersReducedMotion()).toBe(false);
    expect(root.dataset.motion).toBe('full');
  });

  it('treats an unrecognised stored value as Full', async () => {
    install({ stored: 'sideways' });
    const policy = await load();
    policy.initMotionPolicy();

    expect(policy.getMotionPref()).toBe('full');
    expect(root.dataset.motion).toBe('full');
  });

  it('restores a valid stored preference', async () => {
    install({ stored: 'reduced' });
    const policy = await load();
    policy.initMotionPolicy();

    expect(policy.getMotionPref()).toBe('reduced');
    expect(policy.effectiveMotion()).toBe('reduced');
    expect(policy.prefersReducedMotion()).toBe(true);
    expect(root.dataset.motion).toBe('reduced');
  });

  it('reads the stored preference lazily, before init has run', async () => {
    // `chart-theme.ts` and the motion registry call `prefersReducedMotion()`
    // from render paths that may resolve before `main.tsx`'s bootstrap has
    // reached `initMotionPolicy()`. The answer must already be right.
    install({ stored: 'reduced' });
    const policy = await load();

    expect(policy.prefersReducedMotion()).toBe(true);
    // …and nothing was stamped, because only init/set stamp.
    expect(root.dataset.motion).toBeUndefined();
  });

  it('setMotionPref persists, restamps data-motion, and notifies subscribers', async () => {
    const policy = await load();
    policy.initMotionPolicy();

    const seen: string[] = [];
    const unsubscribe = policy.subscribeMotion(() => seen.push(policy.getMotionPref()));

    policy.setMotionPref('reduced');
    expect(localStorage.getItem(MOTION_KEY)).toBe('reduced');
    expect(root.dataset.motion).toBe('reduced');
    expect(policy.prefersReducedMotion()).toBe(true);
    expect(seen).toEqual(['reduced']);

    unsubscribe();
    policy.setMotionPref('full');
    expect(localStorage.getItem(MOTION_KEY)).toBe('full');
    expect(root.dataset.motion).toBe('full');
    // Unsubscribed — the stamp still moved, the listener did not fire again.
    expect(seen).toEqual(['reduced']);
  });

  it('survives a storage write that throws, keeping the in-memory preference', async () => {
    // Safari private mode / a full quota: the choice must still take effect for
    // this session rather than blowing up the settings card's onChange.
    install();
    (globalThis as { localStorage?: unknown }).localStorage = {
      ...makeStorage(),
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    } as Storage;

    const policy = await load();
    policy.initMotionPolicy();

    expect(() => policy.setMotionPref('reduced')).not.toThrow();
    expect(policy.getMotionPref()).toBe('reduced');
    expect(root.dataset.motion).toBe('reduced');
  });

  it('follows the OS only under `system`, and reacts to a live change event', async () => {
    const media = install({ stored: 'system', osReduce: false });
    const policy = await load();
    policy.initMotionPolicy();

    expect(policy.effectiveMotion()).toBe('full');
    expect(root.dataset.motion).toBe('full');

    let notified = 0;
    policy.subscribeMotion(() => {
      notified++;
    });

    media.flip(true);
    expect(policy.effectiveMotion()).toBe('reduced');
    expect(root.dataset.motion).toBe('reduced');
    expect(notified).toBe(1);

    // Pinning the preference takes the OS out of the loop entirely.
    policy.setMotionPref('full');
    media.flip(false);
    media.flip(true);
    expect(policy.effectiveMotion()).toBe('full');
    expect(root.dataset.motion).toBe('full');
    // Only the `setMotionPref` call notified; both OS events were ignored.
    expect(notified).toBe(2);
  });

  it('attaches the OS listener exactly once, however often init runs', async () => {
    // `initMotionPolicy()` is documented as idempotent, and a second listener
    // would double every notification the `system` branch emits.
    const media = install({ stored: 'system' });
    const policy = await load();
    policy.initMotionPolicy();
    policy.initMotionPolicy();
    policy.initMotionPolicy();

    let notified = 0;
    policy.subscribeMotion(() => {
      notified++;
    });

    media.flip(true);
    expect(notified).toBe(1);
  });

  it('is inert without a window (node) — Full, and init never throws', async () => {
    delete (globalThis as { window?: unknown }).window;
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { localStorage?: unknown }).localStorage;

    const policy = await load();
    expect(() => policy.initMotionPolicy()).not.toThrow();
    expect(policy.getMotionPref()).toBe('full');
    expect(policy.effectiveMotion()).toBe('full');
    expect(policy.prefersReducedMotion()).toBe(false);
  });

  it('stamps only `full` or `reduced` — never the `system` preference itself', async () => {
    // The CSS gate matches `html[data-motion='full'|'reduced']`; leaking the
    // literal `system` would silently disable every gated rule in `index.css`.
    const media = install({ stored: 'system', osReduce: true });
    const policy = await load();
    policy.initMotionPolicy();
    expect(root.dataset.motion).toBe('reduced');

    media.flip(false);
    expect(root.dataset.motion).toBe('full');

    policy.setMotionPref('system');
    expect(root.dataset.motion).toBe('full');
    expect(policy.getMotionPref()).toBe('system');
  });

  it('publishes the house storage key', async () => {
    const policy = await load();
    expect(policy.MOTION_STORAGE_KEY).toBe(MOTION_KEY);
  });
});
