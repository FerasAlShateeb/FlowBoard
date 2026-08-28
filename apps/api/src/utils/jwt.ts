/**
 * Access / refresh token minting and verification.
 *
 * Two SEPARATE secrets, by design: a refresh token must never verify as an
 * access token. Even with the `type` claim checked below, distinct secrets mean
 * a leaked access secret cannot be used to mint long-lived sessions.
 *
 * `tokenVersion` rides in both tokens. Bumping `users.token_version` (password
 * change, admin force-revoke, deactivation) invalidates every previously minted
 * token without a denylist.
 *
 * FlowBoard signs its own tokens rather than delegating, but the *credential
 * check* sits behind an `AuthProvider` interface (Wave 2) — that is the LDAP/AD
 * swap point, and it deliberately does not reach into this file.
 */
import jwt, { TokenExpiredError, type JwtPayload } from 'jsonwebtoken';
import { env } from '../config/env';
import { ApiError } from './api-error';

/** Which half of the pair a token is. Checked on every verify. */
export type TokenType = 'access' | 'refresh';

/** The claims FlowBoard puts in (and reads back out of) a token. */
export interface TokenPayload {
  /** `users.id` (uuid). */
  sub: string;
  /** `users.token_version` at mint time. */
  tokenVersion: number;
  /** `users.is_global_admin` at mint time. */
  isGlobalAdmin: boolean;
  type: TokenType;
}

/** Everything a caller supplies; `type` is chosen by the sign function. */
export type TokenClaims = Omit<TokenPayload, 'type'>;

const ALGORITHM = 'HS256' as const;

const DURATION_PATTERN = /^(\d+)(ms|s|m|h|d)$/u;

const UNIT_SECONDS: Record<string, number> = {
  ms: 0.001,
  s: 1,
  m: 60,
  h: 3600,
  d: 86400,
};

/**
 * Parse `ms`-package duration syntax (`15m`, `2h`, `30d`) into whole seconds.
 *
 * Why not hand the string straight to `jsonwebtoken`'s `expiresIn`? Because its
 * types demand `ms`' `StringValue` template-literal type, which `env`'s plain
 * `string` is not — the alternatives are a cast (a type lie) or this, which is
 * six lines, unit-testable, and also gives Wave 2's `/auth/login` response the
 * `expiresIn` number it has to return anyway.
 *
 * @throws {ApiError} 500 when the value is not valid duration syntax. The env
 * schema already rejects those at boot, so reaching this is a programming bug.
 */
export function parseDuration(value: string): number {
  const match = DURATION_PATTERN.exec(value);
  const amount = match?.[1];
  const unit = match?.[2];
  if (amount === undefined || unit === undefined) {
    throw ApiError.internal(`Invalid duration: ${value}`);
  }
  const seconds = Number(amount) * (UNIT_SECONDS[unit] ?? 1);
  return Math.max(1, Math.round(seconds));
}

/** Access-token lifetime in seconds — the `expiresIn` a login response returns. */
export const accessTokenTtlSeconds = parseDuration(env.ACCESS_TOKEN_TTL);

/** Refresh-token lifetime in seconds. */
export const refreshTokenTtlSeconds = parseDuration(env.REFRESH_TOKEN_TTL);

function sign(claims: TokenClaims, type: TokenType): string {
  const secret = type === 'access' ? env.JWT_SECRET : env.JWT_REFRESH_SECRET;
  const expiresIn = type === 'access' ? accessTokenTtlSeconds : refreshTokenTtlSeconds;
  return jwt.sign(
    {
      tokenVersion: claims.tokenVersion,
      isGlobalAdmin: claims.isGlobalAdmin,
      type,
    },
    secret,
    { algorithm: ALGORITHM, subject: claims.sub, expiresIn },
  );
}

/** Mint a short-lived access token. */
export function signAccessToken(claims: TokenClaims): string {
  return sign(claims, 'access');
}

/** Mint a long-lived refresh token. */
export function signRefreshToken(claims: TokenClaims): string {
  return sign(claims, 'refresh');
}

/** Narrow a decoded jsonwebtoken result into our claim shape. */
function toPayload(decoded: string | JwtPayload, expected: TokenType): TokenPayload {
  if (typeof decoded === 'string') {
    throw ApiError.unauthorized('Malformed token');
  }
  const { sub, tokenVersion, isGlobalAdmin, type } = decoded as {
    sub?: unknown;
    tokenVersion?: unknown;
    isGlobalAdmin?: unknown;
    type?: unknown;
  };
  if (
    typeof sub !== 'string' ||
    sub.length === 0 ||
    typeof tokenVersion !== 'number' ||
    !Number.isFinite(tokenVersion) ||
    typeof isGlobalAdmin !== 'boolean' ||
    type !== expected
  ) {
    throw ApiError.unauthorized('Malformed token');
  }
  return { sub, tokenVersion, isGlobalAdmin, type: expected };
}

function verify(token: string, expected: TokenType): TokenPayload {
  const secret = expected === 'access' ? env.JWT_SECRET : env.JWT_REFRESH_SECRET;
  let decoded: string | JwtPayload;
  try {
    decoded = jwt.verify(token, secret, { algorithms: [ALGORITHM] });
  } catch (error) {
    // `token_expired` is its own code (not the generic `unauthorized`) because
    // it is the ONE 401 the web client answers with a silent single-flight
    // refresh instead of bouncing the user to /login.
    if (error instanceof TokenExpiredError) {
      throw new ApiError(401, 'token_expired', `The ${expected} token has expired`);
    }
    throw ApiError.unauthorized('Invalid or expired token');
  }
  return toPayload(decoded, expected);
}

/**
 * Verify an access token.
 *
 * @throws {ApiError} 401 (`unauthorized` / `token_expired`) — never returns a
 * failure value, so a caller cannot forget to check one.
 */
export function verifyAccessToken(token: string): TokenPayload {
  return verify(token, 'access');
}

/** Verify a refresh token. Throws the same 401 shapes as `verifyAccessToken`. */
export function verifyRefreshToken(token: string): TokenPayload {
  return verify(token, 'refresh');
}

/** Pull the token out of an `Authorization: Bearer <token>` header. */
export function extractBearerToken(header: string | undefined): string | null {
  if (header === undefined) return null;
  const prefix = 'Bearer ';
  if (!header.startsWith(prefix)) return null;
  const token = header.slice(prefix.length).trim();
  return token.length > 0 ? token : null;
}
