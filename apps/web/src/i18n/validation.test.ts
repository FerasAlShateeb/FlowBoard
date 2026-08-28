import { VALIDATION_MESSAGES } from '@flowboard/shared';
import { describe, expect, it } from 'vitest';

import i18n from '@/i18n';
import en from '@/locales/en/validation';
import ar from '@/locales/ar/validation';
import { VALIDATION_MESSAGE_KEYS, localizeValidationMessage } from '@/i18n/validation';

/**
 * The contract this file defends: every English validation string a SHARED zod
 * schema can produce has a translation, in every language.
 *
 * The `Record<ValidationMessage, …>` type already makes a missing entry a
 * compile error — but only if the map is written by hand, which it is. These
 * runtime assertions cover the failure the type cannot see: a key that exists in
 * the map but names a catalog entry that was renamed or never added, which
 * i18next answers by echoing the key back at the user.
 */
describe('validation message localization', () => {
  const messages = Object.values(VALIDATION_MESSAGES);

  it('maps every shared validation message', () => {
    for (const message of messages) {
      expect(VALIDATION_MESSAGE_KEYS[message]).toBeDefined();
    }
    expect(Object.keys(VALIDATION_MESSAGE_KEYS)).toHaveLength(new Set(messages).size);
  });

  it('resolves every mapped key to real English copy — never the key itself', () => {
    const t = i18n.getFixedT('en', 'validation');

    for (const message of messages) {
      const key = VALIDATION_MESSAGE_KEYS[message];
      const translated = localizeValidationMessage(t, message);

      expect(translated).not.toBe(key);
      expect(translated.length).toBeGreaterThan(0);
    }
  });

  it('has an Arabic entry for every English key', () => {
    expect(Object.keys(ar).sort()).toEqual(Object.keys(en).sort());
  });

  it('leaves a message it does not own untouched', () => {
    const t = i18n.getFixedT('en', 'validation');

    // Page-supplied, already-translated copy must survive `FormMessage`.
    expect(localizeValidationMessage(t, 'Already translated.')).toBe('Already translated.');
  });
});
