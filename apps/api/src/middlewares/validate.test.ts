import express, { type Express, type Request, type Response } from 'express';
import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { errorHandler } from './error-handler';
import { getParsed, validate } from './validate';

const querySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  level: z.enum(['info', 'error']).optional(),
});
type Query = z.infer<typeof querySchema>;

const bodySchema = z.object({ title: z.string().min(1), points: z.coerce.number().optional() });
type Body = z.infer<typeof bodySchema>;

const paramsSchema = z.object({ taskId: z.uuid() });
type Params = z.infer<typeof paramsSchema>;

function buildApp(): Express {
  const app = express();
  app.use(express.json());

  app.get('/query', validate(querySchema, 'query'), (req: Request, res: Response) => {
    res.json({ parsed: getParsed<Query>(res, 'query'), fromReq: req.query });
  });

  app.post('/body', validate(bodySchema, 'body'), (req: Request, res: Response) => {
    res.json({ parsed: getParsed<Body>(res, 'body'), fromReq: req.body });
  });

  app.get('/tasks/:taskId', validate(paramsSchema, 'params'), (req: Request, res: Response) => {
    res.json({ parsed: getParsed<Params>(res, 'params'), fromReq: req.params });
  });

  app.get('/unvalidated', (_req: Request, res: Response) => {
    res.json(getParsed(res, 'query'));
  });

  app.use(errorHandler);
  return app;
}

describe('validate', () => {
  const app = buildApp();

  describe('query (the Express 5 getter case)', () => {
    it('exposes the COERCED value through getParsed', async () => {
      const response = await request(app).get('/query?page=3&level=error');

      expect(response.status).toBe(200);
      expect(response.body.parsed).toEqual({ page: 3, level: 'error' });
      // A number, not the string the URL carried.
      expect(typeof response.body.parsed.page).toBe('number');
    });

    it('also replaces req.query, so a direct read cannot disagree', async () => {
      const response = await request(app).get('/query?page=3');
      expect(response.body.fromReq).toEqual({ page: 3 });
    });

    it('applies schema defaults', async () => {
      const response = await request(app).get('/query');
      expect(response.body.parsed).toEqual({ page: 1 });
    });

    it('rejects an invalid value with a 422 envelope', async () => {
      const response = await request(app).get('/query?page=0');

      expect(response.status).toBe(422);
      expect(response.body.error.code).toBe('validation_error');
      expect(response.body.error.details[0].path).toBe('page');
    });

    it('rejects a value outside a closed enum', async () => {
      const response = await request(app).get('/query?level=trace');
      expect(response.status).toBe(422);
      expect(response.body.error.details[0].path).toBe('level');
    });
  });

  describe('body', () => {
    it('replaces req.body with the parsed value', async () => {
      const response = await request(app).post('/body').send({ title: 'Ship it', points: '5' });

      expect(response.status).toBe(200);
      expect(response.body.parsed).toEqual({ title: 'Ship it', points: 5 });
      expect(response.body.fromReq).toEqual({ title: 'Ship it', points: 5 });
    });

    it('strips unknown keys (zod objects are not passthrough)', async () => {
      const response = await request(app)
        .post('/body')
        .send({ title: 'Ship it', isGlobalAdmin: true });

      expect(response.body.parsed).toEqual({ title: 'Ship it' });
    });

    it('422s a missing required field', async () => {
      const response = await request(app).post('/body').send({});
      expect(response.status).toBe(422);
      expect(response.body.error.details[0].path).toBe('title');
    });
  });

  describe('params', () => {
    it('parses and replaces route params', async () => {
      const id = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
      const response = await request(app).get(`/tasks/${id}`);

      expect(response.status).toBe(200);
      expect(response.body.parsed).toEqual({ taskId: id });
      expect(response.body.fromReq).toEqual({ taskId: id });
    });

    it('422s a malformed id', async () => {
      const response = await request(app).get('/tasks/not-a-uuid');
      expect(response.status).toBe(422);
      expect(response.body.error.details[0].path).toBe('taskId');
    });
  });

  describe('getParsed', () => {
    it('500s when the part was never validated — a wiring bug, loudly', async () => {
      const response = await request(app).get('/unvalidated');

      expect(response.status).toBe(500);
      expect(response.body.error.code).toBe('internal_error');
    });
  });
});
