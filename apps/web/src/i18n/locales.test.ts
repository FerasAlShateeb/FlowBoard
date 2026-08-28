import { describe, expect, it } from 'vitest';

import en from '@/locales/en';
import ar from '@/locales/ar';

/**
 * Catalog parity.
 *
 * English owns the key SHAPE (`i18n/i18next.d.ts` types `t()` against it) and
 * is the `fallbackLng`, so the two failure modes are asymmetric:
 *
 *   - a key MISSING from Arabic degrades to English — a leak, caught here;
 *   - a key EXTRA in Arabic is dead weight that no `t()` call can ever reach,
 *     and usually means a rename landed on one side only.
 *
 * Both are asserted as a key DIFF rather than a value-by-value comparison.
 *
 * ═══ THE ONE ALLOWED ASYMMETRY: PLURAL SUFFIXES (WP5.1) ════════════════════
 *
 * i18next resolves a plural key by appending a CLDR category to it, and the two
 * languages do not have the same categories: English has `one` and `other`,
 * Arabic has all six (`zero`, `one`, `two`, `few`, `many`, `other`). A strict
 * key-for-key diff therefore pushes the catalogs into exactly the wrong shape —
 * it was doing so before this wave, where the Arabic side carried a bare
 * `_one`/`_other` pair to satisfy the diff and i18next, finding no `_few` for
 * `count: 3`, silently fell back to the ENGLISH string inside an Arabic
 * sentence. "Exported 11 tasks." in a right-to-left toast is the visible bug;
 * the parity test asserting it was correct is the reason it survived.
 *
 * So the rule is asymmetric on purpose:
 *
 *   - a plural key in English MUST declare `_one` and `_other` (nothing else);
 *   - the same base in Arabic MUST declare ALL SIX categories;
 *   - an Arabic key with no English twin is allowed ONLY when it is another
 *     plural category of an English plural base. Everything else is still drift.
 *
 * Non-plural keys are unaffected and still compared exactly.
 */

/** Flattens a nested catalog to dotted leaf paths. */
function leafKeys(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [prefix];
  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    leafKeys(child, prefix ? `${prefix}.${key}` : key),
  );
}

/** The CLDR categories i18next appends to a plural key, as a key suffix. */
const ENGLISH_PLURAL_CATEGORIES = ['one', 'other'] as const;
const ARABIC_PLURAL_CATEGORIES = ['zero', 'one', 'two', 'few', 'many', 'other'] as const;

const PLURAL_SUFFIX = /_(zero|one|two|few|many|other)$/;

/** Splits `picker.members_few` into its base and its category. */
function pluralParts(key: string): { base: string; category: string } | null {
  const category = PLURAL_SUFFIX.exec(key)?.[1];
  if (category === undefined) return null;
  return { base: key.slice(0, key.length - category.length - 1), category };
}

/** Every plural BASE the English catalog declares, for one namespace. */
function pluralBases(keys: readonly string[]): Set<string> {
  const bases = new Set<string>();
  for (const key of keys) {
    const parts = pluralParts(key);
    if (parts) bases.add(parts.base);
  }
  return bases;
}

const NAMESPACES = Object.keys(en) as (keyof typeof en)[];

describe('locale catalogs', () => {
  it('registers every namespace this wave added', () => {
    // The four WP2.4 namespaces plus the three from Wave 1.
    expect(NAMESPACES).toEqual(
      expect.arrayContaining([
        'common',
        'auth',
        'validation',
        'errors',
        'orgs',
        'settings',
        'workflow',
      ]),
    );
  });

  it('has the SAME namespace list in both catalogs', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
  });

  it.each(NAMESPACES)('`%s` has no key missing from Arabic', (namespace) => {
    const english = leafKeys(en[namespace]);
    const arabic = new Set(leafKeys(ar[namespace as keyof typeof ar]));
    // Plural keys are checked by their own test below, which demands MORE of
    // Arabic than a mirror of the English pair.
    const missing = english.filter((key) => !pluralParts(key) && !arabic.has(key));
    expect(missing).toEqual([]);
  });

  it.each(NAMESPACES)('`%s` has no key in Arabic that English lacks', (namespace) => {
    const english = new Set(leafKeys(en[namespace]));
    const bases = pluralBases([...english]);
    const extra = leafKeys(ar[namespace as keyof typeof ar]).filter((key) => {
      if (english.has(key)) return false;
      // The one allowed asymmetry: another CLDR category of a base English
      // itself declares as a plural. Anything else is drift.
      const parts = pluralParts(key);
      return !(parts && bases.has(parts.base));
    });
    expect(extra).toEqual([]);
  });

  it.each(NAMESPACES)('`%s` declares exactly `_one` and `_other` in English', (namespace) => {
    const english = leafKeys(en[namespace]);
    const byBase = new Map<string, string[]>();
    for (const key of english) {
      const parts = pluralParts(key);
      if (!parts) continue;
      byBase.set(parts.base, [...(byBase.get(parts.base) ?? []), parts.category]);
    }
    for (const [base, categories] of byBase) {
      expect([base, [...categories].sort()]).toEqual([base, [...ENGLISH_PLURAL_CATEGORIES].sort()]);
    }
  });

  it.each(NAMESPACES)('`%s` declares all six Arabic plural categories', (namespace) => {
    const bases = pluralBases(leafKeys(en[namespace]));
    const arabic = new Set(leafKeys(ar[namespace as keyof typeof ar]));
    for (const base of bases) {
      const missing = ARABIC_PLURAL_CATEGORIES.filter(
        (category) => !arabic.has(`${base}_${category}`),
      );
      // Naming the base in the expectation is what makes the failure readable:
      // "orgs picker.members is missing _few" rather than "[] !== ['few']".
      expect([base, missing]).toEqual([base, []]);
    }
  });

  it('leaves no English string sitting in the Arabic catalog', () => {
    // A spot check on the namespaces this wave wrote: an untranslated value is
    // usually a copy-paste that never got replaced. A handful of values are
    // legitimately identical in both catalogs — brand names, language endonyms,
    // and example strings that are Latin identifiers by nature (a project key
    // is uppercase ASCII in every locale; a URL is a URL).
    const ALLOWED_IDENTICAL = new Set([
      'brand',
      'language.english',
      'language.arabic',
      'createProject.keyPlaceholder',
      'profile.avatarPlaceholder',
      // A person's name is a proper noun. Transliterating the example ("آدا
      // لوفلَيس") produced a placeholder no Arabic reader would ever type and
      // taught nothing about the field; the field itself renders whatever
      // alphabet you use, with `dir="auto"`.
      'profile.namePlaceholder',
    ]);

    const suspicious: string[] = [];
    for (const namespace of ['errors', 'orgs', 'settings', 'workflow'] as const) {
      const enLeaves = leafKeys(en[namespace]);
      for (const path of enLeaves) {
        if (ALLOWED_IDENTICAL.has(path)) continue;
        const enValue = read(en[namespace], path);
        const arValue = read(ar[namespace], path);
        if (typeof enValue !== 'string' || typeof arValue !== 'string') continue;
        // Values that are only an interpolation ("{{count}}/{{limit}}") carry
        // no words and are correctly identical.
        if (/^[\s{}\w/:.-]*$/.test(enValue) && enValue.includes('{{')) continue;
        if (enValue === arValue) suspicious.push(`${namespace}.${path}`);
      }
    }
    expect(suspicious).toEqual([]);
  });
});

/** Reads a dotted path out of a catalog namespace. */
function read(source: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((value, segment) => {
    if (value === null || typeof value !== 'object') return undefined;
    return (value as Record<string, unknown>)[segment];
  }, source);
}
