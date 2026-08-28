import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import type { Sprint, SprintState } from '@flowboard/shared';

import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

import { orderSprintsForPicker } from './sprint-default';

/**
 * The sprint the burndown and burnup are drawn for.
 *
 * PRESENTATIONAL ON PURPOSE — it takes the list, it does not fetch it. The
 * dashboard already holds `useSprints` (it needs the list to compute the
 * DEFAULT selection before the first render), and a second query inside the
 * picker would either duplicate that or, worse, make the default depend on
 * which of the two resolved first.
 *
 * OPTION ORDER is `orderSprintsForPicker`'s: active, then completed
 * newest-first, then planned — the same priority the default follows, so the
 * pre-selected entry is nearly always the first one the list opens on.
 *
 * The state badge is not decoration: "Sprint 7" tells you nothing about whether
 * you are looking at a burndown in progress or a post-mortem.
 */
export function SprintPicker({
  sprints,
  value,
  onChange,
  isPending = false,
}: {
  sprints: readonly Sprint[] | undefined;
  /** The selected sprint id, or `null` while none is chosen. */
  value: string | null;
  onChange: (sprintId: string) => void;
  isPending?: boolean;
}) {
  const { t } = useTranslation(['reports']);
  const ordered = useMemo(() => orderSprintsForPicker(sprints ?? []), [sprints]);

  /**
   * A switch rather than `t(\`…sprintState.${state}\`)`: `i18n/i18next.d.ts`
   * types `t()` against the English catalog, and a template-literal key defeats
   * that check — the one thing the typed-key setup exists to prevent.
   */
  const stateLabel = (state: SprintState): string => {
    switch (state) {
      case 'active':
        return t('reports:toolbar.sprintState.active');
      case 'completed':
        return t('reports:toolbar.sprintState.completed');
      default:
        return t('reports:toolbar.sprintState.planned');
    }
  };

  if (isPending) return <Skeleton className="h-8 w-44" aria-hidden />;

  if (ordered.length === 0) {
    return (
      <span className="text-xs text-muted-foreground">{t('reports:toolbar.sprintEmpty')}</span>
    );
  }

  return (
    <Select value={value ?? undefined} onValueChange={onChange}>
      <SelectTrigger
        size="sm"
        className="w-44"
        aria-label={t('reports:toolbar.sprintLabel')}
        data-testid="sprint-picker"
      >
        <SelectValue placeholder={t('reports:toolbar.sprintPlaceholder')} />
      </SelectTrigger>
      <SelectContent>
        {ordered.map((sprint) => (
          <SelectItem key={sprint.id} value={sprint.id}>
            <span className="truncate">{sprint.name}</span>
            <Badge variant="outline" className="ms-auto shrink-0">
              {stateLabel(sprint.state)}
            </Badge>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default SprintPicker;
