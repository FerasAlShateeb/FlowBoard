/**
 * Cross-project task search — the command palette's backing endpoint.
 *
 * TWO WAYS PEOPLE SEARCH, and the ordering exists because they are different
 * intents:
 *   - they PASTE A KEY (`FLOW-123`) and want that exact row, first, always;
 *   - they TYPE WORDS and want the closest titles.
 * So an exact key match sorts ahead of everything, and the rest is ranked by
 * `pg_trgm` similarity (the `tasks_title_trgm_idx` GIN index) rather than by a
 * bare `ILIKE`, which cannot rank at all.
 *
 * VISIBILITY IS RESOLVED IN THE QUERY, not filtered afterwards: a global or org
 * admin sees every project in the org, everybody else only the projects they
 * hold a `project_members` row for. Searching is the one place where "which
 * projects exist" would otherwise leak.
 */
import { and, asc, desc, eq, exists, ilike, isNull, or, sql, type SQL } from 'drizzle-orm';
import type { SearchResponse, SearchResult } from '@flowboard/shared';

import { db, projectMembers, projects, tasks } from '../db';
import { record } from './telemetry.service';

/** Trigram floor. Low enough for a two-word typo, high enough to exclude noise. */
const SIMILARITY_THRESHOLD = 0.15;

/** Who is searching, and how much of the org they can see. */
export interface SearchScope {
  orgId: string;
  userId: string;
  /** True for a global admin or an org admin — both see every project. */
  seesWholeOrg: boolean;
}

const KEY_PATTERN = /^([A-Za-z][A-Za-z0-9]{1,9})-(\d+)$/u;
const DIGITS_PATTERN = /^\d+$/u;

/** `GET /orgs/:orgId/search?q=&limit=`. */
export async function searchTasks(
  scope: SearchScope,
  query: string,
  limit: number,
): Promise<SearchResponse> {
  // `limit` arrives already bounded by the shared `searchQuerySchema`
  // (1…MAX_SEARCH_RESULTS). This used to clamp a wider value silently, which
  // reads to a caller as the org having fewer matches than it does; the ceiling
  // now lives in the contract and an over-large request is a 422.
  const keyMatch = KEY_PATTERN.exec(query);
  const keyPart = keyMatch?.[1]?.toUpperCase();
  const numberPart = keyMatch?.[2];

  const exactKey: SQL | undefined =
    keyPart === undefined || numberPart === undefined
      ? undefined
      : (and(eq(projects.key, keyPart), eq(tasks.number, Number(numberPart))) as SQL);

  // `0` for the row the caller literally typed, `1` for everything else — the
  // primary sort key, so a pasted key can never be outranked by a fuzzy title.
  const keyRank =
    exactKey === undefined ? sql<number>`1` : sql<number>`CASE WHEN ${exactKey} THEN 0 ELSE 1 END`;
  const similarity = sql<number>`similarity(${tasks.title}, ${query})`;

  const matches: (SQL | undefined)[] = [
    exactKey,
    ilike(tasks.title, `%${query}%`),
    sql`similarity(${tasks.title}, ${query}) > ${SIMILARITY_THRESHOLD}`,
    DIGITS_PATTERN.test(query) ? sql`${tasks.number}::text LIKE ${`${query}%`}` : undefined,
  ];
  const matchCondition = or(...matches.filter((entry): entry is SQL => entry !== undefined));

  const visibility: SQL | undefined = scope.seesWholeOrg
    ? undefined
    : exists(
        db
          .select({ one: sql`1` })
          .from(projectMembers)
          .where(
            and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, scope.userId)),
          ),
      );

  const rows = await db
    .select({
      taskId: tasks.id,
      number: tasks.number,
      title: tasks.title,
      type: tasks.type,
      statusId: tasks.statusId,
      projectId: projects.id,
      projectKey: projects.key,
      projectName: projects.name,
    })
    .from(tasks)
    .innerJoin(projects, eq(tasks.projectId, projects.id))
    .where(
      and(
        eq(projects.orgId, scope.orgId),
        isNull(projects.deletedAt),
        isNull(tasks.deletedAt),
        visibility,
        matchCondition,
      ),
    )
    .orderBy(asc(keyRank), desc(similarity), desc(tasks.number))
    .limit(limit);

  const results: SearchResult[] = rows.map((row) => ({
    taskId: row.taskId,
    key: `${row.projectKey}-${String(row.number)}`,
    title: row.title,
    type: row.type,
    statusId: row.statusId,
    projectId: row.projectId,
    projectKey: row.projectKey,
    projectName: row.projectName,
  }));

  record(
    'search_performed',
    { query, resultCount: results.length },
    {
      userId: scope.userId,
      orgId: scope.orgId,
    },
  );

  return { results };
}
