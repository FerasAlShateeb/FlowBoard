/**
 * Activity writer — the ONLY way a row enters the `activity` audit stream.
 *
 * Services record activity inside the same transaction as the mutation it
 * describes (pass the `Tx`), so history can never disagree with state. Reads
 * of the stream (task history panel, project feed, CFD report) live in their
 * own feature services — this module only writes.
 */
import type { ActivityAction } from '@flowboard/shared';

import { activity, db, type Db, type Tx } from '../db';

export interface ActivityEntry {
  projectId: string;
  /** Omit for project-level events (sprint started, workflow edited). */
  taskId?: string | null;
  /** Omit for system-generated entries. */
  actorId?: string | null;
  action: ActivityAction;
  /** For `*.field_changed`: which field moved. */
  field?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
}

/** Record one audit entry. Pass the surrounding `Tx` from the mutating service. */
export async function recordActivity(entry: ActivityEntry, executor: Db | Tx = db): Promise<void> {
  await recordActivities([entry], executor);
}

/** Record several audit entries in one INSERT (a multi-field PATCH writes one row per field). */
export async function recordActivities(
  entries: readonly ActivityEntry[],
  executor: Db | Tx = db,
): Promise<void> {
  if (entries.length === 0) return;
  await executor.insert(activity).values(
    entries.map((entry) => ({
      projectId: entry.projectId,
      taskId: entry.taskId ?? null,
      actorId: entry.actorId ?? null,
      action: entry.action,
      field: entry.field ?? null,
      oldValue: entry.oldValue ?? null,
      newValue: entry.newValue ?? null,
    })),
  );
}
