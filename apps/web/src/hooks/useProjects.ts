import { useMutation, useQuery, useQueryClient, type UseQueryResult } from '@tanstack/react-query';
import { useParams } from 'react-router-dom';
import { z } from 'zod';
import {
  labelSchema,
  projectDetailSchema,
  projectMemberSchema,
  projectWithRoleSchema,
  type AddProjectMemberInput,
  type CreateLabelInput,
  type CreateProjectInput,
  type Label,
  type ProjectDetail,
  type ProjectMember,
  type ProjectRole,
  type ProjectWithRole,
  type UpdateLabelInput,
  type UpdateProjectInput,
} from '@flowboard/shared';

import { api } from '@/lib/api';
import { qk } from '@/lib/query-keys';
import { useOrgBySlug } from '@/hooks/useOrgs';
import { useApiErrorToast } from '@/i18n/errors';

/**
 * Projects, their membership, and their label vocabulary.
 *
 * `GET /projects/:projectId` is THE call every project view boots from — it
 * bundles the workflow columns and the labels because the board needs both
 * before it can draw a single card, and the client-side "is this drop allowed"
 * pre-check reads the statuses straight out of this cache entry rather than
 * round-tripping per drag. That is why almost every mutation below invalidates
 * `qk.project.detail(projectId)` rather than some narrower key.
 */

const projectListSchema = z.array(projectWithRoleSchema);
const memberListSchema = z.array(projectMemberSchema);
const labelListSchema = z.array(labelSchema);

// ───────────────────────────────────────────────────────────────────────────
// Queries
// ───────────────────────────────────────────────────────────────────────────

/** `GET /orgs/:orgId/projects` — the org home grid, with effective roles. */
export function useProjects(orgId: string | null | undefined): UseQueryResult<ProjectWithRole[]> {
  return useQuery({
    queryKey: qk.orgs.projects(orgId ?? ''),
    queryFn: ({ signal }) =>
      api.get(`/orgs/${orgId ?? ''}/projects`, { schema: projectListSchema, signal }),
    enabled: Boolean(orgId),
  });
}

/**
 * The project whose KEY is in the URL, resolved from the org's list.
 *
 * Same bridge as `useOrgBySlug`: routes address a project by its human key
 * (`/p/FLOW`) and the API addresses it by id. Resolving from the already-loaded
 * list avoids a by-key lookup endpoint on every project navigation.
 */
export function useProjectByKey(
  orgId: string | null | undefined,
  projectKey: string | null | undefined,
): { project: ProjectWithRole | null; isPending: boolean; error: unknown } {
  const { data, isPending, error } = useProjects(orgId);
  const project =
    projectKey == null
      ? null
      : (data?.find((entry) => entry.key === projectKey.toUpperCase()) ?? null);
  return { project, isPending, error };
}

/**
 * `GET /projects/:projectId` — statuses, labels, the caller's role.
 *
 * Longer `staleTime` than the app default: a workflow does not change while you
 * are dragging, the socket layer (WP4.1) pushes `workflow:changed` when it
 * does, and every board render reads this entry.
 */
export function useProject(projectId: string | null | undefined): UseQueryResult<ProjectDetail> {
  return useQuery({
    queryKey: qk.project.detail(projectId ?? ''),
    queryFn: ({ signal }) =>
      api.get(`/projects/${projectId ?? ''}`, { schema: projectDetailSchema, signal }),
    enabled: Boolean(projectId),
    staleTime: 2 * 60_000,
  });
}

/** `GET /projects/:projectId/members`. */
export function useProjectMembers(
  projectId: string | null | undefined,
): UseQueryResult<ProjectMember[]> {
  return useQuery({
    queryKey: qk.project.members(projectId ?? ''),
    queryFn: ({ signal }) =>
      api.get(`/projects/${projectId ?? ''}/members`, { schema: memberListSchema, signal }),
    enabled: Boolean(projectId),
  });
}

/**
 * `GET /projects/:projectId/labels`.
 *
 * The labels are ALSO on the project detail, and most surfaces read them from
 * there. This query exists for the labels editor, which needs to refetch just
 * the vocabulary after a CRUD without re-pulling the whole project payload.
 */
