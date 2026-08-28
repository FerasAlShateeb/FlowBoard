import { lazy, Suspense, type ReactNode } from 'react';
import { createBrowserRouter, type RouteObject } from 'react-router-dom';

import AppShell from '@/components/layout/AppShell';
import PageSpinner from '@/components/common/PageSpinner';
import { PublicOnly, RequireAuth, RequireGlobalAdmin } from '@/routes/guards';
import RouteErrorScreen from '@/routes/RouteErrorScreen';
// SIDE-EFFECT IMPORT: installs the `vite:preloadError` listener that reloads a
// tab left open across a deploy (see `lib/chunk-recovery`). This module is in
// the ENTRY graph — `main.tsx` imports the router synchronously — so the
// listener exists before any lazy page below can be requested.
import '@/lib/chunk-recovery';

/**
 * The complete route table (plan §Frontend architecture).
 *
 * EVERY page is `React.lazy`, so a first visit downloads the shell and one view
 * rather than the whole product. They resolve inside `AppShell`'s own Suspense
 * boundary, which is why the sidebar and topbar do not blink on navigation; the
 * routes OUTSIDE the shell (login, invite) carry their own full-page boundary.
 *
 * EVERY top-level route object — and the `AppShell` layout route — carries
 * `errorElement: <RouteErrorScreen/>`. React Router walks UP to the nearest
 * ancestor with one, so covering these branches means no thrown route error can
 * reach the framework's default page.
 *
 * The table itself is FINAL. Wave 2/3/4 agents replace the page modules at
 * these exact paths; they do not add or move routes.
 */

// ── Public ──────────────────────────────────────────────────────────────────
const LoginPage = lazy(() => import('@/pages/LoginPage'));
const InvitePage = lazy(() => import('@/pages/InvitePage'));

// ── Workspace ───────────────────────────────────────────────────────────────
const HomePage = lazy(() => import('@/pages/HomePage'));
const NotificationsPage = lazy(() => import('@/pages/NotificationsPage'));
const ProfilePage = lazy(() => import('@/pages/ProfilePage'));
const ThemePage = lazy(() => import('@/pages/ThemePage'));
const NotFoundPage = lazy(() => import('@/pages/NotFoundPage'));

// ── Organization ────────────────────────────────────────────────────────────
const OrgHomePage = lazy(() => import('@/pages/org/OrgHomePage'));
const OrgTeamsPage = lazy(() => import('@/pages/org/OrgTeamsPage'));
const OrgMembersPage = lazy(() => import('@/pages/org/OrgMembersPage'));
const OrgSettingsPage = lazy(() => import('@/pages/org/OrgSettingsPage'));

// ── Project views ───────────────────────────────────────────────────────────
const BoardPage = lazy(() => import('@/pages/project/BoardPage'));
const BacklogPage = lazy(() => import('@/pages/project/BacklogPage'));
const RoadmapPage = lazy(() => import('@/pages/project/RoadmapPage'));
const TablePage = lazy(() => import('@/pages/project/TablePage'));
const CalendarPage = lazy(() => import('@/pages/project/CalendarPage'));
const DashboardPage = lazy(() => import('@/pages/project/DashboardPage'));
const TaskSheetPage = lazy(() => import('@/pages/project/TaskSheetPage'));

// ── Project settings ────────────────────────────────────────────────────────
const ProjectSettingsPage = lazy(() => import('@/pages/project/settings/ProjectSettingsPage'));
const ProjectGeneralPage = lazy(() => import('@/pages/project/settings/ProjectGeneralPage'));
const ProjectWorkflowPage = lazy(() => import('@/pages/project/settings/ProjectWorkflowPage'));
const ProjectMembersPage = lazy(() => import('@/pages/project/settings/ProjectMembersPage'));
const ProjectLabelsPage = lazy(() => import('@/pages/project/settings/ProjectLabelsPage'));

// ── Global admin ────────────────────────────────────────────────────────────
const AdminUsersPage = lazy(() => import('@/pages/admin/AdminUsersPage'));
const AdminTelemetryPage = lazy(() => import('@/pages/admin/AdminTelemetryPage'));
const AdminTelemetryEventsPage = lazy(() => import('@/pages/admin/AdminTelemetryEventsPage'));
const AdminTelemetryRequestsPage = lazy(() => import('@/pages/admin/AdminTelemetryRequestsPage'));

