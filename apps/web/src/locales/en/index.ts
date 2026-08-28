/**
 * The English catalog — the app's key SHAPE as well as its default copy.
 *
 * `src/i18n/i18next.d.ts` declares `resources: typeof en`, so this object is
 * what makes `t()` typed: a key not in this tree is a COMPILE ERROR, and a
 * namespace added here is available to `t('<ns>:…')` immediately. That is the
 * whole reason the catalogs are TypeScript modules rather than JSON.
 *
 * English is bundled synchronously (it is the `fallbackLng`); Arabic is a
 * dynamic import, so an English-only session never pays for it.
 *
 * Wave 3 view agents each add their own namespace here (`board`, `backlog`,
 * `roadmap`, `table`, `calendar`, `reports`) — this file and its Arabic twin
 * are stitch files, owned by the wave's integration package.
 */
import admin from './admin';
import auth from './auth';
import backlog from './backlog';
import board from './board';
import calendar from './calendar';
import common from './common';
import diagnostics from './diagnostics';
import errors from './errors';
import notifications from './notifications';
import orgs from './orgs';
import palette from './palette';
import reports from './reports';
import roadmap from './roadmap';
import settings from './settings';
import table from './table';
import tasks from './tasks';
import theme from './theme';
import validation from './validation';
import workflow from './workflow';

export default {
  common,
  auth,
  validation,
  // WP2.4 — the API error vocabulary and the session/org/settings surfaces.
  errors,
  orgs,
  settings,
  workflow,
  // Wave 3 — one namespace per view; each agent owns only its own file.
  board,
  tasks,
  backlog,
  roadmap,
  table,
  calendar,
  reports,
  // Wave 4 — platform features; each agent owns only its own file.
  theme,
  notifications,
  admin,
  diagnostics,
  palette,
} as const;
