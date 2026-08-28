/**
 * Structured application logger (pino) — a single process-wide singleton.
 * Import this instead of using `console` (lint enforces it): a `console.log`
 * is a line the diagnostics drawer will never show.
 *
 * Output is line-delimited JSON on stdout (safe for vitest and for prod log
 * shippers) plus a second multistream sink into the in-memory ring buffer that
 * admins tail through `GET /api/admin/logs`.
 *
 * The ring sink is pinned to `trace` so it never filters BELOW the logger's own
 * level — the logger's `level` is the only gate, and whatever passes it lands
 * in the drawer.
 */
import pino from 'pino';
import { env } from '../config/env';
import { ringStream } from './log-ring';

/** Process-wide structured logger. */
export const logger = pino(
  { level: env.LOG_LEVEL },
  pino.multistream([{ stream: process.stdout }, { stream: ringStream, level: 'trace' }]),
);

/** A child logger (`logger.child({ scope })`) — for typing service fields. */
export type ChildLogger = ReturnType<typeof logger.child>;
