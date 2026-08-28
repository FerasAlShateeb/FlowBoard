/**
 * scrypt hashing and verification.
 *
 * The happy path is exercised by every login test in the identity suite. What
 * is NOT exercised there — and is the whole reason the stored string carries
 * its parameters — is what `verifyPassword` does with a string that is not a
 * hash it wrote: a bcrypt hash left by a fixture, a truncated row, a value with
 * a non-numeric cost parameter. Every one of those must answer `false`, because
 * the alternative is a throw on the login path, and a throw during credential
 * checking is a 500 where a 401 belongs.
 */
import { describe, expect, it } from 'vitest';

import { hashPassword, verifyPassword } from './password';

const PASSWORD = 'correct-horse-battery-staple';

describe('hashPassword', () => {
  it('produces the documented `scrypt$N$r$p$salt$hash` format', async () => {
    const stored = await hashPassword(PASSWORD);
    const parts = stored.split('$');

    expect(parts).toHaveLength(6);
    expect(parts[0]).toBe('scrypt');
    // The parameters travel WITH the hash so they can be raised later without
    // invalidating every row already in the table.
    expect(Number(parts[1])).toBe(16384);
    expect(Number(parts[2])).toBe(8);
    expect(Number(parts[3])).toBe(1);
  });

  it('salts, so the same password never hashes to the same string twice', async () => {
    const [first, second] = await Promise.all([hashPassword(PASSWORD), hashPassword(PASSWORD)]);

    expect(first).not.toBe(second);
    // …and both still verify.
    expect(await verifyPassword(PASSWORD, first)).toBe(true);
    expect(await verifyPassword(PASSWORD, second)).toBe(true);
  });

  it('never puts the password itself in the output', async () => {
    expect(await hashPassword(PASSWORD)).not.toContain(PASSWORD);
  });
});

describe('verifyPassword', () => {
  it('accepts the right password and refuses the wrong one', async () => {
    const stored = await hashPassword(PASSWORD);

    expect(await verifyPassword(PASSWORD, stored)).toBe(true);
    expect(await verifyPassword(`${PASSWORD}!`, stored)).toBe(false);
    expect(await verifyPassword('', stored)).toBe(false);
  });

  it('is case- and whitespace-sensitive', async () => {
    const stored = await hashPassword(PASSWORD);

    expect(await verifyPassword(PASSWORD.toUpperCase(), stored)).toBe(false);
    expect(await verifyPassword(` ${PASSWORD}`, stored)).toBe(false);
  });

  it.each([
    ['an empty string', ''],
    [
      'a bcrypt hash from a fixture',
      '$2b$10$abcdefghijklmnopqrstuv0123456789012345678901234567890',
    ],
    ['a truncated record', 'scrypt$16384$8$1$c2FsdA'],
    ['too many segments', 'scrypt$16384$8$1$c2FsdA$aGFzaA$extra'],
    ['a different algorithm marker', 'argon2$16384$8$1$c2FsdA$aGFzaA'],
    ['plain text', 'hunter2'],
  ])('returns false for %s rather than throwing', async (_label, stored) => {
    await expect(verifyPassword(PASSWORD, stored)).resolves.toBe(false);
  });

  it.each([
    ['a non-numeric cost', 'scrypt$abc$8$1$c2FsdA$aGFzaA'],
    ['a fractional block size', 'scrypt$16384$8.5$1$c2FsdA$aGFzaA'],
    ['an empty parallelism field', 'scrypt$16384$8$$c2FsdA$aGFzaA'],
  ])('returns false for %s instead of handing garbage to scrypt', async (_label, stored) => {
    // `Number('abc')` is NaN and `Number('8.5')` is fractional, so the integer
    // guard stops both before the KDF. The empty field coerces to 0, which IS
    // an integer and gets through — it is caught one step later by the length
    // comparison, and answering `false` is the behaviour that matters either
    // way: a malformed row must be a failed login, never a 500.
    await expect(verifyPassword(PASSWORD, stored)).resolves.toBe(false);
  });

  it('returns false when the stored hash is the wrong LENGTH for its parameters', async () => {
    // `timingSafeEqual` throws on mismatched buffer lengths, so the length is
    // checked first — a row whose hash was truncated by a bad migration must be
    // a failed login, not a 500.
    const stored = await hashPassword(PASSWORD);
    const parts = stored.split('$');
    const truncated = [...parts.slice(0, 5), parts[5]?.slice(0, 20) ?? ''].join('$');

    await expect(verifyPassword(PASSWORD, truncated)).resolves.toBe(false);
  });

  it('reads the parameters back OUT of the stored string, not from the constants', async () => {
    // The forward-compatibility promise: a hash written with weaker parameters
    // keeps verifying after the constants are raised.
    const stored = await hashPassword(PASSWORD);
    const parts = stored.split('$');
    expect(parts[1]).toBe('16384');

    // Re-parameterising the string without re-deriving must NOT verify — which
    // is the proof that the parameters are actually used, rather than ignored
    // in favour of the module constants.
    const lied = ['scrypt', '1024', ...parts.slice(2)].join('$');
    await expect(verifyPassword(PASSWORD, lied)).resolves.toBe(false);
  });
});
