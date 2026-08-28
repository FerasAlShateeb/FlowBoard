/**
 * Rate limiting (express-rate-limit v8).
 *
 * Keyed by user id when the request is authenticated, else by the client IP —
 * with IPv6 collapsed to its /56 subnet through `ipKeyGenerator`, because a
 * single IPv6 host is handed billions of addresses and a per-address counter
 * would be no limit at all.
 *
 * A tripped limiter does NOT write its own body: it forwards an `ApiError` to
 * `next()` so the single `errorHandler` renders the envelope. One formatter,
 * including for 429s.
 *
 * ⚠️ SCALING BOUNDARY — the counters live in express-rate-limit's in-process
 * `MemoryStore`, so two API replicas means two independent sets of counters and
 * up to N× the advertised limit. That matters most for `authRateLimit`, which
 * IS the brute-force ceiling. Horizontal scaling swaps in `rate-limit-redis`
 * through `makeRateLimit`'s overrides; nothing else changes.
 */
import type { Request } from 'express';
import rateLimit, {
  ipKeyGenerator,
  type Options,
  type RateLimitRequestHandler,
} from 'express-rate-limit';
import { ApiError } from '../utils/api-error';
import { extractBearerToken, verifyAccessToken } from '../utils/jwt';

/** The IP bucket, IPv6 collapsed to its /56. The fallback for every key. */
function ipKey(req: Request): string {
  return `ip:${ipKeyGenerator(req.ip ?? 'unknown')}`;
}

/**
 * Authenticated requests get their own bucket; anonymous ones share by IP.
 *
 * ── WHY THIS VERIFIES A TOKEN INSTEAD OF READING `req.user` ────────────────
 * `defaultRateLimit` is mounted on `/api`, ABOVE `requireAuth`, so by the time
 * it runs `req.user` is still undefined on every request — including the
 * authenticated ones. Reading it alone therefore made the global limiter key by
 * IP always, and one shared office NAT (or one docker host, or one reverse
 * proxy that is not forwarding `X-Forwarded-For`) meant every user behind it
 * shared a single 300/minute budget. The `req.user` branch is kept for limiters
 * that ARE mounted after the guard, where it saves the verification.
 *
 * The verification is a plain HMAC-SHA256 over a short string — microseconds,
 * no I/O, no database — which is why doing it twice per request is affordable.
 *
 * ── AN INVALID TOKEN GETS NO BUCKET OF ITS OWN ─────────────────────────────
 * A signature failure (or an expired token, or a refresh token presented as an
 * access token) falls back to the IP bucket rather than keying on whatever the
 * unverified `sub` claimed. Trusting an unverified claim would hand any client a
 * fresh 300/minute budget per forged token — an unlimited limiter with extra
 * steps. Decoding without verifying is the same bug in a different shape, so it
 * is not offered as a fast path either.
 */
function keyByUserOrIp(req: Request): string {
  const userId = req.user?.id;
  if (userId !== undefined) return `user:${userId}`;

  const token = extractBearerToken(req.headers.authorization);
  if (token === null) return ipKey(req);
  try {
    return `user:${verifyAccessToken(token).sub}`;
  } catch {
    // Unverifiable: anonymous as far as the limiter is concerned. The 401 that
    // this request is about to earn is `requireAuth`'s job, not the limiter's.
    return ipKey(req);
  }
}

/**
 * Credential endpoints key by IP **only**.
 *
 * If they keyed by user, an attacker holding any one valid Bearer token could
 * attach it to login attempts against a VICTIM's email and mint a private
 * counter per token, sidestepping the shared per-IP ceiling entirely.
 */
function keyByIpOnly(req: Request): string {
  return ipKey(req);
}

export interface RateLimitConfig {
  /** Rolling window length in milliseconds. */
  windowMs: number;
  /** Max requests per key per window. */
  limit: number;
  /** `user-or-ip` (default) or `ip` for credential endpoints. */
  keyedBy?: 'ip' | 'user-or-ip';
  /** Escape hatch for anything the two fields above do not model (e.g. a store). */
  overrides?: Partial<Options>;
}

/** Build a limiter with FlowBoard's defaults. */
export function makeRateLimit({
  windowMs,
  limit,
  keyedBy = 'user-or-ip',
  overrides = {},
}: RateLimitConfig): RateLimitRequestHandler {
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: keyedBy === 'ip' ? keyByIpOnly : keyByUserOrIp,
    handler: (_req, _res, next) => {
      next(ApiError.tooManyRequests());
    },
    ...overrides,
  });
}

/** Generous global limiter mounted on `/api` — 300 requests per minute. */
export const defaultRateLimit: RateLimitRequestHandler = makeRateLimit({
  windowMs: 60_000,
  limit: 300,
});

/** Brute-force ceiling for `/api/auth/*` — 10 attempts per minute per IP. */
export const authRateLimit: RateLimitRequestHandler = makeRateLimit({
  windowMs: 60_000,
  limit: 10,
  keyedBy: 'ip',
});