/** Wraps a route element in a full-page Suspense boundary (outside the shell). */
function standalone(element: ReactNode): ReactNode {
  return <Suspense fallback={<PageSpinner full />}>{element}</Suspense>;
}

/**
 * The deep-linkable task panel, mounted as a CHILD of each project view.
 *
 * `/…/board/t/FB-142` therefore renders the board AND the sheet over it: the
 * parent stays mounted (no refetch, no scroll loss) and closing the sheet is a
 * history `back()`. Every view gets its own copy of this object because React
 * Router route objects are positional — sharing one instance across parents
 * would be fine today, but a fresh object per view keeps each branch
 * independently editable by its Wave 3 owner.
 */
function taskSheetRoute(): RouteObject {
  return { path: 't/:taskKey', element: <TaskSheetPage /> };
}

export const router = createBrowserRouter([
  {
    element: <PublicOnly />,
    errorElement: <RouteErrorScreen />,
    children: [{ path: '/login', element: standalone(<LoginPage />) }],
  },

  /**
   * `/invite/:token` is PUBLIC and guard-free — deliberately outside BOTH
   * `RequireAuth` (a signed-out stranger is the primary audience of an invite
   * link) and `PublicOnly` (an already-signed-in user must still be able to
   * redeem one). It also sits outside `AppShell`: there is no org context yet.
   */
  {
    path: '/invite/:token',
    errorElement: <RouteErrorScreen />,
    element: standalone(<InvitePage />),
  },

  {
    element: <RequireAuth />,
    errorElement: <RouteErrorScreen />,
    children: [
      {
        element: <AppShell />,
        errorElement: <RouteErrorScreen />,
        children: [
          { path: '/', element: <HomePage /> },

          // ── Organization ──────────────────────────────────────────────────
          { path: '/o/:orgSlug', element: <OrgHomePage /> },
          { path: '/o/:orgSlug/teams', element: <OrgTeamsPage /> },
          { path: '/o/:orgSlug/members', element: <OrgMembersPage /> },
          { path: '/o/:orgSlug/settings', element: <OrgSettingsPage /> },

          // ── Project: the five views + the dashboard ────────────────────────
          {
            path: '/o/:orgSlug/p/:projectKey/board',
            element: <BoardPage />,
            children: [taskSheetRoute()],
          },
          {
            path: '/o/:orgSlug/p/:projectKey/backlog',
            element: <BacklogPage />,
            children: [taskSheetRoute()],
          },
          {
            path: '/o/:orgSlug/p/:projectKey/roadmap',
            element: <RoadmapPage />,
            children: [taskSheetRoute()],
          },
          {
            path: '/o/:orgSlug/p/:projectKey/table',
            element: <TablePage />,
            children: [taskSheetRoute()],
          },
          {
            path: '/o/:orgSlug/p/:projectKey/calendar',
            element: <CalendarPage />,
            children: [taskSheetRoute()],
          },
          {
            path: '/o/:orgSlug/p/:projectKey/dashboard',
            element: <DashboardPage />,
            children: [taskSheetRoute()],
          },

          // ── Project settings (a layout route with tabbed children) ─────────
          {
            path: '/o/:orgSlug/p/:projectKey/settings',
            element: <ProjectSettingsPage />,
            children: [
              { index: true, element: <ProjectGeneralPage /> },
              { path: 'workflow', element: <ProjectWorkflowPage /> },
              { path: 'members', element: <ProjectMembersPage /> },
              { path: 'labels', element: <ProjectLabelsPage /> },
            ],
          },

          // ── Personal ──────────────────────────────────────────────────────
          { path: '/notifications', element: <NotificationsPage /> },
          { path: '/me', element: <ProfilePage /> },
          { path: '/theme', element: <ThemePage /> },

          // ── Global admin ──────────────────────────────────────────────────
          {
            element: <RequireGlobalAdmin />,
            children: [
              { path: '/admin/users', element: <AdminUsersPage /> },
              { path: '/admin/telemetry', element: <AdminTelemetryPage /> },
              { path: '/admin/telemetry/events', element: <AdminTelemetryEventsPage /> },
              { path: '/admin/telemetry/requests', element: <AdminTelemetryRequestsPage /> },
            ],
          },

          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
]);
