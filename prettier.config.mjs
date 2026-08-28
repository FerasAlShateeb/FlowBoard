/**
 * Root Prettier config — re-exports the shared one from `@flowboard/config` so
 * that editors (which look for a config at the repo root) and the `pnpm format`
 * scripts use exactly the same settings as every workspace.
 *
 * Edit `packages/config/prettier.config.mjs`, never this file.
 */
export { default } from '@flowboard/config/prettier';
