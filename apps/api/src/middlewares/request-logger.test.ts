import express, { type Express } from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { RequestLogInsert } from '../types/persistence';
import {
  flushRequestLogs,
  requestLogger,
  resetRequestLogger,
  setRequestLogSink,
} from './request-logger';
import { errorHandler, notFound } from './error-handler';
import { ApiError } from '../utils/api-error';

/**
 * Let the server's `finish` event run. supertest resolves on the CLIENT's end
 * event, which can beat the server-side listener that buffers the row.
 */
function settle(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

function buildApp(): Express {
  const app = express();
  app.use(requestLogger);

  const projects = express.Router();
  projects.get('/tasks/:taskId', (_req, res) => {
    res.json({ ok: true });
  });
  // Mounted with a real id in the prefix — the cardinality trap.
  app.use('/api/projects/:projectId', projects);

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  // A guarded route that REJECTS. Its response is written by the app-level
  // error handler, long after Express has unwound `req.baseUrl` — the case that
  // used to log `/logs` instead of `/api/admin/logs`.
  const admin = express.Router();
  admin.get('/logs', (_req, _res, next) => {
    next(ApiError.unauthorized('Authentication required'));
  });
  app.use('/api/admin', admin);

  app.use(notFound);
  app.use(errorHandler);
  return app;
}

describe('requestLogger', () => {
  afterEach(async () => {
    await flushRequestLogs();
    setRequestLogSink(null);
    resetRequestLogger();
  });

  it('buffers a row per finished request and flushes it to the sink', async () => {
    const rows: RequestLogInsert[] = [];
    setRequestLogSink(async (batch) => {
      rows.push(...batch);
      await Promise.resolve();
    });

    await request(buildApp()).get('/api/health');
    await settle();
    await flushRequestLogs();

    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row?.method).toBe('GET');
    expect(row?.path).toBe('/api/health');
    expect(row?.statusCode).toBe(200);
    expect(row?.durationMs).toBeGreaterThanOrEqual(0);
    expect(row?.createdAt).toBeInstanceOf(Date);
  });

  it('stores the ROUTE PATTERN, never the raw URL', async () => {
    const rows: RequestLogInsert[] = [];
    setRequestLogSink(async (batch) => {
      rows.push(...batch);
      await Promise.resolve();
    });

    await request(buildApp()).get(
      '/api/projects/3f2504e0-4f89-41d3-9a0c-0305e82c3301/tasks/9c858901-8a57-4791-81fe-4c455b099bc9?expand=comments',
    );
    await settle();
    await flushRequestLogs();

    // The mount prefix's uuid is normalised; the route's own param keeps its
    // name; the query string is gone.
    expect(rows[0]?.path).toBe('/api/projects/:id/tasks/:taskId');
  });

  it('normalises an unmatched (404) path rather than recording the raw one', async () => {
    const rows: RequestLogInsert[] = [];
    setRequestLogSink(async (batch) => {
      rows.push(...batch);
      await Promise.resolve();
    });

    await request(buildApp()).get('/api/tasks/3f2504e0-4f89-41d3-9a0c-0305e82c3301');
    await settle();
    await flushRequestLogs();

    expect(rows[0]?.statusCode).toBe(404);
    expect(rows[0]?.path).toBe('/api/tasks/:id');
  });

  it('keeps the mount prefix on a request the error handler answers', async () => {
    const rows: RequestLogInsert[] = [];
    setRequestLogSink(async (batch) => {
      rows.push(...batch);
      await Promise.resolve();
    });

    await request(buildApp()).get('/api/admin/logs?level=info');
    await settle();
    await flushRequestLogs();

    expect(rows[0]?.statusCode).toBe(401);
    // NOT `/logs`: `req.baseUrl` has already been unwound by the time `finish`
    // fires on an error response, so the prefix comes from the original URL.
    expect(rows[0]?.path).toBe('/api/admin/logs');
  });

  it('records the status code of a failed request', async () => {
    const rows: RequestLogInsert[] = [];
    setRequestLogSink(async (batch) => {
      rows.push(...batch);
      await Promise.resolve();
    });

    await request(buildApp()).get('/nope');
    await settle();
    await flushRequestLogs();

    expect(rows[0]?.statusCode).toBe(404);
  });

  it('flushes automatically once the batch threshold is reached', async () => {
    const batches: RequestLogInsert[][] = [];
    setRequestLogSink(async (batch) => {
      batches.push(batch);
      await Promise.resolve();
    });

    const app = buildApp();
    for (let i = 0; i < 50; i += 1) {
      await request(app).get('/api/health');
    }

    await settle();
    // 50 rows is the threshold — no explicit flush needed.
    expect(batches.flat()).toHaveLength(50);
  });

  it('drops a batch the sink rejects instead of throwing or retrying', async () => {
    const sink = vi.fn(() => Promise.reject(new Error('db down')));
    setRequestLogSink(sink);

    await request(buildApp()).get('/api/health');
    await settle();
    await expect(flushRequestLogs()).resolves.toBeUndefined();

    expect(sink).toHaveBeenCalledOnce();

    // The failed batch is gone, not queued for a retry storm.
    const survivors: RequestLogInsert[] = [];
    setRequestLogSink(async (batch) => {
      survivors.push(...batch);
      await Promise.resolve();
    });
    await flushRequestLogs();
    expect(survivors).toHaveLength(0);
  });

  it('is a silent no-op with no sink wired', async () => {
    setRequestLogSink(null);
    await request(buildApp()).get('/api/health');
    await settle();
    await expect(flushRequestLogs()).resolves.toBeUndefined();
  });
});