export function useLabels(projectId: string | null | undefined): UseQueryResult<Label[]> {
  return useQuery({
    queryKey: qk.project.labels(projectId ?? ''),
    queryFn: ({ signal }) =>
      api.get(`/projects/${projectId ?? ''}/labels`, { schema: labelListSchema, signal }),
    enabled: Boolean(projectId),
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Project mutations
// ───────────────────────────────────────────────────────────────────────────

/** `POST /orgs/:orgId/projects` — the creator becomes its first admin. */
export function useCreateProject(orgId: string) {
  const queryClient = useQueryClient();
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: (input: CreateProjectInput) =>
      api.post<ProjectWithRole>(`/orgs/${orgId}/projects`, input, {
        // WITH ROLE: create and update both answer the caller's EFFECTIVE role
        // on the project (already widened by org/global admin server-side).
        // Parsing the bare `projectSchema` stripped it, so the settings screen
        // that navigated straight from the create dialog had to refetch before
        // it knew whether to render its admin controls.
        schema: projectWithRoleSchema,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.orgs.projects(orgId) });
      // The org card in the picker shows a project count.
      void queryClient.invalidateQueries({ queryKey: qk.orgs.mine() });
    },
    onError,
  });
}

/** `PATCH /projects/:projectId` — name, description, lead, team. */
export function useUpdateProject(projectId: string, orgId?: string) {
  const queryClient = useQueryClient();
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: (input: UpdateProjectInput) =>
      api.patch<ProjectWithRole>(`/projects/${projectId}`, input, {
        schema: projectWithRoleSchema,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.project.detail(projectId) });
      if (orgId) void queryClient.invalidateQueries({ queryKey: qk.orgs.projects(orgId) });
    },
    onError,
  });
}

/**
 * `DELETE /projects/:projectId` — soft-deletes the project and everything on it.
 *
 * The whole `['project', projectId]` prefix is removed rather than invalidated:
 * the board, backlog, sprints and reports under it are all gone, and
 * invalidating would fire a burst of requests that 404 in sequence.
 */
export function useDeleteProject(orgId?: string) {
  const queryClient = useQueryClient();
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: (projectId: string) => api.del<void>(`/projects/${projectId}`),
    onSuccess: (_result, projectId) => {
      queryClient.removeQueries({ queryKey: qk.project.all(projectId) });
      if (orgId) void queryClient.invalidateQueries({ queryKey: qk.orgs.projects(orgId) });
      void queryClient.invalidateQueries({ queryKey: qk.orgs.mine() });
    },
    onError,
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Membership mutations
// ───────────────────────────────────────────────────────────────────────────

/** `POST /projects/:projectId/members` — grant an org member a project role. */
export function useAddProjectMember(projectId: string) {
  const queryClient = useQueryClient();
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: (input: AddProjectMemberInput) =>
      api.post<ProjectMember>(`/projects/${projectId}/members`, input, {
        schema: projectMemberSchema,
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.project.members(projectId) });
      // `memberCount` lives on the project detail.
      void queryClient.invalidateQueries({ queryKey: qk.project.detail(projectId) });
    },
    onError,
  });
}

/** `PATCH /projects/:projectId/members/:userId`. */
export function useUpdateProjectMember(projectId: string) {
  const queryClient = useQueryClient();
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: ProjectRole }) =>
      api.patch<ProjectMember>(
        `/projects/${projectId}/members/${userId}`,
        { role },
        { schema: projectMemberSchema },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.project.members(projectId) });
      // Demoting YOURSELF changes what the settings page may show you, and the
      // effective role lives on the detail payload.
      void queryClient.invalidateQueries({ queryKey: qk.project.detail(projectId) });
    },
    onError,
  });
}

