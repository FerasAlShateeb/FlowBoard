import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { env } from '../config/env';
import { ApiError } from './api-error';
import {
  accessTokenTtlSeconds,
  extractBearerToken,
  parseDuration,
  refreshTokenTtlSeconds,
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} from './jwt';

const claims = { sub: 'user-1', tokenVersion: 3, isGlobalAdmin: false };

/** Hand-rolled token body. `sub` travels in `options.subject`, never inline —
 *  jsonwebtoken refuses a payload that carries both. */
const body = { tokenVersion: claims.tokenVersion, isGlobalAdmin: claims.isGlobalAdmin };

describe('parseDuration', () => {
  it.each([
    ['500ms', 1],
    ['30s', 30],
    ['15m', 900],
    ['2h', 7200],
    ['30d', 2_592_000],
  ])('parses %s', (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it('never returns less than one second', () => {
    expect(parseDuration('1ms')).toBe(1);
  });

  it('throws on unparseable syntax', () => {
    expect(() => parseDuration('forever')).toThrow(ApiError);
    expect(() => parseDuration('15')).toThrow(ApiError);
    expect(() => parseDuration('15w')).toThrow(ApiError);
  });

  it('derives the exported TTLs from env', () => {
    expect(accessTokenTtlSeconds).toBe(parseDuration(env.ACCESS_TOKEN_TTL));
    expect(refreshTokenTtlSeconds).toBe(parseDuration(env.REFRESH_TOKEN_TTL));
  });
});

describe('access tokens', () => {
  it('round-trips every claim', () => {
    const payload = verifyAccessToken(signAccessToken(claims));
    expect(payload).toEqual({ ...claims, type: 'access' });
  });

  it('carries isGlobalAdmin faithfully', () => {
    const payload = verifyAccessToken(signAccessToken({ ...claims, isGlobalAdmin: true }));
    expect(payload.isGlobalAdmin).toBe(true);
  });

  it('sets an expiry from ACCESS_TOKEN_TTL', () => {
    const decoded = jwt.decode(signAccessToken(claims));
    expect(decoded).toBeTypeOf('object');
    const { iat, exp } = decoded as { iat: number; exp: number };
    expect(exp - iat).toBe(accessTokenTtlSeconds);
  });
});

describe('refresh tokens', () => {
  it('round-trips every claim', () => {
    const payload = verifyRefreshToken(signRefreshToken(claims));
    expect(payload).toEqual({ ...claims, type: 'refresh' });
  });

  it('uses a longer TTL than the access token', () => {
    expect(refreshTokenTtlSeconds).toBeGreaterThan(accessTokenTtlSeconds);
  });
});

describe('cross-verification is impossible', () => {
  it('rejects a refresh token at the access door', () => {
    expect(() => verifyAccessToken(signRefreshToken(claims))).toThrow(ApiError);
  });

  it('rejects an access token at the refresh door', () => {
    expect(() => verifyRefreshToken(signAccessToken(claims))).toThrow(ApiError);
  });

  it('rejects a token whose `type` claim was forged onto the right secret', () => {
    // Same secret, wrong type claim — the type check is a second lock, not the
    // only one.
    const forged = jwt.sign({ ...body, type: 'refresh' }, env.JWT_SECRET, {
      algorithm: 'HS256',
      subject: claims.sub,
    });
    expect(() => verifyAccessToken(forged)).toThrow(/Malformed token/u);
  });
});

describe('verification failures', () => {
  it('throws 401 unauthorized for a garbage token', () => {
    try {
      verifyAccessToken('not-a-token');
      expect.unreachable('should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError);
      expect((error as ApiError).status).toBe(401);
      expect((error as ApiError).code).toBe('unauthorized');
    }
  });

  it('throws 401 for a token signed with the wrong secret', () => {
    const wrong = jwt.sign({ ...body, type: 'access' }, 'some-other-secret', {
      algorithm: 'HS256',
      subject: claims.sub,
    });
    expect(() => verifyAccessToken(wrong)).toThrow(ApiError);
  });

  it('reports an expired token with its own `token_expired` code', () => {
    const expired = jwt.sign({ ...body, type: 'access' }, env.JWT_SECRET, {
      algorithm: 'HS256',
      subject: claims.sub,
      expiresIn: -10,
    });
    try {
      verifyAccessToken(expired);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ApiError).code).toBe('token_expired');
      expect((error as ApiError).status).toBe(401);
    }
  });

  it('rejects a token missing tokenVersion', () => {
    const incomplete = jwt.sign({ isGlobalAdmin: false, type: 'access' }, env.JWT_SECRET, {
      algorithm: 'HS256',
      subject: claims.sub,
    });
    expect(() => verifyAccessToken(incomplete)).toThrow(/Malformed token/u);
  });

  it('reports an expired REFRESH token with the same code, naming its own half', () => {
    // The web client keys its single-flight refresh on `token_expired`; the
    // refresh door has to speak the same code or an aged-out session becomes a
    // silent generic 401 the client cannot tell from a revocation.
    const expired = jwt.sign({ ...body, type: 'refresh' }, env.JWT_REFRESH_SECRET, {
      algorithm: 'HS256',
      subject: claims.sub,
      expiresIn: -10,
    });
    try {
      verifyRefreshToken(expired);
      expect.unreachable('should have thrown');
    } catch (error) {
      expect((error as ApiError).code).toBe('token_expired');
      expect((error as ApiError).message).toContain('refresh');
    }
  });

  it('rejects a token whose payload is a bare string rather than a claim set', () => {
    // `jwt.sign` accepts a raw string body, and `jwt.verify` hands it straight
    // back — there is no `sub` to read, so this must fail closed rather than
    // narrow `string` into a payload shape.
    const stringPayload = jwt.sign('not-a-claim-set', env.JWT_SECRET, { algorithm: 'HS256' });
    expect(() => verifyAccessToken(stringPayload)).toThrow(/Malformed token/u);
  });

  it.each([
    ['a non-boolean isGlobalAdmin', { tokenVersion: 3, isGlobalAdmin: 'yes', type: 'access' }],
    ['a string tokenVersion', { tokenVersion: '3', isGlobalAdmin: false, type: 'access' }],
    ['a non-finite tokenVersion', { tokenVersion: null, isGlobalAdmin: false, type: 'access' }],
    ['no isGlobalAdmin at all', { tokenVersion: 3, type: 'access' }],
  ])('rejects %s, even correctly signed', (_label, payload) => {
    const token = jwt.sign(payload, env.JWT_SECRET, {
      algorithm: 'HS256',
      subject: claims.sub,
    });
    expect(() => verifyAccessToken(token)).toThrow(/Malformed token/u);
  });

  it('rejects a token with an empty subject', () => {
    const token = jwt.sign({ ...body, type: 'access' }, env.JWT_SECRET, {
      algorithm: 'HS256',
      subject: '',
    });
    expect(() => verifyAccessToken(token)).toThrow(/Malformed token/u);
  });

  it('rejects a token with no subject at all', () => {
    const token = jwt.sign({ ...body, type: 'access' }, env.JWT_SECRET, { algorithm: 'HS256' });
    expect(() => verifyAccessToken(token)).toThrow(/Malformed token/u);
  });

  it('rejects the "none" algorithm', () => {
    const unsigned = [
      Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url'),
      Buffer.from(JSON.stringify({ ...claims, type: 'access', exp: 4_102_444_800 })).toString(
        'base64url',
      ),
      '',
    ].join('.');
    expect(() => verifyAccessToken(unsigned)).toThrow(ApiError);
  });
});

describe('extractBearerToken', () => {
  it('reads the token out of a Bearer header', () => {
    expect(extractBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
  });

  it.each([undefined, '', 'abc.def.ghi', 'Basic abc', 'Bearer ', 'bearer abc'])(
    'returns null for %o',
    (header) => {
      expect(extractBearerToken(header)).toBeNull();
    },
  );
});
