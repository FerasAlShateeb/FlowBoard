import { useMatch } from 'react-router-dom';

/**
 * The org / project the current URL is inside — readable from ANY component,
 * including the layout chrome.
 *
 * WHY NOT `useParams()`. React Router scopes `useParams` to the CLOSEST matched
 * route, and `AppShell` (with its sidebar and topbar) is a layout route
 * ABOVE `/o/:orgSlug/p/:projectKey/*`. Calling `useParams()` there returns an
 * empty object — the child's params are simply not in scope. `useMatch` matches
 * the full location against a pattern instead, which is exactly the question
 * the sidebar is asking: "am I inside a project, and if so, which one?".
 *
 * Returns `null` for a segment that is not in the URL, so a caller can render
 * the workspace nav on `/notifications` and the project nav on a board with one
 * branch.
 */
export interface RouteScope {
  /** The org slug from `/o/:orgSlug/…`, or null outside any org. */
  orgSlug: string | null;
  /** The project key from `/o/:orgSlug/p/:projectKey/…`, or null. */
  projectKey: string | null;
}

export function useRouteScope(): RouteScope {
  const orgMatch = useMatch('/o/:orgSlug/*');
  const projectMatch = useMatch('/o/:orgSlug/p/:projectKey/*');

  return {
    orgSlug: orgMatch?.params.orgSlug ?? null,
    projectKey: projectMatch?.params.projectKey ?? null,
  };
}

/**
 * Absolute path builder for the project views, so no component hand-assembles
 * `/o/${slug}/p/${key}/board` and gets the segment order wrong.
 */
export function projectPath(orgSlug: string, projectKey: string, view: string): string {
  return `/o/${orgSlug}/p/${projectKey}/${view}`;
}

/** Absolute path builder for the org-level pages. */
export function orgPath(orgSlug: string, section = ''): string {
  return section ? `/o/${orgSlug}/${section}` : `/o/${orgSlug}`;
}
