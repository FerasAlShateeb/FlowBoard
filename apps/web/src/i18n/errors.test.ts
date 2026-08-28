import { describe, expect, it } from 'vitest';

import { ApiError, NETWORK_ERROR_CODE } from '@/lib/api';
import { apiErrorMessage } from '@/i18n/errors';
import enErrors from '@/locales/en/errors';

/**
 * The API-error localization ladder: catalog entry → server message → generic.
 *
 * The middle rung is the one worth guarding. Across five waves of parallel work
 * an unmapped `error.code` is a certainty, and a toast reading "Something went
 * wrong" for a failure the server explained precisely is worse than a sentence
 * in the wrong language.
 */

/** A stand-in for i18next's `t`: resolves `errors:<key>`, echoes a miss. */
const t = (key: string): string => {
  const name = key.startsWith('errors:') ? key.slice('errors:'.length) : key;
  const value = (enErrors as Record<string, string | undefined>)[name];
  // i18next returns the KEY itself when nothing matched, which is exactly how
  // `apiErrorMessage` detects a miss.
  return value ?? key;
};

describe('apiErrorMessage', () => {
  it('uses the catalog entry for a known code', () => {
    const error = new ApiError('Transition not allowed', 409, 'TRANSITION_NOT_ALLOWED');
    expect(apiErrorMessage(t, error)).toBe(enErrors.transition_not_allowed);
  });

  it('normalizes SCREAMING_SNAKE codes to the catalog spelling', () => {
    const upper = new ApiError('x', 409, 'WIP_LIMIT_EXCEEDED');
    const lower = new ApiError('x', 409, 'wip_limit_exceeded');
    expect(apiErrorMessage(t, upper)).toBe(apiErrorMessage(t, lower));
    expect(apiErrorMessage(t, upper)).toBe(enErrors.wip_limit_exceeded);
  });

  it("falls back to the SERVER's message for a code nobody has mapped yet", () => {
    const error = new ApiError('Sprint capacity exceeded', 422, 'SPRINT_CAPACITY_EXCEEDED');
    expect(apiErrorMessage(t, error)).toBe('Sprint capacity exceeded');
  });

  it('falls back to the generic line when an unmapped error has no message', () => {
    const error = new ApiError('', 500, 'SOMETHING_NEW');
    expect(apiErrorMessage(t, error)).toBe(enErrors.unknown);
  });

  it('gives a transport failure advice rather than an error report', () => {
    const error = new ApiError('Could not reach the server.', 0, NETWORK_ERROR_CODE);
    expect(apiErrorMessage(t, error)).toBe(enErrors.network_error);
  });

  it('never leaks a non-ApiError message — that is our bug, not theirs', () => {
    // A `TypeError` from a bad render must not surface its stack-shaped text.
    expect(apiErrorMessage(t, new TypeError('x is not a function'))).toBe(enErrors.unknown);
    expect(apiErrorMessage(t, 'a string')).toBe(enErrors.unknown);
    expect(apiErrorMessage(t, undefined)).toBe(enErrors.unknown);
  });
});
