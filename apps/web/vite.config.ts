import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * VENDOR CHUNKING — why this exists.
 *
 * Every page is `React.lazy`, so a deploy that lands under an open tab breaks
 * it: the tab asks for a hashed chunk from the PREVIOUS build, nginx's SPA
 * catch-all answers with index.html at 200, and the dynamic import blows up.
 * (`lib/chunk-recovery` catches and reloads; this config reduces how often that
 * is needed.) Left to itself Rollup smears library code across the page chunks,
 * so touching one page changes the hash of several files.
 *
 * Pinning the big, version-stable dependencies into NAMED vendor chunks means
 * their content — and therefore their hash — changes only when the dependency
 * itself changes. A normal app deploy leaves them byte-identical, so an open
 * tab's cached copies stay valid and the browser refetches only the page chunks
 * that actually changed.
 *
 * Each group is a genuine "large + rarely changes" cluster:
 *   vendor-react    — react / react-dom / scheduler / react-router: the runtime
 *                     itself, on literally every page, upgraded a few times a
 *                     year.
 *   vendor-radix    — the whole primitive layer behind `components/ui/*`
 *                     (dialog, popover, select, tooltip …), shared by nearly
 *                     every page.
 *   vendor-charts   — recharts and its d3 subtree: the single heaviest
 *                     dependency, and used ONLY by the reports dashboard and
 *                     the telemetry admin pages.
 *   vendor-motion   — motion.dev (+ its motion-dom/motion-utils runtime).
 *   vendor-datagrid — @tanstack/react-table + @tanstack/react-virtual +
 *                     @dnd-kit: the engines behind the board's drag and the
 *                     table view's virtualised grid.
 *   vendor-i18n     — i18next + react-i18next, THE LIBRARY ONLY. The
 *                     translation CATALOGS live in `src/` and are deliberately
 *                     NOT here: they are app content and change with the app
 *                     (and the Arabic one is its own lazy chunk by design).
 *
 * Anything else returns undefined and keeps Rollup's automatic per-route
 * splitting, which is what keeps the lazy page boundaries meaningful.
 */
const VENDOR_BY_PACKAGE: Record<string, string> = {
  react: 'vendor-react',
  'react-dom': 'vendor-react',
  scheduler: 'vendor-react',
  'react-router': 'vendor-react',
  'react-router-dom': 'vendor-react',
  'radix-ui': 'vendor-radix',
  recharts: 'vendor-charts',
  'victory-vendor': 'vendor-charts',
  internmap: 'vendor-charts',
  delaunator: 'vendor-charts',
  'robust-predicates': 'vendor-charts',
  motion: 'vendor-motion',
  'motion-dom': 'vendor-motion',
  'motion-utils': 'vendor-motion',
  i18next: 'vendor-i18n',
  'react-i18next': 'vendor-i18n',
};

/** Scope/prefix rules, for families too large to enumerate package by package. */
const VENDOR_BY_PREFIX: ReadonlyArray<readonly [string, string]> = [
  ['@radix-ui/', 'vendor-radix'],
  ['d3-', 'vendor-charts'],
  ['@tanstack/react-table', 'vendor-datagrid'],
  ['@tanstack/react-virtual', 'vendor-datagrid'],
  ['@tanstack/virtual-core', 'vendor-datagrid'],
  ['@dnd-kit/', 'vendor-datagrid'],
];

/**
 * Package name for a module id, or undefined for first-party/virtual modules.
 *
 * Keyed on the LAST `/node_modules/` segment, which is the one rule that reads
 * both layouts correctly: pnpm's store path
 * `…/node_modules/.pnpm/react-dom@19.2.0_react@19.2.0/node_modules/react-dom/…`
 * and the plain hoisted `…/node_modules/react-dom/…` both end in the real
 * package directory. Anchoring on the FIRST occurrence would return `.pnpm` for
 * every dependency in this workspace.
 */
