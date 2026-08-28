import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Notification, NotificationType } from '@flowboard/shared';

import { TooltipProvider } from '@/components/ui/tooltip';
import { installJsdomStubs } from '@/components/tasks/__tests__/test-utils';
// Side-effect import: brings the default i18next instance up with the ENGLISH
// catalog, which is what `useTranslation` inside the rendered tree resolves
// against. Without it every `t()` returns its own key.
import '@/i18n';

/**
 * The jsdom harness for the notification component suites.
 *
 * The environment stubs (ResizeObserver, pointer capture, `scrollIntoView`)
 * come from the task-sheet harness rather than being copied: Radix needs
 * exactly the same three in every suite that opens a popover, and two
 * divergent copies of that list is how one suite starts failing for a reason
 * the other already solved. Everything BELOW the stubs is specific to
 * notifications — a router (the bell navigates) and notification fixtures.
 */

installJsdomStubs();

/** Retries off: an error-path test must not wait out three backoffs. */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0 },
      mutations: { retry: false },
    },
  });
}

export interface ProviderRenderResult {
  queryClient: QueryClient;
  container: HTMLElement;
  baseElement: HTMLElement;
  unmount: () => void;
}

/**
 * Renders inside the three providers the notification tree assumes.
 *
 * The explicit narrow return type is the same workaround the task harness
 * documents: two copies of `pretty-format` in this pnpm tree make Testing
 * Library's own `RenderResult` unnameable at a call site (TS2742).
 */
export function renderWithProviders(
  ui: ReactElement,
  options: { queryClient?: QueryClient } = {},
): ProviderRenderResult {
  const queryClient = options.queryClient ?? createTestQueryClient();

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>
          <TooltipProvider>{children}</TooltipProvider>
        </MemoryRouter>
      </QueryClientProvider>
    );
  }

  const result = render(ui, { wrapper: Wrapper });
  return {
    queryClient,
    container: result.container,
    baseElement: result.baseElement,
    unmount: result.unmount,
  };
}

/** The provider wrapper on its own, for `renderHook`. */
export function hookWrapper(queryClient: QueryClient) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <MemoryRouter>{children}</MemoryRouter>
      </QueryClientProvider>
    );
  };
}

let sequence = 0;

/** One notification row, fully populated unless a test says otherwise. */
export function makeNotification(overrides: Partial<Notification> = {}): Notification {
  sequence += 1;
  const type: NotificationType = overrides.type ?? 'comment_added';
  return {
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`,
    recipientId: '22222222-2222-4222-8222-222222222222',
    type,
    payload: {
      taskId: '33333333-3333-4333-8333-333333333333',
      taskKey: `FLOW-${String(sequence)}`,
      taskTitle: 'Rebalance fractional ranks',
      projectKey: 'FLOW',
      projectName: 'FlowBoard',
      orgSlug: 'acme',
      actorName: 'Ada Lovelace',
    },
    readAt: null,
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

/** The `{pages, pageParams}` shape `useInfiniteQuery` keeps in the cache. */
export function makeInfiniteData(items: Notification[], totalPages = 1) {
  return {
    pages: [
      {
        items,
        meta: { page: 1, pageSize: 20, total: items.length, totalPages },
      },
    ],
    pageParams: [1],
  };
}
