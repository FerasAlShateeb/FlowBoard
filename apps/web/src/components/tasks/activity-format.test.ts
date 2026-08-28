import { describe, expect, it } from 'vitest';
import { activityActionSchema } from '@flowboard/shared';

import en from '@/locales/en';
import ar from '@/locales/ar';
import {
  ACTIVITY_FIELD_KEYS,
  ACTIVITY_SENTENCE_KEYS,
  activityFieldKey,
  activitySentenceKey,
  formatActivityValue,
} from '@/components/tasks/activity-format';

/**
 * The activity sentence map — and the exhaustiveness gate.
 *
 * `activityActionSchema` is CLOSED so that this mapping can be total, and the
 * whole point of that closure is defeated the moment an action exists with no
 * sentence: the feed would render `task.moved_sprint` as prose. TypeScript
 * already catches a MISSING key (`satisfies Record<ActivityAction, …>`), but it
 * cannot check that the key resolves to real copy in the catalogs — a key
 * pointing at nothing renders as the key itself, in both languages, and only at
 * runtime. That is what the first two tests here are for.
 */

/** Walks a dotted path out of a catalog, ignoring the `<ns>:` prefix. */
function readCatalogKey(catalog: unknown, fullKey: string): unknown {
  const [namespace = '', path = ''] = fullKey.split(':');
  const root = (catalog as Record<string, unknown>)[namespace];
  return path
    .split('.')
    .reduce<unknown>(
      (value, segment) =>
        value === null || typeof value !== 'object'
          ? undefined
          : (value as Record<string, unknown>)[segment],
      root,
    );
}

const ACTIONS = activityActionSchema.options;

describe('the activity sentence map', () => {
  it('covers EVERY action in the shared closed enum', () => {
    const mapped = Object.keys(ACTIVITY_SENTENCE_KEYS).sort();
    expect(mapped).toEqual([...ACTIONS].sort());
  });

  it.each(ACTIONS)('`%s` resolves to real copy in BOTH catalogs', (action) => {
    const key = activitySentenceKey(action);

    const english = readCatalogKey(en, key);
    const arabic = readCatalogKey(ar, key);

    expect(typeof english).toBe('string');
    expect(typeof arabic).toBe('string');
    expect(english).not.toBe('');
    expect(arabic).not.toBe('');
  });

  it.each(ACTIONS)('`%s` names {{actor}}, so the options bag is uniform', (action) => {
    // The renderer indexes this map DYNAMICALLY and passes one options object.
    // A sentence that used a variable nobody supplies would print the raw
    // placeholder, so the contract is: every sentence takes `{{actor}}`.
    expect(readCatalogKey(en, activitySentenceKey(action))).toContain('{{actor}}');
    expect(readCatalogKey(ar, activitySentenceKey(action))).toContain('{{actor}}');
  });

  it('maps every action to a distinct key', () => {
    const values = Object.values(ACTIVITY_SENTENCE_KEYS);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe('activityFieldKey', () => {
  it('maps a known column name', () => {
    expect(activityFieldKey('storyPoints')).toBe(ACTIVITY_FIELD_KEYS.storyPoints);
    expect(activityFieldKey('statusId')).toBe(ACTIVITY_FIELD_KEYS.statusId);
  });

  it('falls back to `unknown` for a column it has never heard of', () => {
    // A row written by a field added in a later wave must not put a bare
    // `somethingNew` into an Arabic sentence.
    expect(activityFieldKey('somethingNew')).toBe(ACTIVITY_FIELD_KEYS.unknown);
    expect(activityFieldKey(undefined)).toBe(ACTIVITY_FIELD_KEYS.unknown);
    expect(activityFieldKey(42)).toBe(ACTIVITY_FIELD_KEYS.unknown);
    expect(activityFieldKey({ nested: true })).toBe(ACTIVITY_FIELD_KEYS.unknown);
  });

  it('resolves every field key in both catalogs', () => {
    for (const key of Object.values(ACTIVITY_FIELD_KEYS)) {
      expect(typeof readCatalogKey(en, key)).toBe('string');
      expect(typeof readCatalogKey(ar, key)).toBe('string');
    }
  });
});

describe('formatActivityValue', () => {
  it('renders primitives, with Western digits for numbers', () => {
    expect(formatActivityValue('High')).toBe('High');
    expect(formatActivityValue(0.5)).toBe('0.5');
    expect(formatActivityValue(3)).toBe('3');
    expect(formatActivityValue(true)).toBe('true');
  });

  it('answers null for "nothing", which the caller renders as a word', () => {
    expect(formatActivityValue(null)).toBeNull();
    expect(formatActivityValue(undefined)).toBeNull();
    expect(formatActivityValue('   ')).toBeNull();
    expect(formatActivityValue(Number.POSITIVE_INFINITY)).toBeNull();
  });

  it('swaps a uuid for the name it points at when a lookup is supplied', () => {
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    expect(formatActivityValue(id, () => 'In Progress')).toBe('In Progress');
  });

  it('keeps the raw id when the lookup does not know it', () => {
    // A status deleted since, or a member removed from the org. The id is ugly
    // but honest; inventing a name would be worse.
    const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
    expect(formatActivityValue(id, () => null)).toBe(id);
  });

  it('falls back to capped JSON for a shape it does not recognise', () => {
    expect(formatActivityValue(['a', 'b'])).toBe('["a","b"]');

    const long = formatActivityValue({ note: 'x'.repeat(200) });
    expect(long).not.toBeNull();
    expect((long ?? '').length).toBeLessThanOrEqual(80);
    expect(long).toMatch(/…$/u);
  });

  it('cannot throw on a value that will not serialise', () => {
    // A circular jsonb value should be impossible, but a feed that threw would
    // take the whole task sheet down with it.
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    expect(formatActivityValue(circular)).toBeNull();
  });
});
