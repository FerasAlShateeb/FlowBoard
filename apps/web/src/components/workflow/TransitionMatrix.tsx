import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';
import type { Status, Transition, TransitionEdge } from '@flowboard/shared';

import { cn } from '@/lib/utils';
import { useReplaceTransitions } from '@/hooks/useWorkflow';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Switch } from '@/components/ui/switch';

/**
 * The from-status × to-status transition editor.
 *
 * ═══ THE MODEL, AND WHY IT NEEDS AN EXPLICIT TOGGLE ════════════════════════
 *
 * The wire format is a flat list of allowed edges, evaluated PER SOURCE STATUS
 * (`workflow.schema.ts`):
 *
 *   - **zero rows FROM a status → every move out of it is allowed.** This is
 *     what makes a fresh project fully open with no rows at all.
 *   - **one or more rows FROM a status → only those targets are allowed.**
 *
 * That collapses two very different intentions into one representation. "This
 * column is unrestricted" and "this column is restricted to nothing" are both
 * the empty set — and the second is a workflow nobody can escape. A matrix of
 * bare checkboxes cannot express the difference: unticking the last box in a
 * row would silently mean "open it back up", which is the opposite of what the
 * gesture looks like.
 *
 * So each row carries an explicit RESTRICT switch. Off → the row contributes no
 * edges and reads "any status". On → the checkboxes appear, and a row with none
 * ticked is flagged as an error rather than saved as an accidental open row.
 *
 * ═══ WHY IT IS A DRAFT WITH A SAVE BUTTON ══════════════════════════════════
 *
 * Unlike the status rows above — where each field saves itself — transitions
 * are edited as a SET. `PUT /transitions` replaces the whole graph in one
 * transaction, and a per-checkbox PUT would send the entire graph on every
 * click, with a half-applied burst able to leave a status whitelisted to a
 * single unreachable target. One draft, one save.
 */

/** The editor's working state: which rows are restricted, and to what. */
interface DraftRow {
  restricted: boolean;
  /** Target status ids. Meaningful only while `restricted`. */
  targets: Set<string>;
}

type Draft = Map<string, DraftRow>;

/**
 * Builds the editor state from the server's flat edge list.
 *
 * A status is "restricted" exactly when at least one edge starts at it — which
 * is the same rule the server and the board's pre-check apply, expressed once
 * here rather than re-derived per component.
 */
export function toDraft(statuses: readonly Status[], transitions: readonly Transition[]): Draft {
  const draft: Draft = new Map();
  for (const status of statuses) {
    draft.set(status.id, { restricted: false, targets: new Set() });
  }
  for (const transition of transitions) {
    const row = draft.get(transition.fromStatusId);
    // An edge from a status that no longer exists is ignored rather than
    // resurrecting a phantom row: the status list is the authority on what
    // rows exist.
    if (!row) continue;
    row.restricted = true;
    row.targets.add(transition.toStatusId);
  }
  return draft;
}

/**
 * Flattens the editor state back to the wire format.
 *
 * Unrestricted rows contribute nothing — that IS how "no restriction" is
 * spelled — and self-edges are dropped because `transitionEdgeSchema` refuses
 * them (a same-column reorder is not a transition).
 */
export function toEdges(draft: Draft): TransitionEdge[] {
  const edges: TransitionEdge[] = [];
  for (const [fromStatusId, row] of draft) {
    if (!row.restricted) continue;
    for (const toStatusId of row.targets) {
      if (toStatusId === fromStatusId) continue;
      edges.push({ fromStatusId, toStatusId });
    }
  }
  return edges;
}

/** A restricted row with no targets — saveable in the schema, wrong in practice. */
export function emptyRestrictedRows(draft: Draft): string[] {
  const empty: string[] = [];
  for (const [statusId, row] of draft) {
    if (row.restricted && row.targets.size === 0) empty.push(statusId);
  }
  return empty;
}

/** True when the draft differs from what the server holds. */
function isDirty(draft: Draft, statuses: readonly Status[], transitions: readonly Transition[]) {
  const serverEdges = toEdges(toDraft(statuses, transitions));
  const draftEdges = toEdges(draft);
  if (serverEdges.length !== draftEdges.length) return true;

  const key = (edge: TransitionEdge) => `${edge.fromStatusId}>${edge.toStatusId}`;
  const server = new Set(serverEdges.map(key));
  return draftEdges.some((edge) => !server.has(key(edge)));
}

