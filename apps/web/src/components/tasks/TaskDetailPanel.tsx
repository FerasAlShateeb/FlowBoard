import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type {
  CreateDependencyInput,
  PatchTaskInput,
  ProjectRole,
  Task,
  TaskSummary,
  TaskType,
} from '@flowboard/shared';

import { DEFAULT_LABEL_COLOR } from '@/lib/label-colors';
import { useAuthStore } from '@/stores/useAuthStore';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { canAdminProject, canWriteProject, useCreateLabel, useLabels } from '@/hooks/useProjects';
import { useTaskList } from '@/hooks/useTasks';
import { useCreateTask, useDeleteTask, usePatchTask } from '@/hooks/useTaskMutations';
import { useWorkflow } from '@/hooks/useWorkflow';
import { useSprints } from '@/hooks/useSprints';
import {
  useComments,
  useCreateComment,
  useDeleteComment,
  useUpdateComment,
} from '@/hooks/useComments';
import { useAddDependency, useRemoveDependency } from '@/hooks/useDependencies';
import {
  useAttachmentUrl,
  useAttachments,
  useDeleteAttachment,
  useUploadAttachment,
} from '@/hooks/useAttachments';
import { useIsWatching, useUnwatchTask, useWatchTask } from '@/hooks/useWatchers';
import { useActivity, flattenActivity } from '@/hooks/useActivity';
import { ActivityFeed } from '@/components/tasks/ActivityFeed';
import { AttachmentSection } from '@/components/tasks/AttachmentSection';
import { CommentComposer } from '@/components/tasks/CommentComposer';
import { CommentThread } from '@/components/tasks/CommentThread';
import { DependencySection } from '@/components/tasks/DependencySection';
import { SubtaskList } from '@/components/tasks/SubtaskList';
import { TaskDescription } from '@/components/tasks/TaskDescription';
import { TaskFieldsSidebar } from '@/components/tasks/TaskFieldsSidebar';
import { TaskHeaderBar } from '@/components/tasks/TaskHeaderBar';

/**
 * The task detail panel — the richest single surface in FlowBoard, and the one
 * place where a dozen data hooks meet.
 *
 * ── This component is the WIRING; the sections are the UI ───────────────────
 *
 * Every visual section below (`TaskHeaderBar`, `TaskDescription`,
 * `TaskFieldsSidebar`, `SubtaskList`, `DependencySection`, `CommentThread`,
 * `AttachmentSection`, `ActivityFeed`) takes plain data and plain callbacks and
 * calls no hook of its own. That split is deliberate and load-bearing: it is why
 * each one can be rendered in a test with a fixture and no query client, and it
 * is why the async story of this screen — nine queries, eleven mutations —
 * lives in exactly one file where it can be read at once.
 *
 * ── One task list, three consumers ──────────────────────────────────────────
 *
 * The epic picker, the dependency picker and the parent link all need "the
 * project's tasks", so they share ONE `useTaskList(projectId)` query rather than
 * issuing three. Subtasks are a genuinely different question (`?parentId=`) and
 * keep their own. The shared list is capped at the hook's 100 rows, which is a
 * real limit on very large projects — the pickers filter client-side, so the
 * honest description is "the hundred most recent tasks", and a project past that
 * wants a server-side picker search rather than a bigger page.
 *
 * ── Permissions gate CHROME, never data ────────────────────────────────────
 *
 * `canWriteProject` / `canAdminProject` read the ONE effective role the server
 * resolved (global admin ⊃ org admin ⊃ project role). They hide controls that
 * would fail; every one of those endpoints re-checks the role anyway.
 */

export interface TaskDetailPanelProps {
  task: Task;
  orgId: string | null;
  projectId: string;
  /** For composing display keys (`FLOW-142`) from a summary's `number`. */
  projectKey: string;
  role: ProjectRole | undefined;
  /** The absolute deep link to this task — the header's copy button. */
  taskUrl: string;
  /** Navigates the sheet to another task by KEY. */
  onOpenTask: (taskKey: string) => void;
  /** Closes the sheet — called after a successful delete. */
  onClose: () => void;
}

