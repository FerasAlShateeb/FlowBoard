/**
 * A tiny authenticated client for the FlowBoard API.
 *
 * SPECS DRIVE THE BROWSER; this drives the setup. Building a cycle-forming
 * dependency pair, minting an invite link, or reading back which status a task
 * actually landed in are all things a test needs to KNOW, not things it is
 * testing — doing them through the UI would make a board spec fail because a
 * dialog moved. Every assertion in `tests/` still happens against the rendered
 * page; this is the arranging half of arrange-act-assert.
 *
 * It is not a re-implementation of `apps/web/src/lib/api.ts`: no refresh
 * single-flight, no zod parse, no socket id. It unwraps the envelope, throws on
 * failure with the server's own error code, and stops there.
 */
import { API_ORIGIN } from './env';
import { recordApiCall } from './rate-budget';

/** The `{success,data,meta?,error?}` envelope every endpoint answers with. */
interface Envelope<T> {
  readonly success: boolean;
  readonly data?: T;
  readonly meta?: { readonly total?: number };
  readonly error?: { readonly code?: string; readonly message?: string };
}

/** A failed request, carrying the server's own code so specs can assert on it. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface UserSummary {
  readonly id: string;
  readonly name: string;
  readonly email?: string;
}

/**
 * `taskSummarySchema`'s shape, narrowed to what the specs read.
 *
 * NOTE the absence of `key`: the board and list endpoints answer with `number`
 * only, and the display key (`FLOW-12`) is composed by the caller — see
 * {@link taskKey}. The full `GET /tasks/:id` DOES carry `key`; these two are
 * different contracts and conflating them cost this suite an afternoon.
 */
export interface TaskSummary {
  readonly id: string;
  readonly number: number;
  readonly title: string;
  readonly type: string;
  readonly statusId: string;
  readonly priority: string;
  readonly assignee: UserSummary | null;
  readonly storyPoints: number | null;
  readonly startDate: string | null;
  readonly dueDate: string | null;
  readonly sprintId: string | null;
  readonly updatedAt: string;
}

/** `FLOW` + `12` → `FLOW-12`, the key the board renders and the router routes on. */
export function taskKey(projectKey: string, task: { readonly number: number }): string {
  return `${projectKey}-${String(task.number)}`;
}

/** `taskSchema` — what `GET /tasks/:id` answers with. */
export interface TaskDetail extends TaskSummary {
  readonly key: string;
  readonly projectId: string;
  readonly description: string | null;
  readonly watcherIds: string[];
}

export interface Status {
  readonly id: string;
  readonly name: string;
  readonly category: string;
  readonly position: number;
  readonly wipLimit: number | null;
}

export interface Sprint {
  readonly id: string;
  readonly name: string;
  readonly state: string;
}

export interface ProjectRef {
  readonly id: string;
  readonly key: string;
  readonly name: string;
}

export interface LoginResult {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly user: { readonly id: string; readonly name: string; readonly email: string };
}

/**
 * THE CREDENTIAL BUDGET.
 *
 * `/api/auth/*` is rate-limited to **10 requests per minute per IP** — the
 * brute-force ceiling, and a genuine product feature this suite has no business
 * weakening. Every request the whole run makes comes from 127.0.0.1, so the
 * suite shares one bucket with itself: `auth.spec` alone signs in through the
 * form three times, previews and accepts an invite, and rotates a password.
 *
 * Two things keep it under the ceiling. `session()` below caches a token pair
 * per account, so the other thirteen specs cost ONE login each for the entire
 * run rather than one per test. And this gate paces whatever is left: it tracks
 * the credential calls of the last minute and, when the budget below is already
 * spent, waits exactly long enough for the oldest to fall out of the window.
 *
 * It is not an arbitrary sleep — it is the client half of a documented server
 * limit, and it only ever runs in `auth.spec`, which is the only file that
 * deliberately hammers the endpoint.
 */
const AUTH_WINDOW_MS = 60_000;
/**
 * Well under the server's limit of 10.
 *
 * The slack is for the calls this module cannot see: the login form's own POST,
 * the invite page's preview fetch, an accept. They are booked explicitly where
 * they happen, but a React re-render that refetches one of them would not be —
 * and the cost of being wrong is a 429 in the middle of a spec, while the cost
 * of the slack is one extra pause inside `auth.spec` alone.
 */
const AUTH_BUDGET = 7;
const authCalls: number[] = [];

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Claim one slot against the credential rate limit, waiting if none is free.
 *
 * Exported because the UI-driven sign-ins in `auth.spec` spend from the same
 * bucket and must be counted too — the limiter cannot tell a `fetch` from a
 * form POST, so neither may this.
 */
export async function reserveAuthSlot(): Promise<void> {
  for (;;) {
    const now = Date.now();
    while (authCalls.length > 0 && now - (authCalls[0] ?? now) > AUTH_WINDOW_MS) {
      authCalls.shift();
    }
    const oldest = authCalls[0];
    if (authCalls.length < AUTH_BUDGET || oldest === undefined) {
      authCalls.push(now);
      return;
    }
    await sleep(AUTH_WINDOW_MS - (now - oldest) + 250);
  }
}

