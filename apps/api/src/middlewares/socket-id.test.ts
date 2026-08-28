import express, { type Express } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { getSocketId, socketIdMiddleware } from './socket-id';

function buildApp(): Express {
  const app = express();
  app.use(socketIdMiddleware);
  app.get('/echo', (_req, res) => {
    res.json({ socketId: getSocketId(res) });
  });
  return app;
}

/** An app that never mounted the middleware — the getter must still behave. */
function bareApp(): Express {
  const app = express();
  app.get('/echo', (_req, res) => {
    res.json({ socketId: getSocketId(res) });
  });
  return app;
}

describe('socketIdMiddleware', () => {
  it('reads X-Socket-Id into res.locals', async () => {
    const response = await request(buildApp()).get('/echo').set('X-Socket-Id', 'abc123');
    expect(response.body).toEqual({ socketId: 'abc123' });
  });

  it('is case-insensitive about the header name', async () => {
    const response = await request(buildApp()).get('/echo').set('x-socket-id', 'abc123');
    expect(response.body.socketId).toBe('abc123');
  });

  it('is null when the header is absent', async () => {
    const response = await request(buildApp()).get('/echo');
    expect(response.body.socketId).toBeNull();
  });

  it('is null for an empty header', async () => {
    const response = await request(buildApp()).get('/echo').set('X-Socket-Id', '');
    expect(response.body.socketId).toBeNull();
  });

  it('rejects an over-long header rather than letting it reach a room name', async () => {
    const response = await request(buildApp()).get('/echo').set('X-Socket-Id', 'x'.repeat(65));
    expect(response.body.socketId).toBeNull();
  });

  it('accepts exactly the maximum length', async () => {
    const id = 'x'.repeat(64);
    const response = await request(buildApp()).get('/echo').set('X-Socket-Id', id);
    expect(response.body.socketId).toBe(id);
  });

  it('getSocketId returns null when the middleware never ran', async () => {
    const response = await request(bareApp()).get('/echo').set('X-Socket-Id', 'abc123');
    expect(response.body.socketId).toBeNull();
  });
});
