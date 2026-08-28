/**
 * The rate limiter, driven through a real Express app to a real 429.
 *
 * ── WHY THE FACTORY AND NOT A ROUTE ────────────────────────────────────────
 * The mounted limiters are 300/minute (`defaultRateLimit`) and 10/minute
 * (`authRateLimit`), and the route suites share one process — so proving either
 * of them by exhausting it would either take 301 requests or poison every later
 * suite's budget for a minute. The route suites therefore skip the limiter
 * entirely, which left the ONE behaviour that matters (does a tripped limiter
 * actually render the envelope?) unproven anywhere.
 *
 * `makeRateLimit` is what both mounted limiters are built from, so a two-request
 * limiter from the same factory tests the same code with none of that cost.
 *
 * Every app below mounts `errorHandler`, because the limiter deliberately does
 * NOT write its own body: it forwards `ApiError.tooManyRequests()` to `next()`
 * so there is one formatter for 429s and for everything else.
 */
import express, { type Express, type Request, type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';

import { signAccessToken } from '../utils/jwt';
import { errorHandler } from './error-handler';
import { makeRateLimit, type RateLimitConfig } from './rate-limit';

/** A bearer token for a made-up account. Signed, so it verifies. */
function tokenFor(userId: string): string {
  return `Bearer ${signAccessToken({ sub: userId, tokenVersion: 0, isGlobalAdmin: false })}`;
}

/**
 * An app whose only route is behind the limiter.
 *
 * `before` stands in for a guard mounted ABOVE the limiter — the one arrangement
 * in which `req.user` is already populated when the key generator runs.
 */
function limitedApp(config: RateLimitConfig, before?: RequestHandler): Express {
  const app = express();
  if (before) app.use(before);
  app.use(makeRateLimit(config));
  app.get('/thing', (_req, res) => {
    res.status(200).json({ success: true, data: { ok: true } });
  });
  app.use(errorHandler);
  return app;
}

/** `GET /thing`, optionally presenting an `Authorization` header. */
function get(app: Express, authorization?: string) {
  const pending = request(app).get('/thing');
  return authorization === undefined ? pending : pending.set('Authorization', authorization);
}

describe('makeRateLimit — the 429', () => {
  it('serves up to the limit, then answers the error envelope', async () => {
    const app = limitedApp({ windowMs: 60_000, limit: 2 });

    expect((await get(app)).status).toBe(200);
    expect((await get(app)).status).toBe(200);

    const blocked = await get(app);
    expect(blocked.status).toBe(429);
    expect(blocked.body).toEqual({
      success: false,
      error: { code: 'rate_limited', message: 'Too many requests' },
    });
  });

  it('advertises the window with draft-7 headers and no legacy ones', async () => {
    const app = limitedApp({ windowMs: 60_000, limit: 2 });

    const response = await get(app);

    // One header describing the whole policy, per draft-7 — not the three
    // `X-RateLimit-*` headers of the legacy scheme.
    expect(response.headers['ratelimit']).toBeDefined();
    expect(response.headers['x-ratelimit-limit']).toBeUndefined();
  });
});

describe('keyByUserOrIp — who shares a budget with whom', () => {
  /**
   * THE BUG THIS FILE EXISTS FOR.
   *
   * `defaultRateLimit` is mounted on `/api`, above `requireAuth`, so `req.user`
   * is undefined for every request that reaches it — which silently made the
   * global limiter key by IP for everyone. One office NAT, one shared budget.
   * The key generator now verifies the bearer token itself.
   */
  it('gives two users behind ONE IP separate budgets', async () => {
    const app = limitedApp({ windowMs: 60_000, limit: 1 });
    const ada = tokenFor('11111111-1111-4111-8111-111111111111');
    const ben = tokenFor('22222222-2222-4222-8222-222222222222');

    expect((await get(app, ada)).status).toBe(200);
    expect((await get(app, ada)).status).toBe(429);
    // Same socket, same source address, untouched budget.
    expect((await get(app, ben)).status).toBe(200);
  });

  it('still prefers req.user when a guard ran first — no second verification', async () => {
    const app = limitedApp({ windowMs: 60_000, limit: 1 }, (req: Request, _res, next) => {
      req.user = {
        id: '33333333-3333-4333-8333-333333333333',
        isGlobalAdmin: false,
        tokenVersion: 0,
      };
      next();
    });

    // No `Authorization` header at all, yet the two requests share a USER
    // bucket rather than the IP one — which is what `req.user` keying means.
    expect((await get(app)).status).toBe(200);
    expect((await get(app)).status).toBe(429);
  });

  it('shares one IP bucket between anonymous callers', async () => {
    const app = limitedApp({ windowMs: 60_000, limit: 1 });

    expect((await get(app)).status).toBe(200);
    expect((await get(app)).status).toBe(429);
  });

  /**
   * THE SPOOFING GUARD.
   *
   * If an unverifiable token were keyed on its `sub` claim, any client could
   * mint a fresh budget per forged token and the limiter would be decorative.
   * A bad signature therefore falls back to the IP bucket — which the anonymous
   * request before it has already spent.
   */
  it.each([
    ['a forged signature', 'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJoYWNrZXIifQ.not-a-signature'],
    ['a refresh token presented as an access token', 'Bearer not.a.token'],
    ['an empty bearer', 'Bearer '],
  ])('does not hand %s a bucket of its own', async (_name, header) => {
    const app = limitedApp({ windowMs: 60_000, limit: 1 });

    expect((await get(app)).status).toBe(200);
    expect((await get(app, header)).status).toBe(429);
  });

  it('does not let a valid token escape a budget the IP already spent', async () => {
    // The mirror of the case above: a VALID token gets its own bucket, so the
    // IP's exhausted budget must not follow it.
    const app = limitedApp({ windowMs: 60_000, limit: 1 });

    expect((await get(app)).status).toBe(200);
    expect((await get(app)).status).toBe(429);
    expect((await get(app, tokenFor('44444444-4444-4444-8444-444444444444'))).status).toBe(200);
  });
});

describe('keyedBy: ip — the credential endpoints', () => {
  /**
   * `/api/auth/*` keys by IP ONLY. If it keyed by user, an attacker holding any
   * one valid token could attach it to login attempts against a victim's email
   * and mint a private counter per token, sidestepping the shared ceiling.
   */
  it('ignores the bearer token entirely', async () => {
    const app = limitedApp({ windowMs: 60_000, limit: 1, keyedBy: 'ip' });

    expect((await get(app, tokenFor('55555555-5555-4555-8555-555555555555'))).status).toBe(200);
    expect((await get(app, tokenFor('66666666-6666-4666-8666-666666666666'))).status).toBe(429);
  });
});