/**
 * Run-scoped memo for the seeded lookups. Stores the PROMISE, not the value, so
 * two specs asking at once share one request instead of racing to make two.
 */
const lookups = new Map<string, Promise<unknown>>();

function memoise<T>(key: string, load: () => Promise<T>): Promise<T> {
  const existing = lookups.get(key);
  if (existing) return existing as Promise<T>;
  const pending = load().catch((error: unknown) => {
    // A failed lookup must not be remembered as the answer forever.
    lookups.delete(key);
    throw error;
  });
  lookups.set(key, pending);
  return pending;
}

/** Token pairs already minted this run, so one account costs one login. */
const sessions = new Map<string, { session: LoginResult; at: number }>();
/** Access tokens live 15 minutes; re-mint well before that. */
const SESSION_TTL_MS = 8 * 60_000;

export class ApiClient {
  private constructor(
    readonly accessToken: string,
    readonly refreshToken: string,
    readonly user: LoginResult['user'],
  ) {}

  /** A client for an account, reusing this run's cached token pair. */
  static async signIn(email: string, password: string): Promise<ApiClient> {
    return ApiClient.fromSession(await ApiClient.session(email, password));
  }

  /** A client over a token pair the caller already holds. Costs nothing. */
  static fromSession(session: LoginResult): ApiClient {
    return new ApiClient(session.accessToken, session.refreshToken, session.user);
  }

  /** This run's token pair for an account, minting one only if there is none. */
  static async session(email: string, password: string): Promise<LoginResult> {
    const key = `${email}::${password}`;
    const cached = sessions.get(key);
    if (cached && Date.now() - cached.at < SESSION_TTL_MS) return cached.session;
    const session = await ApiClient.login(email, password);
    sessions.set(key, { session, at: Date.now() });
    return session;
  }