/** `DELETE /projects/:projectId/members/:userId`. */
export function useRemoveProjectMember(projectId: string) {
  const queryClient = useQueryClient();
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: (userId: string) => api.del<void>(`/projects/${projectId}/members/${userId}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: qk.project.members(projectId) });
      void queryClient.invalidateQueries({ queryKey: qk.project.detail(projectId) });
    },
    onError,
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Label mutations
// ───────────────────────────────────────────────────────────────────────────

/**
 * Every label mutation invalidates BOTH the label list and the project detail:
 * the detail embeds the vocabulary that board cards render their chips from, so
 * refreshing only the editor's own list would leave a renamed label stale on
 * every card until the next project fetch.
 */
function useLabelInvalidation(projectId: string): () => void {
  const queryClient = useQueryClient();
  return () => {
    void queryClient.invalidateQueries({ queryKey: qk.project.labels(projectId) });
    void queryClient.invalidateQueries({ queryKey: qk.project.detail(projectId) });
  };
}

/** `POST /projects/:projectId/labels`. */
export function useCreateLabel(projectId: string) {
  const invalidate = useLabelInvalidation(projectId);
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: (input: CreateLabelInput) =>
      api.post<Label>(`/projects/${projectId}/labels`, input, { schema: labelSchema }),
    onSuccess: invalidate,
    onError,
  });
}

/** `PATCH /projects/:projectId/labels/:labelId`. */
export function useUpdateLabel(projectId: string) {
  const invalidate = useLabelInvalidation(projectId);
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: ({ labelId, ...input }: UpdateLabelInput & { labelId: string }) =>
      api.patch<Label>(`/projects/${projectId}/labels/${labelId}`, input, { schema: labelSchema }),
    onSuccess: invalidate,
    onError,
  });
}

/**
 * `DELETE /projects/:projectId/labels/:labelId` — removes it from every task
 * that carries it, which is why the task caches go too.
 */
export function useDeleteLabel(projectId: string) {
  const queryClient = useQueryClient();
  const invalidate = useLabelInvalidation(projectId);
  const onError = useApiErrorToast();

  return useMutation({
    mutationFn: (labelId: string) => api.del<void>(`/projects/${projectId}/labels/${labelId}`),
    onSuccess: () => {
      invalidate();
      void queryClient.invalidateQueries({ queryKey: qk.tasks.all(projectId) });
    },
    onError,
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Route scope
// ───────────────────────────────────────────────────────────────────────────

/**
 * Everything a project-scoped page needs, resolved from the URL in one call.
 *
 * `/o/:orgSlug/p/:projectKey/…` names an org and a project by their HUMAN
 * identifiers; every API path below takes ids. This walks the two lookups —
 * slug → org (from the org list), key → project (from the org's project list),
 * id → detail — so a page writes one line instead of six, and every project
 * page resolves them the same way.
 *
 * `isPending` covers the WHOLE chain: a page that rendered as soon as the org
 * resolved would flash an empty project header while the detail was still in
 * flight.
 */
export function useProjectScope(): {
  orgId: string | null;
  orgSlug: string;
  orgName: string | null;
  projectId: string | null;
  projectKey: string;
  project: ProjectDetail | undefined;
  role: ProjectRole | undefined;
  isPending: boolean;
  error: unknown;
} {
  const { orgSlug = '', projectKey = '' } = useParams<{ orgSlug: string; projectKey: string }>();

  const { org, isPending: orgPending, error: orgError } = useOrgBySlug(orgSlug);
  const {
    project: listed,
    isPending: listPending,
    error: listError,
  } = useProjectByKey(org?.id, projectKey);
  const { data: project, isPending: detailPending, error: detailError } = useProject(listed?.id);

  return {
    orgId: org?.id ?? null,
    orgSlug,
    orgName: org?.name ?? null,
    projectId: listed?.id ?? null,
    projectKey,
    project,
    // The DETAIL's role is the authority — it is the same effective role the
    // list carries, but it is the one refreshed by a membership change.
    role: project?.role ?? listed?.role,
    isPending: orgPending || listPending || (listed !== null && detailPending),
    error: orgError ?? listError ?? detailError,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Permissions
// ───────────────────────────────────────────────────────────────────────────

/**
 * Does this effective project role permit writing?
 *
 * The server resolves the widening chain (global admin ⊃ org admin ⊃ project
 * role) and hands back ONE effective role, so the client never re-implements
 * it — these two helpers just read that answer. They gate chrome (hiding a
 * button the user cannot use), never data.
 */
export function canWriteProject(role: ProjectRole | undefined): boolean {
  return role === 'admin' || role === 'member';
}

/** Does this effective project role permit changing settings and workflow? */
export function canAdminProject(role: ProjectRole | undefined): boolean {
  return role === 'admin';
}