export function TaskDetailPanel({
  task,
  orgId,
  projectId,
  projectKey,
  role,
  taskUrl,
  onOpenTask,
  onClose,
}: TaskDetailPanelProps) {
  const { t } = useTranslation(['tasks', 'common']);
  const currentUserId = useAuthStore((state) => state.user?.id ?? null);

  const canEdit = canWriteProject(role);
  const canAdmin = canAdminProject(role);

  // ── Reads ───────────────────────────────────────────────────────────────
  const { workflow } = useWorkflow(projectId);
  const { data: sprints } = useSprints(projectId);
  const { data: labels } = useLabels(projectId);
  const { data: projectTasks } = useTaskList(projectId);
  const { data: subtasks, isPending: subtasksPending } = useTaskList(projectId, {
    parentId: task.id,
  });
  const { data: comments, isPending: commentsPending } = useComments(task.id);
  const { data: attachments, isPending: attachmentsPending } = useAttachments(task.id);
  const activity = useActivity(task.id);

  // ── Writes ──────────────────────────────────────────────────────────────
  const patchTask = usePatchTask(projectId);
  const deleteTask = useDeleteTask(projectId);
  const createTask = useCreateTask(projectId);
  const createLabel = useCreateLabel(projectId);
  const watchTask = useWatchTask(task.id);
  const unwatchTask = useUnwatchTask(task.id);
  const addDependency = useAddDependency(task.id);
  const removeDependency = useRemoveDependency(task.id);
  const createComment = useCreateComment(task.id);
  const updateComment = useUpdateComment(task.id);
  const deleteComment = useDeleteComment(task.id);
  const uploadAttachment = useUploadAttachment(task.id);
  const deleteAttachment = useDeleteAttachment(task.id);
  const attachmentUrl = useAttachmentUrl();

  const isWatching = useIsWatching(task.watcherIds);

  const [tab, setTab] = useState<'comments' | 'activity'>('comments');

  // ── Derived collections ─────────────────────────────────────────────────

  const taskKeyOf = useCallback(
    (summary: TaskSummary) => `${projectKey}-${String(summary.number)}`,
    [projectKey],
  );

  /** Epics, minus this task — an epic cannot be its own parent epic. */
  const epics = useMemo(
    () => (projectTasks ?? []).filter((entry) => entry.type === 'epic' && entry.id !== task.id),
    [projectTasks, task.id],
  );

  /** Everything except this task — the dependency picker's candidate pool. */
  const dependencyCandidates = useMemo(
    () => (projectTasks ?? []).filter((entry) => entry.id !== task.id),
    [projectTasks, task.id],
  );

  const parent = useMemo(
    () => (projectTasks ?? []).find((entry) => entry.id === task.parentId) ?? null,
    [projectTasks, task.parentId],
  );

  /** Names the activity feed can resolve a uuid against. */
  const people = useMemo(
    () => [task.assignee, task.reporter].filter((user) => user !== null),
    [task.assignee, task.reporter],
  );

  // ── Callbacks ───────────────────────────────────────────────────────────

  const patch = useCallback(
    (input: PatchTaskInput) => {
      patchTask.mutate({ taskId: task.id, ...input });
    },
    [patchTask, task.id],
  );

  const handleCreateLabel = useCallback(
    (name: string) => {
      createLabel.mutate(
        { name, color: DEFAULT_LABEL_COLOR },
        {
          // Creating a label from the task sheet always means "and put it on
          // this task" — that is what the user was doing when they typed it.
          onSuccess: (created) => {
            patch({ labelIds: [...task.labels.map((label) => label.id), created.id] });
          },
        },
      );
    },
    [createLabel, patch, task.labels],
  );

  const handleUpload = useCallback(
    (file: File, onProgress: (percent: number) => void): Promise<boolean> =>
      uploadAttachment.mutateAsync({ file, onProgress }).then(
        () => true,
        // The hook's shared `onError` has already raised the localized toast;
        // this only tells the dropzone which row to mark failed.
        () => false,
      ),
    [uploadAttachment],
  );

  const { mutateAsync: mintUrl } = attachmentUrl;
  const handleResolveUrl = useCallback(
    (attachmentId: string): Promise<string | null> =>
      mintUrl(attachmentId).then(
        (result) => result.url,
        () => null,
      ),
    [mintUrl],
  );

  const handleAddComment = useCallback(
    (body: string): Promise<boolean> =>
      createComment.mutateAsync(body).then(
        () => true,
        () => false,
      ),
    [createComment],
  );

  const handleAddDependency = useCallback(
    (input: CreateDependencyInput) => {
      // Not optimistic: only the server can walk the graph for a cycle, and
      // `dependency_cycle` arrives as a localized toast through the hook.
      addDependency.mutate(input);
    },
    [addDependency],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4">
      <TaskHeaderBar
        task={task}
        statuses={workflow.statuses}
        transitions={workflow.transitions}
        taskUrl={taskUrl}
        canEdit={canEdit}
        isWatching={isWatching}
        isSaving={patchTask.isPending}
        isDeleting={deleteTask.isPending}
        onChangeType={(type: TaskType) => {
          patch({ type });
        }}
        onChangeStatus={(statusId) => {
          patch({ statusId });
        }}
        onToggleWatch={(next) => {
          if (next) watchTask.mutate({});
          else unwatchTask.mutate();
        }}
        onDelete={() => {
          deleteTask.mutate(task.id, { onSuccess: onClose });
        }}
      />

      <TaskTitle
        task={task}
        canEdit={canEdit}
        onRename={(title) => {
          patch({ title });
        }}
      />

      {/* The two-column body. `lg:` rather than a fixed split: the sheet is
          640px wide by default but a user can be on a narrow laptop, and a
          150px fields column next to a 150px description helps nobody. */}
      <div className="grid gap-5 lg:grid-cols-[1fr_15rem]">
        <div className="flex min-w-0 flex-col gap-5">
          <TaskDescription
            taskId={task.id}
            description={task.description}
            orgId={orgId}
            canEdit={canEdit}
            isSaving={patchTask.isPending}
            onSave={(description) => {
              patch({ description });
            }}
          />

          <SubtaskList
            task={task}
            subtasks={subtasks ?? []}
            statuses={workflow.statuses}
            parent={parent}
            canEdit={canEdit}
            isPending={subtasksPending}
            isCreating={createTask.isPending}
            taskKeyOf={taskKeyOf}
            onOpenTask={onOpenTask}
            onCreate={(title) => {
              createTask.mutate({
                title,
                description: null,
                type: 'subtask',
                priority: task.priority,
                assigneeId: null,
                storyPoints: null,
                startDate: null,
                dueDate: null,
                // A subtask belongs to the same sprint as its parent by default:
                // splitting a story across sprints is a decision, not a default.
                sprintId: task.sprintId,
                epicId: null,
                parentId: task.id,
                labelIds: [],
                watcherIds: [],
              });
            }}
          />

          <DependencySection
            task={task}
            statuses={workflow.statuses}
            candidates={dependencyCandidates}
            canEdit={canEdit}
            isPending={addDependency.isPending || removeDependency.isPending}
            taskKeyOf={taskKeyOf}
            onOpenTask={onOpenTask}
            onAdd={handleAddDependency}
            onRemove={(otherTaskId) => {
              removeDependency.mutate(otherTaskId);
            }}
          />

          <AttachmentSection
            attachments={attachments ?? []}
            currentUserId={currentUserId}
            canModerate={canAdmin}
            canEdit={canEdit}
            isPending={attachmentsPending}
            onUpload={handleUpload}
            onResolveUrl={handleResolveUrl}
            onDelete={(attachmentId) => {
              deleteAttachment.mutate(attachmentId);
            }}
          />
        </div>

        <TaskFieldsSidebar
          task={task}
          orgId={orgId}
          sprints={sprints ?? []}
          epics={epics}
          labels={labels ?? []}
          canEdit={canEdit}
          isSaving={patchTask.isPending}
          onPatch={patch}
          // Creating a label edits the project's shared vocabulary, so the
          // inline "create" row only exists for a project admin.
          {...(canAdmin ? { onCreateLabel: handleCreateLabel } : {})}
        />
      </div>

      {/* ── Comments | Activity ───────────────────────────────────────────── */}
      <Tabs
        value={tab}
        onValueChange={(value) => {
          setTab(value === 'activity' ? 'activity' : 'comments');
        }}
        className="mt-2 border-t border-border pt-4"
      >
        <TabsList>
          <TabsTrigger value="comments">
            {t('tasks:tabs.comments')}
            <span className="tabular-nums">{task.commentCount}</span>
          </TabsTrigger>
          <TabsTrigger value="activity">{t('tasks:tabs.activity')}</TabsTrigger>
        </TabsList>

        <TabsContent value="comments" className="flex flex-col gap-4 pt-3">
          <CommentThread
            comments={comments ?? []}
            orgId={orgId}
            currentUserId={currentUserId}
            canModerate={canAdmin}
            isPending={commentsPending}
            isSaving={updateComment.isPending}
            onUpdate={(commentId, body) => {
              updateComment.mutate({ commentId, body });
            }}
            onDelete={(commentId) => {
              deleteComment.mutate(commentId);
            }}
          />
          {canEdit ? (
            <CommentComposer
              orgId={orgId}
              isPending={createComment.isPending}
              onSubmit={handleAddComment}
            />
          ) : null}
        </TabsContent>

        <TabsContent value="activity" className="pt-3">
          <ActivityFeed
            entries={flattenActivity(activity.data?.pages)}
            statuses={workflow.statuses}
            labels={labels ?? []}
            sprints={sprints ?? []}
            people={people}
            isPending={activity.isPending}
            isFetchingMore={activity.isFetchingNextPage}
            hasMore={activity.hasNextPage}
            onLoadMore={() => {
              void activity.fetchNextPage();
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}

/**
 * The title: an `h2` that becomes an input on click.
 *
 * A textarea rather than an input, because a 200-character title wraps and a
 * single-line field would hide most of it behind a scroll the user cannot see.
 * Enter commits (titles are one line by contract), Escape abandons.
 */
function TaskTitle({
  task,
  canEdit,
  onRename,
}: {
  task: Task;
  canEdit: boolean;
  onRename: (title: string) => void;
}) {
  const { t } = useTranslation(['tasks', 'common']);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(task.title);

  const commit = () => {
    const trimmed = draft.trim();
    setEditing(false);
    if (trimmed !== '' && trimmed !== task.title) onRename(trimmed);
  };

  if (!editing) {
    return (
      // The BUTTON goes INSIDE the heading rather than replacing its role.
      // Putting `role="button"` on the `<h2>` itself would strip the task's
      // title out of the document outline — the one landmark a screen-reader
      // user navigates this panel by — in exchange for a click target that a
      // nested real button provides anyway.
      // `dir="auto"`: the title is USER-GENERATED text, so the heading takes
      // the direction of what was actually typed rather than the page's — see
      // `UserChip` in `components/common/UserAvatar.tsx`.
      <h2 dir="auto" className="text-base leading-snug font-semibold text-balance text-foreground">
        {canEdit ? (
          <button
            type="button"
            title={t('common:actions.edit')}
            className="-mx-1 w-full rounded-[var(--radius)] px-1 text-start transition-colors duration-[var(--speed)] hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none"
            onClick={() => {
              setDraft(task.title);
              setEditing(true);
            }}
          >
            {task.title}
          </button>
        ) : (
          task.title
        )}
      </h2>
    );
  }

  return (
    <textarea
      value={draft}
      rows={2}
      autoFocus
      aria-label={t('tasks:create.titleField')}
      maxLength={200}
      className="w-full resize-none rounded-[var(--input-radius)] border border-input bg-surface px-2 py-1.5 text-base leading-snug font-semibold text-foreground outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/25"
      onChange={(event) => {
        setDraft(event.target.value);
      }}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          event.preventDefault();
          commit();
          return;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          setEditing(false);
        }
      }}
    />
  );
}

export default TaskDetailPanel;
