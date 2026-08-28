/**
 * THE Express augmentation for FlowBoard. Every package that needs `req.user`
 * or a `res.locals` slot declares it here — one file, so two work packages can
 * never merge two conflicting `declare global` blocks for the same property.
 *
 * `Express.Locals` is the interface `@types/express-serve-static-core`
 * intersects into `res.locals`, so augmenting it types `res.locals` everywhere
 * without a generic parameter on every handler signature.
 */
import type { AuthenticatedUser } from './auth';
import type { ParsedRequestParts } from '../middlewares/validate';

declare global {
  namespace Express {
    interface Request {
      /**
       * Set by `requireAuth` from a verified Bearer access token. Absent on
       * public routes — guards narrow it, handlers behind a guard can rely on
       * it (`req.user` is still optional at the type level; use the
       * `AuthedRequest` helper or a local check).
       */
      user?: AuthenticatedUser;
      /** High-resolution start marker stamped by `requestLogger`. */
      startedAt?: bigint;
    }

    interface Locals {
      /**
       * The originating socket's id, read from the `X-Socket-Id` header by
       * `socketIdMiddleware`. Services stamp it onto domain events so the
       * realtime layer can `io.to(room).except(originSocketId)` — the actor's
       * own tab must not receive an echo of its optimistic update.
       */
      socketId?: string | null;
      /**
       * Zod-parsed request parts, written by `validate(schema, part)` and read
       * back with its typed `getParsed<T>(res, part)` accessor.
       */
      parsed?: ParsedRequestParts;
    }
  }
}

export {};
