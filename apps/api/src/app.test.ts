import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp } from './app';
import { setDbHealthChecker } from './controllers/health.controller';
import { setRequestLogSink } from './middlewares/request-logger';
import { signAccessToken } from './utils/jwt';
import { clearRing, push } from './utils/log-ring';

const app = createApp();

describe('GET /api/health', () => {
  afterEach(() => {
    setDbHealthChecker(null);
    setRequestLogSink(null);
  });

  it('answers with the success envelope', async () => {
    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data).toMatchObject({ status: 'ok', db: 'unknown' });
    expect(response.body.data.uptimeSeconds).toBeTypeOf('number');
    expect(response.body.data.timestamp).toBeTypeOf('string');
  });

  it('reports db: ok once a checker is wired', async () => {
    setDbHealthChecker(() => Promise.resolve(true));

    const response = await request(app).get('/api/health');

    expect(response.status).toBe(200);
    expect(response.body.data.db).toBe('ok');
  });

  it('503s with an error envelope when the database ping fails', async () => {
    setDbHealthChecker(() => Promise.reject(new Error('ECONNREFUSED')));

    const response = await request(app).get('/api/health');

    expect(response.status).toBe(503);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('service_unavailable');
  });
});

describe('unmatched routes', () => {
  it('return a 404 envelope, not Express HTML', async () => {
    const response = await request(app).get('/api/does-not-exist');

    expect(response.status).toBe(404);
    expect(response.headers['content-type']).toMatch(/application\/json/u);
    expect(response.body).toEqual({
      success: false,
      error: { code: 'not_found', message: 'Cannot GET /api/does-not-exist' },
    });
  });

  it('cover non-/api URLs too', async () => {
    const response = await request(app).get('/totally/elsewhere');
    expect(response.status).toBe(404);
    expect(response.body.error.code).toBe('not_found');
  });
});

describe('hardening', () => {
  it('does not advertise Express', async () => {
    const response = await request(app).get('/api/health');
    expect(response.headers['x-powered-by']).toBeUndefined();
  });

  it('reflects the configured CORS origin with credentials', async () => {
    const response = await request(app).get('/api/health').set('Origin', 'http://localhost:5173');

    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
  });

  it('exposes the rate-limit headers on /api', async () => {
    const response = await request(app).get('/api/health');
    expect(response.headers['ratelimit-policy']).toBeDefined();
  });
});

describe('GET /api/admin/logs', () => {
  afterEach(() => {
    clearRing();
  });

  it('401s without a token', async () => {
    const response = await request(app).get('/api/admin/logs');

    expect(response.status).toBe(401);
    expect(response.body).toEqual({
      success: false,
      error: { code: 'unauthorized', message: 'Authentication required' },
    });
  });

  it('401s on a malformed Authorization header', async () => {
    const response = await request(app)
      .get('/api/admin/logs')
      .set('Authorization', 'Basic bm9wZQ==');

    expect(response.status).toBe(401);
  });

  it('401s on a forged token', async () => {
    const response = await request(app)
      .get('/api/admin/logs')
      .set('Authorization', 'Bearer not.a.token');

    expect(response.status).toBe(401);
  });

  it('403s for an authenticated non-admin', async () => {
    const token = signAccessToken({ sub: 'user-1', tokenVersion: 1, isGlobalAdmin: false });

    const response = await request(app)
      .get('/api/admin/logs')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('forbidden');
  });

  it('returns the ring snapshot in the envelope for a global admin', async () => {
    clearRing();
    push({ level: 30, time: 1, msg: 'hello', pid: 1, hostname: 'h' });
    push({ level: 50, time: 2, msg: 'boom', pid: 1, hostname: 'h', scope: 'test' });

    const token = signAccessToken({ sub: 'admin-1', tokenVersion: 1, isGlobalAdmin: true });
    const response = await request(app)
      .get('/api/admin/logs')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(response.body.data.lastId).toBe(2);
    expect(response.body.data.records).toHaveLength(2);
    expect(response.body.data.records[1]).toMatchObject({
      id: 2,
      level: 'error',
      msg: 'boom',
      context: { scope: 'test' },
    });
  });

  it('honours the sinceId / level / limit query, validated', async () => {
    clearRing();
    push({ level: 30, time: 1, msg: 'a' });
    push({ level: 50, time: 2, msg: 'b' });
    push({ level: 50, time: 3, msg: 'c' });

    const token = signAccessToken({ sub: 'admin-1', tokenVersion: 1, isGlobalAdmin: true });
    const response = await request(app)
      .get('/api/admin/logs?sinceId=1&level=error&limit=1')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(200);
    expect(response.body.data.records.map((r: { msg: string }) => r.msg)).toEqual(['c']);
    // lastId is the ring head, not the last MATCHING id.
    expect(response.body.data.lastId).toBe(3);
  });

  it('422s an out-of-range limit', async () => {
    const token = signAccessToken({ sub: 'admin-1', tokenVersion: 1, isGlobalAdmin: true });
    const response = await request(app)
      .get('/api/admin/logs?limit=99999')
      .set('Authorization', `Bearer ${token}`);

    expect(response.status).toBe(422);
    expect(response.body.error.code).toBe('validation_error');
    expect(response.body.error.details[0].path).toBe('limit');
  });
});
