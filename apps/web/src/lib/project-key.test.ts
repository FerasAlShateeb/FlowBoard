import { describe, expect, it } from 'vitest';
import { projectKeySchema } from '@flowboard/shared';

import { normalizeProjectKey, suggestProjectKey } from '@/lib/project-key';

/**
 * A project key is typed once and read forever — it prefixes every task id
 * anyone pastes into a commit message, and it cannot be changed afterwards. So
 * the suggestion has one hard requirement: anything it produces must be
 * VALID INPUT for `projectKeySchema`, or the create dialog offers a value that
 * the form then rejects.
 */
describe('suggestProjectKey', () => {
  it('takes the initials of a multi-word name', () => {
    expect(suggestProjectKey('Payments Platform')).toBe('PP');
    expect(suggestProjectKey('Payments Platform Core')).toBe('PPC');
  });

  it('falls back to the first characters of a single word', () => {
    expect(suggestProjectKey('Payments')).toBe('PAYM');
  });

  it('never starts a key with a digit', () => {
    // `projectKeySchema` requires a leading letter, so "2024 Roadmap" cannot
    // suggest `2R`.
    const suggested = suggestProjectKey('2024 Roadmap');
    expect(suggested.startsWith('2')).toBe(false);
    expect(suggested).toBe('ROAD');
  });

  it('returns nothing rather than inventing a key from a non-Latin name', () => {
    expect(suggestProjectKey('لوحة المشاريع')).toBe('');
    expect(suggestProjectKey('🚀')).toBe('');
    expect(suggestProjectKey('   ')).toBe('');
  });

  it('produces a value the shared schema accepts, for every non-empty result', () => {
    const names = [
      'Payments Platform',
      'Payments',
      '2024 Roadmap',
      'Alpha',
      'a b c d e f g h i j k l',
      'Design-System Tokens',
    ];

    for (const name of names) {
      const suggested = suggestProjectKey(name);
      if (suggested === '') continue;
      expect(projectKeySchema.safeParse(suggested).success).toBe(true);
    }
  });
});

describe('normalizeProjectKey', () => {
  it('uppercases and strips characters a key may not contain', () => {
    expect(normalizeProjectKey('pay-1 ments')).toBe('PAY1MENTS');
  });

  it('drops leading digits, which cannot open a key', () => {
    expect(normalizeProjectKey('24fb')).toBe('FB');
  });

  it('caps the length at the schema ceiling', () => {
    expect(normalizeProjectKey('ABCDEFGHIJKLMNOP')).toHaveLength(10);
  });

  it('can only produce values the schema accepts, once long enough', () => {
    const normalized = normalizeProjectKey('  pay!ments  ');
    expect(projectKeySchema.safeParse(normalized).success).toBe(true);
  });
});
