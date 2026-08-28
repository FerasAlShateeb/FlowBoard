import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type {
  Activity,
  Attachment,
  Comment,
  Label as TaskLabel,
  Sprint,
  Status,
  Task,
  TaskSummary,
  Transition,
} from '@flowboard/shared';

import { TooltipProvider } from '@/components/ui/tooltip';
// Side-effect import: brings the default i18next instance up with the ENGLISH
// catalog, which is what `useTranslation` resolves against. Without it every
// `t()` in a rendered tree returns its own key.
import '@/i18n';

/**
 * The jsdom harness for the task-sheet component suites.
 *
 * ── Why the stubs below exist ───────────────────────────────────────────────
 *
 * jsdom implements the DOM, not the browser. Three APIs Radix depends on are
 * simply absent, and each produces a failure that looks nothing like its cause:
 *
 *   `ResizeObserver`   — every Radix component that measures itself (Select's
 *                        viewport, Tooltip's collision detection, the Tabs
 *                        indicator) constructs one at mount. Missing, the whole
 *                        subtree throws `ResizeObserver is not defined`.
 *   Pointer capture    — Radix's Select and DropdownMenu call
 *                        `hasPointerCapture`/`setPointerCapture` on pointerdown.
 *                        Missing, a click on a trigger throws instead of opening.
 *   `scrollIntoView`   — `ui/command`'s arrow-key navigation scrolls the active
 *                        option into view on every move.
 *
 * They are installed once, at import, rather than per suite: a stub that a file
 * forgets to install fails somewhere far from the omission.
 *
 * ── Cleanup is EXPLICIT ─────────────────────────────────────────────────────
 *
 * `vitest.config.ts` does not enable `globals`, so Testing Library's automatic
 * `afterEach(cleanup)` — which it registers only when it can see a global
 * `afterEach` — never runs. Every suite therefore calls `afterEach(cleanup)`
 * itself; without it, one test's rendered tree is still in the document while
 * the next queries it, and `getByRole` starts finding two of everything.
 */

// ───────────────────────────────────────────────────────────────────────────
// Environment stubs
// ───────────────────────────────────────────────────────────────────────────

class ResizeObserverStub implements ResizeObserver {
  observe(): void {
    /* measurements are not asserted on; the constructor merely has to exist */
  }
  unobserve(): void {
    /* no-op */
  }
  disconnect(): void {
    /* no-op */
  }
}

interface StubbableGlobals {
  ResizeObserver?: typeof ResizeObserver;
  matchMedia?: typeof window.matchMedia;
}

/** Installs everything jsdom lacks. Idempotent — safe on repeated import. */
export function installJsdomStubs(): void {
  const globals = globalThis as typeof globalThis & StubbableGlobals;

  globals.ResizeObserver ??= ResizeObserverStub;

  globals.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => undefined,
    removeListener: () => undefined,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;

  Element.prototype.scrollIntoView ??= function scrollIntoView(): void {
    /* no-op */
  };
  Element.prototype.hasPointerCapture ??= function hasPointerCapture(): boolean {
    return false;
  };
  Element.prototype.setPointerCapture ??= function setPointerCapture(): void {
    /* no-op */
  };
  Element.prototype.releasePointerCapture ??= function releasePointerCapture(): void {
    /* no-op */
  };
}

installJsdomStubs();

// ───────────────────────────────────────────────────────────────────────────
// Render
// ───────────────────────────────────────────────────────────────────────────

/**
 * A query client with retries OFF.
 *
 * The default three retries with backoff means a test asserting an error state
 * waits several seconds for a failure the stub produced instantly.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

export interface RenderOptions {
  queryClient?: QueryClient;
}

/**
 * What `renderWithProviders` answers.
 *
 * DECLARED EXPLICITLY, and deliberately narrower than Testing Library's own
 * `RenderResult`. Two copies of `pretty-format` exist in this pnpm tree, so
 * `debug`'s options type differs between the one `render` DECLARES and the one
 * the call site RECEIVES; spreading the result therefore either fails to
 * type-check against `RenderResult` or produces an inferred type that is not
 * nameable at all (`TS2742`). Listing the members the suites actually use
 * sidesteps both, and `screen` covers everything else.
 */
export interface ProviderRenderResult {
  queryClient: QueryClient;
  container: HTMLElement;
  baseElement: HTMLElement;
  unmount: () => void;
  rerender: (ui: ReactElement) => void;
}

