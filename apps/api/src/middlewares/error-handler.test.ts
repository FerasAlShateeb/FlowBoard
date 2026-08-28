import express, { type Express, type ErrorRequestHandler } from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError } from '../utils/api-error';
import { errorHandler, notFound } from './error-handler';

/** A minimal app whose only job is to throw the thing under test. */
function throwingApp(thrown: unknown): Express {
  const app = express();
  app.get('/boom', () => {
    throw thrown;
  });
  app.get('/boom-async', () => Promise.reject(thrown));
  app.use(notFound);
  app.use(errorHandler);
  return app;
}

describe('errorHandler', () => {
  it('renders an ApiError with its own status, code and message', async () => {
    const app = throwingApp(ApiError.notFound('Task not found'));

    const response = await request(app).get('/boom');

    expect(response.status).toBe(404);
    expect(response.body).toEqual({
      success: false,
      error: { code: 'not_found', message: 'Task not found' },
    });
  });

  it('includes 4xx details', async () => {
    const app = throwingApp(ApiError.conflict('Key taken', { field: 'key' }));

    const response = await request(app).get('/boom');

    expect(response.status).toBe(409);
    expect(response.body.error.details).toEqual({ field: 'key' });
  });

  it.each([
    ['badRequest', ApiError.badRequest(), 400, 'bad_request'],
    ['unauthorized', ApiError.unauthorized(), 401, 'unauthorized'],
    ['forbidden', ApiError.forbidden(), 403, 'forbidden'],
    ['conflict', ApiError.conflict(), 409, 'conflict'],
    ['validation', ApiError.validation(), 422, 'validation_error'],
    ['tooManyRequests', ApiError.tooManyRequests(), 429, 'rate_limited'],
  ])('maps ApiError.%s', async (_name, error, status, code) => {
    const response = await request(throwingApp(error)).get('/boom');
    expect(response.status).toBe(status);
    expect(response.body.error.code).toBe(code);
  });

  it('renders a ZodError as a 422 with per-field details', async () => {
    const schema = z.object({ title: z.string().min(1), points: z.number() });
    const parsed = schema.safeParse({ title: '', points: 'three' });
    expect(parsed.success).toBe(false);

    const response = await request(throwingApp(parsed.error)).get('/boom');

    expect(response.status).toBe(422);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('validation_error');
    expect(response.body.error.details).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: 'title' }),
        expect.objectContaining({ path: 'points' }),
      ]),
    );
    for (const detail of response.body.error.details) {
      expect(detail).toHaveProperty('code');
      expect(detail).toHaveProperty('message');
    }
  });

  it('renders an unknown throw as a 500 internal_error with no leaked message', async () => {
    const app = throwingApp(new Error('SELECT * FROM users -- secret'));

    const response = await request(app).get('/boom');

    expect(response.status).toBe(500);
    expect(response.body).toEqual({
      success: false,
      error: { code: 'internal_error', message: 'Internal server error' },
    });
    expect(JSON.stringify(response.body)).not.toContain('secret');
  });

  it('catches a rejected async handler (Express 5 forwards it)', async () => {
    const response = await request(throwingApp(ApiError.forbidden())).get('/boom-async');
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('forbidden');
  });

  it('renders a non-Error throw as a 500', async () => {
    const response = await request(throwingApp('a bare string')).get('/boom');
    expect(response.status).toBe(500);
    expect(response.body.error.code).toBe('internal_error');
  });
});

