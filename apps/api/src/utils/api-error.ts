/**
 * Typed application error.
 *
 * `middlewares/error-handler.ts` is the ONLY place that turns one of these into
 * an error envelope; everywhere else just `throw ApiError.notFound(...)`. That
 * split is why services never need to know they are running inside HTTP.
 *
 * `code` is stable API surface (the web client branches on it); `message` is
 * not (it is English, for logs and last-resort toasts).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    // Restore the prototype chain: extending a built-in through TS's ES2022
    // downlevel would otherwise break `instanceof ApiError` in the handler.
    Object.setPrototypeOf(this, ApiError.prototype);
  }

  static badRequest(message = 'Bad request', details?: unknown): ApiError {
    return new ApiError(400, 'bad_request', message, details);
  }

  static unauthorized(message = 'Authentication required', details?: unknown): ApiError {
    return new ApiError(401, 'unauthorized', message, details);
  }

  /**
   * A failed sign-in — a 401 with its OWN code, distinct from `unauthorized`.
   *
   * Both are 401s, and a client that could not tell them apart would have to
   * guess: `unauthorized` means "this request had no usable session" (the
   * guards), while this means "the credentials you just typed are not a pair".
   * The login form says something specific and useful for the second and
   * nothing at all for the first, and `lib/api.ts` must not spend a refresh
   * token retrying either.
   *
   * The MESSAGE still refuses to say which half was wrong — distinguishing "no
   * such account" from "wrong password" turns the form into an account
   * directory.
   */
  static invalidCredentials(message = 'Invalid email or password'): ApiError {
    return new ApiError(401, 'invalid_credentials', message);
  }

  static forbidden(
    message = 'You do not have access to this resource',
    details?: unknown,
  ): ApiError {
    return new ApiError(403, 'forbidden', message, details);
  }

  static notFound(message = 'Resource not found', details?: unknown): ApiError {
    return new ApiError(404, 'not_found', message, details);
  }

  static conflict(message = 'Conflict', details?: unknown): ApiError {
    return new ApiError(409, 'conflict', message, details);
  }

  static validation(message = 'Validation failed', details?: unknown): ApiError {
    return new ApiError(422, 'validation_error', message, details);
  }

  static tooManyRequests(message = 'Too many requests', details?: unknown): ApiError {
    return new ApiError(429, 'rate_limited', message, details);
  }

  static internal(message = 'Internal server error', details?: unknown): ApiError {
    return new ApiError(500, 'internal_error', message, details);
  }

  static serviceUnavailable(message = 'Service unavailable', details?: unknown): ApiError {
    return new ApiError(503, 'service_unavailable', message, details);
  }
}