  /**
   * A REAL login request, uncached — for the specs that are testing the
   * credential path itself. Everything else wants `session()`.
   */
  static async login(email: string, password: string): Promise<LoginResult> {
    const attempt = async (): Promise<LoginResult> => {
      await reserveAuthSlot();
      recordApiCall();
      return unwrap<LoginResult>(
        await fetch(`${API_ORIGIN}/api/auth/login`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ email, password }),
        }),
      );
    };
    try {
      return await attempt();
    } catch (error) {
      // The budget above paces the calls this module makes; it cannot see the
      // ones the BROWSER makes to the same endpoint (a login form post, an
      // invite accept). When the two together outrun the limiter, the server
      // has already told us precisely what to do — wait out the window. Once.
      if (!(error instanceof ApiError) || error.status !== 429) throw error;
      await sleep(AUTH_WINDOW_MS + 500);
      authCalls.length = 0;
      return attempt();
    }
  }

  /**
   * One request, with the general rate limiter respected rather than fought.
   *
   * `/api` carries a 300-request-per-minute limiter keyed by USER — and the
   * browser's requests land in the same bucket as this client's, because they
   * are the same signed-in person. A spec that drives three page loads and then
   * polls an endpoint can therefore run into a ceiling that has nothing to do
   * with the feature under test, and the failure surfaces in whichever spec was
   * unlucky. (It first showed up as `table.spec` and `roadmap.spec` failing on
   * their opening `GET /orgs`, having done nothing wrong at all.)
   *
   * Two things keep it honest. The memoised lookups below remove most of the
   * volume, and this retry waits out the window the server itself named instead
   * of guessing — a 429 is the API answering correctly, so the right response is
   * to obey it, not to weaken the limiter for tests.
   */
  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      // Booked against the same window the browser's requests are booked
      // against — the limiter cannot tell the two apart, so neither may we.
      recordApiCall();
      const response = await fetch(`${API_ORIGIN}/api${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.accessToken}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      if (response.status !== 429 || attempt >= 1) return unwrap<T>(response);
      await sleep(retryAfterMs(response));
    }
  }

  get<T>(path: string): Promise<T> {
    return this.request<T>('GET', path);
  }
  post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', path, body ?? {});
  }
  patch<T>(path: string, body: unknown): Promise<T> {
    return this.request<T>('PATCH', path, body);
  }
  put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', path, body ?? {});
  }
  /**
   * `body` is optional because most deletes need none — but not all. Deleting a
   * workflow status takes `{ moveTasksTo }`, a decision about where the
   * column's cards go rather than a filter on what is removed, so it belongs in
   * the body and not the query string (`workflow.schema.ts` says why). Omitted
   * means "no body at all", not "an empty one".
   */
  delete<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('DELETE', path, body);
  }

  /** Like `post`, but returns the failure instead of throwing it. */
  async expectFailure(method: string, path: string, body?: unknown): Promise<ApiError> {
    try {
      await this.request<unknown>(method, path, body);
    } catch (error) {
      if (error instanceof ApiError) return error;
      throw error;
    }
    throw new Error(`${method} ${path} unexpectedly succeeded`);
  }

  // ── Convenience lookups the specs share ───────────────────────────────────
  //
  // MEMOISED FOR THE WHOLE RUN, and only these three. The org, its projects and
  // a project's workflow columns are seeded rows that no spec mutates, and every
  // one of the spec files opens by asking for them — that was ~80 requests
  // spent re-reading constants, against a 300-per-minute ceiling shared with the
  // browser. Anything a spec CAN change (tasks, sprints, notifications) is read
  // fresh every time, because a stale answer there would be a wrong assertion
  // rather than a slow one.

  /** The demo org's id. */
  async orgId(): Promise<string> {
    return memoise(`${this.user.id}::orgId`, async () => {
      const orgs = await this.get<{ id: string; slug: string }[]>('/orgs');
      const org = orgs.find((candidate) => candidate.slug === 'acme') ?? orgs[0];
      if (!org) throw new Error('no organizations visible to this account');
      return org.id;
    });
  }

  /** A seeded project by key (`FLOW` / `CORE`). */
  async project(key: string): Promise<ProjectRef> {
    return memoise(`${this.user.id}::project::${key}`, async () => {
      const orgId = await this.orgId();
      const projects = await this.get<ProjectRef[]>(`/orgs/${orgId}/projects`);
      const project = projects.find((candidate) => candidate.key === key);
      if (!project) throw new Error(`no project ${key} in the seeded org`);
      return project;
    });
  }

  /** A project's workflow columns, in board order. */
  async statuses(projectId: string): Promise<Status[]> {
    return memoise(`${this.user.id}::statuses::${projectId}`, async () => {
      const rows = await this.get<Status[]>(`/projects/${projectId}/statuses`);
      return [...rows].sort((a, b) => a.position - b.position);
    });
  }

  async status(projectId: string, name: string): Promise<Status> {
    const found = (await this.statuses(projectId)).find((row) => row.name === name);
    if (!found) throw new Error(`no status "${name}" in project ${projectId}`);
    return found;
  }

  async sprints(projectId: string): Promise<Sprint[]> {
    return this.get<Sprint[]>(`/projects/${projectId}/sprints`);
  }

  /** Every column of the board, keyed by status id. */
  async board(projectId: string): Promise<Record<string, TaskSummary[]>> {
    const response = await this.get<{ columns: Record<string, TaskSummary[]> }>(
      `/projects/${projectId}/tasks?view=board`,
    );
    return response.columns;
  }

  /** The tasks currently in one column, in board order. */
  async column(projectId: string, statusId: string): Promise<TaskSummary[]> {
    return (await this.board(projectId))[statusId] ?? [];
  }

  /** The FULL task (this one does carry `key`), looked up the way a deep link does. */
  async taskByKey(projectId: string, key: string): Promise<TaskDetail> {
    return this.get<TaskDetail>(`/projects/${projectId}/tasks/by-key/${key}`);
  }

  /** The full task by id. */
  async task(taskId: string): Promise<TaskDetail> {
    return this.get<TaskDetail>(`/tasks/${taskId}`);
  }
}

/**
 * How long the server says to wait, in milliseconds.
 *
 * `express-rate-limit` is configured with `standardHeaders: 'draft-7'`, which
 * answers a 429 with `Retry-After` in seconds and a combined
 * `RateLimit: limit=…, remaining=…, reset=…` header. Either one is the truth;
 * the fallback only matters if both are ever dropped, and the cap keeps a
 * mis-parse from turning into a hung suite.
 */
function retryAfterMs(response: Response): number {
  const retryAfter = Number(response.headers.get('retry-after'));
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000 + 500, 65_000);
  }
  const reset = /reset=(\d+)/u.exec(response.headers.get('ratelimit') ?? '')?.[1];
  if (reset !== undefined) return Math.min(Number(reset) * 1000 + 500, 65_000);
  return 5_000;
}

async function unwrap<T>(response: Response): Promise<T> {
  const text = await response.text();
  // A `204 No Content` (every DELETE in this API) has no envelope to unwrap.
  // Returning `undefined` typed as `T` is honest here: the caller asked for
  // nothing and there is nothing, and forcing them to spell that out would put
  // `void` generics on every delete in the suite.
  if (text === '' && response.ok) return undefined as T;
  let payload: Envelope<T>;
  try {
    payload = JSON.parse(text) as Envelope<T>;
  } catch {
    throw new ApiError(response.status, 'non_json_response', text.slice(0, 300));
  }
  if (!response.ok || payload.success !== true) {
    throw new ApiError(
      response.status,
      payload.error?.code ?? 'unknown',
      payload.error?.message ?? `HTTP ${String(response.status)}`,
    );
  }
  if (payload.data === undefined) {
    throw new ApiError(response.status, 'empty_envelope', 'the response carried no data');
  }
  return payload.data;
}
