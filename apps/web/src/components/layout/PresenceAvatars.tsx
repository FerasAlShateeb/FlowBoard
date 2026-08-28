import { useQueryClient } from '@tanstack/react-query';
import type { PresenceEntry, Task } from '@flowboard/shared';

import { qk } from '@/lib/query-keys';
import { UserAvatar } from '@/components/common/UserAvatar';
import { AvatarBadge, AvatarGroup, AvatarGroupCount } from '@/components/ui/avatar';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAuthStore } from '@/stores/useAuthStore';
import { useOthersPresent } from '@/stores/usePresenceStore';

/**
 * WHO ELSE IS IN THIS PROJECT — the overlapping avatar row in the topbar.
 *
 * ═══ WHY IT RENDERS NOTHING RATHER THAN "NOBODY ELSE IS HERE" ══════════════
 *
 * Presence is ambient information: it earns its 100px of a 48px-tall topbar
 * only while it has something to say. An empty state here would be a permanent
 * piece of chrome reporting the most common fact in the product. Working alone
 * is the default, and the default needs no label.
 *
 * ═══ SELF IS EXCLUDED ══════════════════════════════════════════════════════
 *
 * The server broadcasts one roster to the whole room — the same payload, fanned
 * out unchanged — and each client drops its own entry (`useOthersPresent`).
 * Seeing your own avatar in a "who else is here" row is at best noise and at
 * worst misread as a second session.
 *
 * ═══ THE COPY PROBLEM, AND HOW THIS SIDESTEPS IT ═══════════════════════════
 *
 * Every user-visible string in FlowBoard goes through i18next with COMPILE-TIME
 * key checking (`i18n/i18next.d.ts` types `t()` against the English catalog),
 * and adding a namespace means editing `locales/{en,ar}/index.ts` — stitch files
 * this work package does not own. So this component is built to need no copy:
 * the tooltip shows a person's NAME and, when they have a task open, that
 * task's KEY. Both are data, not interface language, and both are already
 * correct in every locale. The dot on the corner of an avatar carries "is
 * reading something" without a word. If a future pass wants "Ada is viewing
 * FLOW-12" as a sentence, that is one `realtime` namespace away — see the
 * report's gap list.
 */

/** How many faces fit before the row collapses into a count. */
const MAX_VISIBLE = 5;

export interface PresenceAvatarsProps {
  projectId: string | null | undefined;
}

export function PresenceAvatars({ projectId }: PresenceAvatarsProps) {
  const selfUserId = useAuthStore((state) => state.user?.id ?? null);
  const others = useOthersPresent(projectId, selfUserId);
  const queryClient = useQueryClient();

  if (others.length === 0) return null;

  const visible = others.slice(0, MAX_VISIBLE);
  const overflow = others.length - visible.length;

  return (
    <AvatarGroup
      // The row names itself with the people in it, so a screen reader gets the
      // roster without this component owning a translated label.
      role="group"
      aria-label={others.map((entry) => entry.user.name).join(', ')}
      className="hidden md:flex"
      data-testid="presence-avatars"
    >
      {visible.map((entry) => (
        <PresenceFace key={entry.user.id} entry={entry} taskKey={taskKeyOf(queryClient, entry)} />
      ))}

      {overflow > 0 ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <AvatarGroupCount aria-hidden>
              {/*
                A bare `+n`. Western digits regardless of locale, which is the
                project's stated numeral policy — and `dir="ltr"` so the sign
                stays on the left of the digit inside an RTL topbar.
              */}
              <span dir="ltr">+{overflow}</span>
            </AvatarGroupCount>
          </TooltipTrigger>
          <TooltipContent side="bottom">
            <ul className="space-y-0.5">
              {others.slice(MAX_VISIBLE).map((entry) => (
                <li key={entry.user.id}>{entry.user.name}</li>
              ))}
            </ul>
          </TooltipContent>
        </Tooltip>
      ) : null}
    </AvatarGroup>
  );
}

/** One person: their avatar, a dot when they are inside a task, their name. */
function PresenceFace({ entry, taskKey }: { entry: PresenceEntry; taskKey: string | null }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="relative inline-flex">
          <UserAvatar user={entry.user} size="sm" label="" />
          {entry.taskId === null ? null : (
            // The presence dot: "reading something specific", said without a
            // word. `AvatarBadge` pins it to the reading-END corner in both
            // directions, and its ring is what keeps it legible against the
            // overlap of the next avatar.
            <AvatarBadge className="bg-success" aria-hidden />
          )}
        </span>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        <span className="font-medium">{entry.user.name}</span>
        {taskKey === null ? null : (
          // A task key is a Latin identifier (`FLOW-12`) even on an Arabic page.
          <span className="ms-1.5 text-muted-foreground" dir="ltr">
            {taskKey}
          </span>
        )}
      </TooltipContent>
    </Tooltip>
  );
}

/**
 * The human key of the task someone is reading, if this tab happens to have it
 * cached.
 *
 * Read straight out of the query cache and NOT subscribed to: presence
 * re-renders whenever the roster changes, which is the only time this can
 * change meaningfully, and turning it into a `useQuery` per avatar would fire
 * up to five requests every time somebody clicked a card. `null` — the task is
 * not in this tab's cache — simply renders the name alone, which is what the
 * component would have shown anyway.
 */
function taskKeyOf(
  queryClient: ReturnType<typeof useQueryClient>,
  entry: PresenceEntry,
): string | null {
  if (entry.taskId === null) return null;
  const cached = queryClient.getQueryData<Task>(qk.task.detail(entry.taskId));
  return cached?.key ?? null;
}

export default PresenceAvatars;