export function TransitionMatrix({
  projectId,
  statuses,
  transitions,
  disabled,
}: {
  projectId: string;
  statuses: Status[];
  transitions: Transition[];
  disabled?: boolean;
}) {
  const { t } = useTranslation(['workflow', 'common']);
  const replaceTransitions = useReplaceTransitions(projectId);

  const [draft, setDraft] = useState<Draft>(() => toDraft(statuses, transitions));

  // Re-seed when the server's copy changes. Keyed on a stable signature of both
  // inputs rather than on the arrays, whose identity churns every render.
  const signature = useMemo(
    () =>
      [
        statuses.map((status) => status.id).join('|'),
        transitions
          .map((edge) => `${edge.fromStatusId}>${edge.toStatusId}`)
          .sort()
          .join('|'),
      ].join('#'),
    [statuses, transitions],
  );
  useEffect(() => {
    setDraft(toDraft(statuses, transitions));
    // `signature` is the memoized VALUE signature of both arrays; depending on the arrays would
    // discard an unsaved matrix edit on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above.
  }, [signature]);

  const dirty = isDirty(draft, statuses, transitions);
  const invalidRows = emptyRestrictedRows(draft);

  /** Immutable update — a mutated Map would never re-render. */
  const updateRow = (statusId: string, change: (row: DraftRow) => DraftRow) => {
    setDraft((current) => {
      const next = new Map(current);
      const row = current.get(statusId) ?? { restricted: false, targets: new Set<string>() };
      next.set(statusId, change({ restricted: row.restricted, targets: new Set(row.targets) }));
      return next;
    });
  };

  const toggleRestrict = (statusId: string, restricted: boolean) => {
    updateRow(statusId, (row) => ({
      restricted,
      // Turning restriction ON pre-selects every other status, which is the
      // state the row was already in semantically (unrestricted = all allowed).
      // Starting from an empty row would mean flipping a switch instantly makes
      // a column a dead end.
      targets: restricted
        ? row.targets.size > 0
          ? row.targets
          : new Set(statuses.filter((s) => s.id !== statusId).map((s) => s.id))
        : row.targets,
    }));
  };

  const toggleTarget = (fromId: string, toId: string, allowed: boolean) => {
    updateRow(fromId, (row) => {
      if (allowed) row.targets.add(toId);
      else row.targets.delete(toId);
      return row;
    });
  };

  const save = () => {
    replaceTransitions.mutate(toEdges(draft), {
      onSuccess: () => {
        toast.success(t('workflow:transitions.saved'));
      },
    });
  };

  if (statuses.length < 2) {
    return <p className="text-xs text-muted-foreground">{t('workflow:transitions.empty')}</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {/* The matrix can outgrow a narrow viewport; it scrolls in its own box so
          the PAGE never scrolls horizontally (checklist §B). */}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[36rem] border-collapse text-xs">
          <caption className="sr-only">{t('workflow:transitions.title')}</caption>
          <thead>
            <tr>
              <th scope="col" className="p-2 text-start font-medium text-muted-foreground">
                {t('workflow:transitions.fromHeader')}
              </th>
              <th scope="col" className="p-2 text-start font-medium text-muted-foreground">
                {t('workflow:transitions.restrict')}
              </th>
              {statuses.map((status) => (
                <th
                  key={status.id}
                  scope="col"
                  className="p-2 text-center font-medium text-muted-foreground"
                >
                  <span className="inline-flex items-center gap-1.5">
                    <span
                      aria-hidden
                      className="size-2 rounded-full"
                      style={{ backgroundColor: status.color }}
                    />
                    <span className="max-w-[7rem] truncate">{status.name}</span>
                  </span>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {statuses.map((from) => {
              const row = draft.get(from.id) ?? { restricted: false, targets: new Set<string>() };
              const invalid = row.restricted && row.targets.size === 0;

              return (
                <tr
                  key={from.id}
                  className={cn('border-t border-border', invalid && 'bg-destructive/5')}
                >
                  <th scope="row" className="p-2 text-start font-medium">
                    <span className="inline-flex items-center gap-1.5">
                      <span
                        aria-hidden
                        className="size-2 rounded-full"
                        style={{ backgroundColor: from.color }}
                      />
                      <span className="max-w-[9rem] truncate">{from.name}</span>
                    </span>
                  </th>

                  <td className="p-2">
                    <Switch
                      checked={row.restricted}
                      disabled={disabled}
                      aria-label={t('workflow:transitions.restrictLabel', { name: from.name })}
                      onCheckedChange={(checked) => {
                        toggleRestrict(from.id, checked);
                      }}
                    />
                  </td>

                  {statuses.map((to) => {
                    const self = to.id === from.id;
                    return (
                      <td key={to.id} className="p-2 text-center">
                        {self ? (
                          // A status can always transition to itself — a
                          // same-column reorder is not a transition — so the
                          // diagonal is not a choice.
                          <span
                            className="text-muted-foreground/50"
                            title={t('workflow:transitions.selfCell')}
                          >
                            —
                          </span>
                        ) : row.restricted ? (
                          <Checkbox
                            checked={row.targets.has(to.id)}
                            disabled={disabled}
                            aria-label={t('workflow:transitions.allow', {
                              from: from.name,
                              to: to.name,
                            })}
                            onCheckedChange={(checked) => {
                              toggleTarget(from.id, to.id, checked === true);
                            }}
                          />
                        ) : (
                          // Unrestricted: every target is reachable, and there
                          // is nothing to tick. A row of checked-and-disabled
                          // boxes would imply they could be unticked.
                          <span
                            className="text-muted-foreground"
                            title={t('workflow:transitions.unrestrictedHint')}
                          >
                            ✓
                          </span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {invalidRows.length > 0 ? (
        <p role="alert" className="text-xs text-destructive">
          {t('workflow:transitions.noTargets')}
        </p>
      ) : null}

      {!disabled ? (
        <div className="flex items-center justify-end gap-2">
          {dirty ? (
            <>
              <span className="me-auto text-xs text-muted-foreground">
                {t('workflow:transitions.unsaved')}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  setDraft(toDraft(statuses, transitions));
                }}
              >
                {t('workflow:transitions.reset')}
              </Button>
            </>
          ) : null}
          <Button
            size="sm"
            disabled={!dirty || invalidRows.length > 0 || replaceTransitions.isPending}
            onClick={save}
          >
            {replaceTransitions.isPending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {t('workflow:transitions.save')}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

export default TransitionMatrix;
