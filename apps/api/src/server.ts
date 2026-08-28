/**
 * Process entry point. Kept separate from `app.ts` so tests can build the app
 * without binding a port.
 *
 * Owns the three things a running process has and an app object does not: the
 * HTTP server, the Socket.IO server attached to it, and graceful shutdown.
 */
import { createServer } from 'node:http';
import { createApp } from './app';
import { bootstrap } from './bootstrap';
import { env } from './config/env';
import { closeDb } from './db';
import { flushRequestLogs } from './middlewares/request-logger';
import { closeSocketServer, initSocketServer } from './sockets/io';
import { logger } from './utils/logger';

/** How long shutdown waits for in-flight requests before forcing an exit. */
const SHUTDOWN_TIMEOUT_MS = 10_000;

// BEFORE the app is built and before anything listens: the telemetry sink, the
// request-log sink, the socket user resolver and the health probe all point at
// Drizzle from the first request onward. See `bootstrap.ts`.
bootstrap();

const app = createApp();
const httpServer = createServer(app);

initSocketServer(httpServer);

httpServer.listen(env.PORT, () => {
  logger.info(
    { port: env.PORT, env: env.NODE_ENV, webOrigin: env.WEB_ORIGIN },
    `flowboard-api listening on http://localhost:${env.PORT}`,
  );
});

let shuttingDown = false;

/**
 * SIGTERM/SIGINT handler.
 *
 * Order matters: flush the buffered request logs FIRST (they are the only
 * in-memory state whose loss is silent), then close sockets so clients get a
 * clean disconnect and reconnect elsewhere, then stop accepting HTTP — and only
 * once nothing can issue another query, drain the connection pool.
 */
async function shutdown(signal: NodeJS.Signals): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'Shutting down');

  const force = setTimeout(() => {
    logger.error('Shutdown timed out — forcing exit');
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
  force.unref();

  try {
    await flushRequestLogs();
    // Socket.IO's close() also closes the HTTP server it is attached to, so the
    // explicit close below is a no-op safety net rather than a second stop.
    await closeSocketServer();
    await new Promise<void>((resolve) => {
      httpServer.close(() => {
        resolve();
      });
    });
    await closeDb();
    logger.info('Shutdown complete');
    process.exit(0);
  } catch (error) {
    logger.error({ err: error }, 'Shutdown failed');
    process.exit(1);
  }
}

for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, () => {
    void shutdown(signal);
  });
}
