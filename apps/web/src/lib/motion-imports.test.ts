import { describe, expect, it } from 'vitest';

import { MOTION_LIBRARY_FILES, MOTION_REGISTRY } from '@/lib/motion-registry';

/**
 * THE GREP TEST — the registry's teeth.
 *
 * `lib/motion-registry.ts` says which files may reach for the `motion` library.
 * A comment cannot enforce that, and neither can `index.css`'s `data-motion`
 * gate: the whole reason the library needs a registry is that its animations are
 * driven from JavaScript and are therefore INVISIBLE to a CSS gate. Every file
 * that imports it has to remember its own reduced-motion branch by hand, so the
 * set of such files has to stay small enough that a reviewer can check them all.
 *
 * This suite reads the real source tree — not a mock, not a module graph — and
 * asserts the set of files containing a `motion` import is EXACTLY the declared
 * allowlist. It fails in both directions on purpose:
 *
 *   • an unlisted file starts animating  → someone added an un-reviewed entry;
 *   • a listed file stops importing      → the allowlist has gone stale, and a
 *     stale allowlist is how the next unlisted file slips in unnoticed.
 *
 * It also guards the PACKAGE. `framer-motion` appears in `pnpm-lock.yaml` only
 * because it is `motion`'s own internal dependency; importing it directly would
 * pull a second copy of the animation runtime into the bundle for no benefit.
 *
 * ── WHY `import.meta.glob` AND NOT `node:fs` ───────────────────────────────
 *
 * `@flowboard/config`'s base tsconfig sets `"types": []`, and `apps/web`
 * deliberately does not opt back in: a web workspace that can name `node:fs` is
 * a web workspace that can accidentally ship a Node global. Vite's glob is the
 * bundler-native way to ask the same question — it is resolved at transform
 * time against the real files on disk, with `?raw` handing back their exact
 * text — so this suite stays inside the boundary it is defending.
 *
 * Node environment (the package default): this reads text, it renders nothing.
 */

/**
 * Every `.ts`/`.tsx` file under `src/`, as raw text.
 *
 * The pattern is ROOT-relative (`/src/**`), not `../**`. Vite rewrites a
 * relative glob key to the shortest specifier that would import it, so files
 * sitting in this very directory would come back as `./motion-policy.ts` while
 * everything else came back as `../components/…` — two shapes to normalise, and
 * the same-directory one is easy to miss because `lib/` is small. A root-anchored
 * pattern gives one shape: `/src/<path>`.
 *
 * `eager` because a test that has to await 500 dynamic imports to decide
 * anything is a test nobody will keep.
 */
const SOURCES: Record<string, string> = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
});

/**
 * A static or dynamic import of the animation runtime.
 *
 * Anchored on the quote so `@/lib/motion-policy`, `./motion-registry` and any
 * other module whose NAME merely starts with "motion" cannot match — the policy
 * module is imported nearly everywhere and is precisely what this test must not
 * flag.
 */
const MOTION_IMPORT =
  /(?:from|import\s*\(|require\s*\()\s*['"](motion(?:\/[^'"]*)?|framer-motion)['"]/u;

/** Only `framer-motion`, which is banned outright — allowlist or not. */
const FRAMER_IMPORT = /(?:from|import\s*\(|require\s*\()\s*['"]framer-motion['"]/u;

/** Glob keys are `/src/components/…`; the registry speaks in `components/…`. */
function relativeToSrc(key: string): string {
  return key.replace(/^\/src\//u, '');
}

const ALPHABETICAL = (a: string, b: string): number => a.localeCompare(b);

/** The files whose text contains a matching import, sorted for a stable diff. */
function filesImporting(pattern: RegExp): string[] {
  return Object.entries(SOURCES)
    .filter(([, source]) => pattern.test(source))
    .map(([key]) => relativeToSrc(key))
    .sort(ALPHABETICAL);
}

describe('the motion library allowlist', () => {
  it('is imported by EXACTLY the files the registry declares', () => {
    // If this fails with an EXTRA file: add a registry entry — with its reduced
    // branch — before adding the file to `MOTION_LIBRARY_FILES`. If it fails
    // with a MISSING file: the allowlist is stale, so shrink it.
    expect(filesImporting(MOTION_IMPORT)).toEqual([...MOTION_LIBRARY_FILES].sort(ALPHABETICAL));
  });

  it('never imports `framer-motion` directly, not even from an allowlisted file', () => {
    expect(filesImporting(FRAMER_IMPORT)).toEqual([]);
  });

  it('does not mistake `lib/motion-policy` for the library', () => {
    // The policy module is imported from dozens of files and its specifier
    // starts with the same six letters. A regex that is not anchored on the
    // opening quote turns this suite into noise on its first run.
    const policy = SOURCES['/src/components/common/MotionCard.tsx'];
    expect(policy).toBeDefined();
    expect(MOTION_IMPORT.test(policy ?? '')).toBe(false);
  });

  it('sees a source tree at all (the glob itself is not silently empty)', () => {
    // Without this, a bad pattern would make every assertion above pass against
    // zero files — the classic way a grep test rots into a no-op.
    const files = Object.keys(SOURCES).map(relativeToSrc);
    expect(files.length).toBeGreaterThan(100);
    expect(files).toContain('lib/motion-policy.ts');
    expect(files).toContain('components/ui/animated-tooltip.tsx');
  });
});

describe('the registry itself', () => {
  it('lists six entries with unique ids', () => {
    const ids = MOTION_REGISTRY.map((entry) => entry.id);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
  });

  it('gives every entry a documented reduced branch — the non-negotiable field', () => {
    for (const entry of MOTION_REGISTRY) {
      expect(entry.reducedBranch.length, entry.id).toBeGreaterThan(20);
      expect(entry.whyNotCss.length, entry.id).toBeGreaterThan(20);
    }
  });

  it('names a real, allowlisted file for every `motion`-library entry', () => {
    const libraryEntries = MOTION_REGISTRY.filter((entry) => entry.driver === 'motion-lib');
    expect(libraryEntries.map((entry) => entry.file).sort(ALPHABETICAL)).toEqual(
      [...MOTION_LIBRARY_FILES].sort(ALPHABETICAL),
    );
    for (const entry of libraryEntries) {
      expect(Object.keys(SOURCES).map(relativeToSrc), entry.id).toContain(entry.file);
    }
  });
});