describe('5xx details are environment-gated', () => {
  /**
   * `isProduction` is a module-level constant derived from `NODE_ENV` at import
   * time, so the only honest way to exercise both sides of the gate is to stub
   * the variable and re-import the module graph. Mocking `../config/env`
   * instead would also stub it for `utils/logger`, which imports the same
   * module — the test would then be shaped by the mock rather than by the rule.
   *
   * `ApiError` comes back from the SAME re-import: `resetModules` mints a fresh
   * class object, and an error built from the file-level import would fail the
   * handler's `instanceof` and render as a bare 500. (That is not a bug in the
   * handler — nothing in the app ever holds two copies of the module.)
   */
  async function loadWith(nodeEnv: string): Promise<{
    errorHandler: ErrorRequestHandler;
    ApiError: typeof ApiError;
  }> {
    vi.stubEnv('NODE_ENV', nodeEnv);
    vi.resetModules();
    const [handlerModule, errorModule] = await Promise.all([
      import('./error-handler'),
      import('../utils/api-error'),
    ]);
    return { errorHandler: handlerModule.errorHandler, ApiError: errorModule.ApiError };
  }

  function appWith(handler: ErrorRequestHandler, thrown: unknown): Express {
    const app = express();
    app.get('/boom', () => {
      throw thrown;
    });
    app.use(handler);
    return app;
  }

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('WITHHOLDS 5xx details in production — a driver message is a disclosure', async () => {
    const loaded = await loadWith('production');
    const boom = new loaded.ApiError(503, 'service_unavailable', 'Upstream is down', {
      dsn: 'postgres://postgres:hunter2@db:5432/flowboard',
    });

    const response = await request(appWith(loaded.errorHandler, boom)).get('/boom');

    expect(response.status).toBe(503);
    expect(response.body.error.code).toBe('service_unavailable');
    expect(response.body.error).not.toHaveProperty('details');
    expect(JSON.stringify(response.body)).not.toContain('hunter2');
  });

  it('RETURNS the same 5xx details outside production, where they are a diagnostic', async () => {
    const loaded = await loadWith('development');
    const boom = new loaded.ApiError(500, 'internal_error', 'Boom', {
      hint: 'check the migration',
    });

    const response = await request(appWith(loaded.errorHandler, boom)).get('/boom');

    expect(response.status).toBe(500);
    expect(response.body.error.details).toEqual({ hint: 'check the migration' });
  });

  it('still returns 4xx details in production — those are ours to hand back', async () => {
    const loaded = await loadWith('production');
    const boom = loaded.ApiError.conflict('Key taken', { field: 'key' });

    const response = await request(appWith(loaded.errorHandler, boom)).get('/boom');

    expect(response.status).toBe(409);
    expect(response.body.error.details).toEqual({ field: 'key' });
  });

  it('omits `details` entirely when the error carries none', async () => {
    const loaded = await loadWith('development');

    const response = await request(appWith(loaded.errorHandler, loaded.ApiError.notFound())).get(
      '/boom',
    );

    expect(response.body.error).not.toHaveProperty('details');
  });
});

describe('a response that already started', () => {
  it('is forwarded to Express instead of being re-rendered as an envelope', async () => {
    // A stream that has flushed its headers cannot be turned back into JSON,
    // so the handler must forward rather than write over it — the body the
    // client already received stays intact.
    const app = express();
    let forwarded: unknown = null;
    app.get('/stream', (_req, res) => {
      res.status(200).write('partial');
      throw ApiError.internal('too late');
    });
    app.use(errorHandler);
    // Mounted AFTER errorHandler: reaching it proves `next(err)` was called
    // rather than an envelope being written over a started response.
    app.use(((err, _req, res, _next) => {
      forwarded = err;
      res.end();
    }) as ErrorRequestHandler);

    const response = await request(app).get('/stream');

    expect(response.status).toBe(200);
    expect(response.text).toBe('partial');
    expect(forwarded).toBeInstanceOf(ApiError);
  });
});

describe('notFound', () => {
  it('produces a 404 envelope for an unmatched route', async () => {
    const response = await request(throwingApp(ApiError.internal())).get('/nothing-here');

    expect(response.status).toBe(404);
    expect(response.body.success).toBe(false);
    expect(response.body.error.code).toBe('not_found');
    expect(response.body.error.message).toContain('GET');
  });

  it('never returns a `data` key on the error half of the envelope', async () => {
    const response = await request(throwingApp(ApiError.internal())).get('/nothing-here');
    expect(response.body).not.toHaveProperty('data');
  });
});
