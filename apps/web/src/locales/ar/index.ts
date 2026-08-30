/**
 * The Arabic catalog — the exact same namespace list as `locales/en/index.ts`.
 *
 * Loaded LAZILY: `src/i18n/index.ts` `import()`s this module only when the
 * language is (or becomes) `ar`, and registers each namespace with
 * `addResourceBundle` BEFORE `changeLanguage`. Nothing here is typed against —
 * English owns the key shape (`i18n/i18next.d.ts`), and any key Arabic is
 * missing simply falls back to it.
 *
 * This dynamic import is also why the whole Arabic tree ends up in its own
 * Rollup chunk: an English-only session never downloads a byte of it.
 *
 * ── ROUND 2 FREEZE ──────────────────────────────────────────────────────────
 * This aggregator and its twin are STITCH FILES. W1.0 registered every
 * namespace Round 2 needs — `analytics`, new and still a title-only stub — and
 * W3.1 is the only package allowed to edit them again. W2.1 (`admin`), W2.2
 * (`analytics`), W2.3 (`theme`) and W1.3 (`common`) each fill in THEIR OWN
 * namespace file; none of them adds, moves or renames a line here.
 */
import admin from './admin';
import analytics from './analytics';
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
  // Round 2 — the admin analytics console (W2.2 fills this namespace).
  analytics,
} as const;