function packageOf(id: string): string | undefined {
  const path = id.replace(/\\/g, '/');
  const marker = '/node_modules/';
  const at = path.lastIndexOf(marker);
  if (at === -1) return undefined;
  const [scopeOrName, second] = path.slice(at + marker.length).split('/');
  if (!scopeOrName) return undefined;
  return scopeOrName.startsWith('@') ? `${scopeOrName}/${second ?? ''}` : scopeOrName;
}

/** Rollup `manualChunks`: name the vendor groups, auto-split everything else. */
function manualChunks(id: string): string | undefined {
  const pkg = packageOf(id);
  if (!pkg) return undefined;
  const exact = VENDOR_BY_PACKAGE[pkg];
  if (exact) return exact;
  for (const [prefix, chunk] of VENDOR_BY_PREFIX) {
    if (pkg.startsWith(prefix)) return chunk;
  }
  return undefined;
}

export default defineConfig(({ mode }) => {
  /**
   * PIN NODE_ENV BEFORE VITE READS THE ROOT `.env`. This is not a nicety — it
   * fixes a real production bug.
   *
   * `envDir` below points at the monorepo root so the documented `.env` supplies
   * the VITE_* vars. But that file also carries `NODE_ENV=development` for the
   * API process, and Vite's env loader special-cases `NODE_ENV` regardless of
   * prefix: it copies the value into `process.env.VITE_USER_NODE_ENV`, and that
   * then wins over the build's own default. The observable damage in the
   * production bundle: `import.meta.env.DEV` is `true`, JSX compiles to the
   * development `jsxDEV` runtime, React resolves to its development build, and
   * every `if (import.meta.env.DEV)` branch — including the query devtools in
   * `AppProviders` — ships to users.
   *
   * The loader only writes `VITE_USER_NODE_ENV` when it is still undefined, and
   * this config function runs BEFORE that load (Vite has to call it to learn
   * `envDir`). Setting it here therefore pre-empts the file. `??=` keeps an
   * explicitly exported shell `NODE_ENV` authoritative, and keying on `mode`
   * means `vite build --mode development` still behaves as asked.
   *
   * EXPECTED SIDE EFFECT — DO NOT "FIX" IT. A production build prints:
   *
   *   NODE_ENV=production is not supported in the .env file. …
   *
   * Vite warns whenever `VITE_USER_NODE_ENV` is set to anything but
   * `development`; it cannot tell that this one came from the config rather than
   * from a file. The only way to silence it is to leave the variable unset — at
   * which point the loader fills it from the root `.env`'s `NODE_ENV=development`
   * and ships a development bundle to production, which is the bug above. The
   * warning is the cheap half of that trade. The build itself is unaffected:
   * Vite has already set `process.env.NODE_ENV=production` by the time this
   * function runs, and that is what `isProduction` is computed from.
   */
  process.env.VITE_USER_NODE_ENV ??= mode === 'production' ? 'production' : 'development';

  return {
    plugins: [
      react(),
      // Tailwind v4 is CSS-first: there is no `tailwind.config.js`. Tokens and
      // theme live in `src/index.css`. Never run the shadcn CLI against this.
      tailwindcss(),
    ],

    build: {
      rollupOptions: {
        output: { manualChunks },
      },
    },

    // Read the documented root `.env` (only VITE_* reaches the client bundle).
    envDir: fileURLToPath(new URL('../../', import.meta.url)),

    resolve: {
      alias: {
        // Path alias `@/*` → `src/*`; mirrors tsconfig `paths`.
        '@': fileURLToPath(new URL('./src', import.meta.url)),
      },
    },

    server: {
      port: 5173,
      // Proxy so the browser only ever talks to one origin in dev — which keeps
      // cookies, CORS, and the Socket.IO upgrade behaving like production.
      proxy: {
        '/api': {
          target: 'http://localhost:4000',
          changeOrigin: true,
        },
        // `ws: true` is what upgrades the Socket.IO websocket connection
        // instead of leaving it stuck on long-polling.
        '/socket.io': {
          target: 'http://localhost:4000',
          changeOrigin: true,
          ws: true,
        },
      },
    },
  };
});
