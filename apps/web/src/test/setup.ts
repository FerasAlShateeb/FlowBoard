import { beforeEach } from 'vitest';

/**
 * Vitest setup for the node-environment suites.
 *
 * The suites are deliberately DOM-free, but several modules under test reach
 * for Web Storage at import time — `useAuthStore` and `useLayoutStore` hydrate
 * through zustand's `persist`, and `lib/lang-policy` reads its preference
 * lazily. Node has no `localStorage` unless it is started with an experimental
 * flag, so this file installs a minimal in-memory implementation BEFORE any
 * module graph is loaded (setup files run first, which is the whole reason this
 * lives here rather than in a helper each suite imports).
 *
 * It is intentionally a real `Storage`-shaped object rather than a mock: the
 * code under test only wants somewhere to put strings, and a stub with
 * `vi.fn()` everywhere would make every assertion about behaviour into an
 * assertion about calls.
 */
class MemoryStorage implements Storage {
  #map = new Map<string, string>();

  get length(): number {
    return this.#map.size;
  }

  clear(): void {
    this.#map.clear();
  }

  getItem(key: string): string | null {
    return this.#map.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.#map.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#map.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#map.set(key, String(value));
  }
}

const globals = globalThis as typeof globalThis & {
  localStorage?: Storage;
  sessionStorage?: Storage;
};

globals.localStorage ??= new MemoryStorage();
globals.sessionStorage ??= new MemoryStorage();

// A clean slate per test: persisted stores are module singletons, so one
// suite's saved session would otherwise leak into the next file's first read.
beforeEach(() => {
  globals.localStorage?.clear();
  globals.sessionStorage?.clear();
});
