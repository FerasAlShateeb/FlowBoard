/**
 * `validate(schema, part)` — zod-parses one request part before the controller
 * runs. On failure the `ZodError` is forwarded to `next()`, and the single
 * `errorHandler` renders it as a 422 with per-field details.
 *
 * ── Where the parsed value goes (Express 5 note) ────────────────────────────
 *
 * Express 5 turned `req.query` into a lazily-memoised GETTER on the request
 * prototype: `req.query = parsed` throws in strict mode. Two mechanisms, both
 * applied, each with a different job:
 *
 *  1. **`res.locals.parsed[part]` + `getParsed<T>(res, part)` — the canonical,
 *     TYPED read.** This is what controllers should use. `req.query` is typed
 *     `ParsedQs` (string | string[] | …) no matter what the schema coerces it
 *     to, so reading `req.query.page` as a `number` would be a type lie even
 *     when it is a number at runtime. `getParsed` returns the schema's own
 *     output type with no cast.
 *
 *  2. **The request part is still REPLACED in place** — plain assignment for
 *     `body`/`params` (own, writable properties), and `Object.defineProperty`
 *     for `query` (shadowing the prototype getter with an own data property).
 *     This is the compatibility shim: anything reading `req.query` /`req.body`
 *     directly — a third-party middleware, a Wave-2 handler written from habit —
 *     sees the coerced, validated value rather than the raw one, so the two
 *     paths can never disagree.
 *
 * @example
 *   router.get(
 *     '/logs',
 *     validate(serverLogsQuerySchema, 'query'),
 *     asyncHandler(async (_req, res) => {
 *       const query = getParsed<ServerLogsQuery>(res, 'query');
 *       respond(res, snapshot(query));
 *     }),
 *   );
 */
import type { Request, RequestHandler, Response } from 'express';
import type { ZodType } from 'zod';
import { ApiError } from '../utils/api-error';

/** Which part of the request a schema applies to. */
export type RequestPart = 'body' | 'query' | 'params';

/** The `res.locals.parsed` bag. One slot per request part. */
export interface ParsedRequestParts {
  body?: unknown;
  query?: unknown;
  params?: unknown;
}

/** Write the parsed value back onto the request, getter-safe. */
function replaceRequestPart(req: Request, part: RequestPart, value: unknown): void {
  if (part === 'query') {
    // Express 5: `query` is a prototype getter. An own data property shadows it.
    Object.defineProperty(req, 'query', {
      value,
      writable: true,
      configurable: true,
      enumerable: true,
    });
    return;
  }
  // `body` and `params` are plain own properties on the request object.
  Object.defineProperty(req, part, {
    value,
    writable: true,
    configurable: true,
    enumerable: true,
  });
}

/**
 * Build a validating middleware for one request part.
 *
 * The generic is inferred from the schema, so `getParsed<z.infer<typeof s>>`
 * (or an explicit exported type) is the only place a type is ever written down.
 */
export function validate<TSchema extends ZodType>(
  schema: TSchema,
  part: RequestPart = 'body',
): RequestHandler {
  return (req, res, next) => {
    const result = schema.safeParse(req[part]);
    if (!result.success) {
      // The errorHandler owns the 422 envelope — this only forwards.
      next(result.error);
      return;
    }

    const parsed = result.data;
    const bag: ParsedRequestParts = res.locals.parsed ?? {};
    bag[part] = parsed;
    res.locals.parsed = bag;
    replaceRequestPart(req, part, parsed);
    next();
  };
}

/**
 * Read back a value stored by `validate`.
 *
 * @throws {ApiError} 500 when the part was never validated — that is a wiring
 * bug (a handler reading `getParsed(res, 'query')` with no `validate(…, 'query')`
 * ahead of it), and failing loudly beats silently handing back `undefined`.
 */
export function getParsed<TValue>(res: Response, part: RequestPart = 'body'): TValue {
  const bag = res.locals.parsed;
  if (!bag || !(part in bag) || bag[part] === undefined) {
    throw ApiError.internal(`Request ${part} was not validated`);
  }
  return bag[part] as TValue;
}