/** Renders inside the two providers every task-sheet component assumes. */
export function renderWithProviders(
  ui: ReactElement,
  options: RenderOptions = {},
): ProviderRenderResult {
  const queryClient = options.queryClient ?? createTestQueryClient();

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        {/* Mounted once in `AppProviders` in the real app; a Radix Tooltip
            outside a provider throws rather than degrading. */}
        <TooltipProvider>{children}</TooltipProvider>
      </QueryClientProvider>
    );
  }

  const result = render(ui, { wrapper: Wrapper });

  return {
    queryClient,
    container: result.container,
    baseElement: result.baseElement,
    unmount: result.unmount,
    rerender: result.rerender,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Fixtures
// ───────────────────────────────────────────────────────────────────────────

/** Stable uuids, so an assertion can name one without a lookup. */
export const IDS = {
  org: '11111111-1111-4111-8111-111111111111',
  project: '22222222-2222-4222-8222-222222222222',
  task: '33333333-3333-4333-8333-333333333333',
  subtask: '44444444-4444-4444-8444-444444444444',
  epic: '55555555-5555-4555-8555-555555555555',
  blocker: '66666666-6666-4666-8666-666666666666',
  ada: '77777777-7777-4777-8777-777777777777',
  grace: '88888888-8888-4888-8888-888888888888',
  todo: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  doing: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  done: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  sprint: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  label: 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
  comment: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  attachment: '99999999-9999-4999-8999-999999999999',
} as const;

export const ADA = { id: IDS.ada, name: 'Ada Lovelace', avatarUrl: null };
export const GRACE = { id: IDS.grace, name: 'Grace Hopper', avatarUrl: null };

export const STATUSES: Status[] = [
  {
    id: IDS.todo,
    projectId: IDS.project,
    name: 'To Do',
    category: 'todo',
    color: '#64748b',
    position: 0,
    wipLimit: null,
  },
  {
    id: IDS.doing,
    projectId: IDS.project,
    name: 'In Progress',
    category: 'in_progress',
    color: '#3b82f6',
    position: 1,
    wipLimit: null,
  },
  {
    id: IDS.done,
    projectId: IDS.project,
    name: 'Done',
    category: 'done',
    color: '#22c55e',
    position: 2,
    wipLimit: null,
  },
];

/** A whitelist: To Do → In Progress only. Everything else out of To Do is shut. */
export const RESTRICTED_TRANSITIONS: Transition[] = [
  {
    id: '10101010-1010-4010-8010-101010101010',
    projectId: IDS.project,
    fromStatusId: IDS.todo,
    toStatusId: IDS.doing,
  },
];

export const LABELS: TaskLabel[] = [
  { id: IDS.label, projectId: IDS.project, name: 'backend', color: '#f97316' },
];

export const SPRINTS: Sprint[] = [
  {
    id: IDS.sprint,
    projectId: IDS.project,
    name: 'Sprint 4',
    goal: null,
    state: 'active',
    startDate: '2026-03-01',
    endDate: '2026-03-14',
    startedAt: '2026-03-01T09:00:00.000Z',
    completedAt: null,
    committedPoints: 21,
    completedPoints: null,
    createdAt: '2026-02-20T09:00:00.000Z',
    updatedAt: '2026-03-01T09:00:00.000Z',
  },
];

/** The task the panel suites render. Deliberately NOT sparse: every section
 *  should have something to draw. */
export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: IDS.task,
    projectId: IDS.project,
    projectKey: 'FLOW',
    number: 142,
    key: 'FLOW-142',
    title: 'Rebalance fractional ranks',
    description: `Ranks grow without bound. See @[Ada Lovelace](${IDS.ada}).\n\n- one\n- two`,
    type: 'story',
    statusId: IDS.todo,
    priority: 'high',
    assignee: ADA,
    reporter: GRACE,
    storyPoints: 3,
    startDate: '2026-03-02',
    dueDate: '2026-03-09',
    sprintId: IDS.sprint,
    epicId: null,
    epic: null,
    parentId: null,
    boardRank: 'a0',
    backlogRank: 'a0',
    resolvedAt: null,
    labels: LABELS,
    watcherIds: [IDS.ada],
    dependencies: {
      blockers: [
        {
          id: IDS.blocker,
          number: 7,
          key: 'FLOW-7',
          title: 'Pick a rank alphabet',
          type: 'task',
          statusId: IDS.done,
        },
      ],
      blocked: [],
    },
    subtaskIds: [IDS.subtask],
    commentCount: 1,
    attachmentCount: 1,
    createdAt: '2026-02-25T10:00:00.000Z',
    updatedAt: '2026-03-02T10:00:00.000Z',
    ...overrides,
  };
}

export function makeSummary(overrides: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id: IDS.subtask,
    number: 143,
    title: 'Write the rebalance migration',
    type: 'subtask',
    priority: 'medium',
    statusId: IDS.done,
    assignee: null,
    storyPoints: null,
    startDate: null,
    dueDate: null,
    labelIds: [],
    epicId: null,
    parentId: IDS.task,
    boardRank: 'a1',
    backlogRank: 'a1',
    sprintId: IDS.sprint,
    hasDescription: false,
    commentCount: 0,
    attachmentCount: 0,
    updatedAt: '2026-03-02T10:00:00.000Z',
    ...overrides,
  };
}

export const COMMENTS: Comment[] = [
  {
    id: IDS.comment,
    taskId: IDS.task,
    author: GRACE,
    body: `Agreed — ping @[Ada Lovelace](${IDS.ada}) when the migration lands.`,
    editedAt: null,
    createdAt: '2026-03-02T11:00:00.000Z',
  },
];

export const ATTACHMENTS: Attachment[] = [
  {
    id: IDS.attachment,
    taskId: IDS.task,
    fileName: 'rank-growth.pdf',
    mimeType: 'application/pdf',
    sizeBytes: 1536,
    s3Key: 'org/project/task/rank-growth.pdf',
    uploadedBy: ADA,
    createdAt: '2026-03-02T11:30:00.000Z',
  },
];

export const ACTIVITY: Activity[] = [
  {
    id: '2',
    projectId: IDS.project,
    taskId: IDS.task,
    actor: ADA,
    action: 'task.status_changed',
    field: 'statusId',
    oldValue: IDS.todo,
    newValue: IDS.doing,
    createdAt: '2026-03-02T12:00:00.000Z',
  },
  {
    id: '1',
    projectId: IDS.project,
    taskId: IDS.task,
    actor: null,
    action: 'task.created',
    createdAt: '2026-02-25T10:00:00.000Z',
  },
];
