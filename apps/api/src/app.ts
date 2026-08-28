/**
 * Express application assembly. The middleware order is normative:
 *
 *   requestLogger → cors → json → urlencoded → socketId → rateLimit
 *     → /api router → notFound → errorHandler
 *
 * Two positions in that list are load-bearing:
 *
 *  - `requestLogger` is FIRST so its `res.on('finish')` timer measures the whole
 *    request, including body parsing and a rate-limit rejection. A logger that
 *    only sees the requests that got through is not an observability tool.
 *  - `errorHandler` is LAST and alone: it is the only error-envelope formatter
 *    in the codebase (`middlewares/error-handler.ts`), and `notFound` in front
 *    of it is what makes an unmatched URL produce an envelope rather than
 *    Express' HTML default.
 *
 * `createApp()` binds no port, so supertest can drive it directly; `server.ts`
 * owns the `listen`.
 */
import cors from 'cors';
import express, { type Express } from 'express';
import { env } from './config/env';
import { errorHandler, notFound } from './middlewares/error-handler';
import { defaultRateLimit } from './middlewares/rate-limit';
import { requestLogger } from './middlewares/request-logger';
import { socketIdMiddleware } from './middlewares/socket-id';
import { apiRouter } from './routes';

export function createApp(): Express {
  const app = express();

  // Trust the first proxy hop (nginx / the Vite dev proxy) so `req.ip` is the
  // real client — the rate limiter keys on it. `1`, never `true`: trusting
  // every hop lets a client forge `X-Forwarded-For` and mint a fresh limiter
  // bucket per request.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  // 1. Observability — buffers one row per finished request.
  app.use(requestLogger);

  // 2. CORS (credentialed) + body parsing. The deployed web app is served from
  //    a different origin than the API, so this is not dev-only convenience.
  app.use(cors({ origin: env.WEB_ORIGIN, credentials: true }));
  app.use(express.json({ limit: '2mb' }));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));

  // 3. Echo suppression: capture the caller's socket id for domain events.
  app.use(socketIdMiddleware);

  // 4. Generous global rate limit, then every API router.
  app.use('/api', defaultRateLimit, apiRouter);

  // 5. Fallthrough 404 + the single error-envelope formatter (must be last).
  app.use(notFound);
  app.use(errorHandler);

  return app;
}
