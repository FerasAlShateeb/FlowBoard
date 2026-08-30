/**
 * Schema barrel.
 *
 * `drizzle(client, { schema })` is fed the whole namespace import of this file,
 * so a table that is not re-exported here is invisible to the query builder's
 * relational API. Add every new table.
 */
export * from './enums';
export * from './users';
export * from './orgs';
// Deployment-level configuration. AFTER `./orgs` because `default_org_id`
// references `organizations` — the reference itself is a lazy `() =>` thunk, but
// keeping the declaration order honest costs nothing and reads correctly.
export * from './instance-settings';
export * from './teams';
export * from './projects';
export * from './workflow';
export * from './sprints';
export * from './tasks';
export * from './comments';
export * from './activity';
export * from './notifications';
export * from './telemetry';
