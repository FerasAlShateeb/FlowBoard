import js from '@eslint/js';
import prettierCompat from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';
import tseslint from 'typescript-eslint';

/**
 * Globals that must never appear in `packages/shared`.
 *
 * The shared package is the contract layer: it is imported by the browser
 * bundle AND by the Node API process. Reaching for `window` or `process` there
 * produces code that crashes in exactly one of the two runtimes, which is the
 * kind of bug that only shows up in production.
 */
const restrictedSharedGlobals = [
  { name: 'window', message: 'packages/shared is runtime-neutral: no browser globals (window).' },
  {
    name: 'document',
    message: 'packages/shared is runtime-neutral: no browser globals (document).',
  },
  {
    name: 'navigator',
    message: 'packages/shared is runtime-neutral: no browser globals (navigator).',
  },
  {
    name: 'localStorage',
    message: 'packages/shared is runtime-neutral: no browser globals (localStorage).',
  },
  { name: 'process', message: 'packages/shared is runtime-neutral: no Node globals (process).' },
  { name: 'require', message: 'packages/shared is runtime-neutral: no Node globals (require).' },
  {
    name: '__dirname',
    message: 'packages/shared is runtime-neutral: no Node globals (__dirname).',
  },
];

/**
 * Spread this into `packages/shared`'s flat config to forbid browser/Node
 * globals.
 *
 * @example
 *   import base, { sharedPackageConfig } from '@flowboard/config/eslint';
 *   export default [...base, { ...sharedPackageConfig, files: ['src/**\/*.ts'] }];
 */
export const sharedPackageConfig = {
  name: 'flowboard/shared-runtime-neutral',
  rules: {
    'no-restricted-globals': ['error', ...restrictedSharedGlobals],
  },
};

/**
 * The React-hooks rules, for `apps/web` to spread over its `.tsx` sources.
 *
 * NOT in the base config: `apps/api`, `packages/shared` and `e2e` contain no
 * components, and loading a React plugin for them would cost lint time to
 * enforce nothing.
 *
 * **`rules-of-hooks` is an ERROR** because a violation is not a style opinion —
 * a hook called conditionally, in a loop, or from a plain function corrupts the
 * hook order React relies on, and the failure is a stale value or a crash three
 * renders later rather than at the call site.
 *
 * **`exhaustive-deps` is a WARNING**, deliberately. It is a very good heuristic
 * and not a proof: a stable ref from `useRef`, a Zustand selector, a query
 * client — all are legitimately omitted, and the plugin cannot know. As an error
 * it would push people toward silencing it with a blanket disable, which turns
 * off the useful 95% along with the noisy 5%. Read every warning; suppress the
 * individual line with a comment SAYING WHY when the dependency is genuinely
 * stable.
 *
 * Flat-config note: `eslint-plugin-react-hooks` v7 ships flat presets under
 * `.configs`, but they also enable the compiler-lint rule set. Naming the two
 * rules explicitly keeps this config's promise narrow and its upgrades boring.
 */
export const reactHooksConfig = {
  name: 'flowboard/react-hooks',
  plugins: { 'react-hooks': reactHooks },
  rules: {
    'react-hooks/rules-of-hooks': 'error',
    'react-hooks/exhaustive-deps': 'warn',
  },
};

/**
 * Base flat config for every FlowBoard workspace: JS recommended +
 * typescript-eslint recommended, ES2022 module source, plus the two rules the
 * project treats as hard gates.
 *
 * NOTE ON `recommended` vs `recommended-type-checked`: the base is deliberately
 * the type-UNAWARE `recommended` set. Type-aware linting needs a
 * `projectService`, which then errors on every file outside a tsconfig
 * `include` (vite.config.ts, playwright.config.ts, eslint.config.mjs itself)
 * and roughly triples lint time. `tsc --noEmit` already runs as its own turbo
 * task and catches the type errors, so the extra cost buys little.
 *
 * OPEN QUESTION (deliberate, not an oversight): `apps/api/src/services/**` is
 * the one tree where `recommended-type-checked` would pay for itself, because
 * `no-floating-promises` is exactly the rule that catches a fire-and-forget
 * `record()` or `publishDomainEvent()` that was meant to be awaited. Opting in
 * just that glob needs a scoped `projectService`, and nobody has yet measured
 * whether the lint-time cost is worth it. Documented in
 * `.agents/docs/coding-standards.md`; revisit with a measurement, not a hunch.
 *
 * Consumers spread this and append their own environment-specific blocks.
 */
export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/build/**',
      '**/node_modules/**',
      '**/.turbo/**',
      '**/coverage/**',
      '**/playwright-report/**',
      '**/test-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    name: 'flowboard/base',
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.es2022,
      },
    },
    rules: {
      // HARD GATE. `any` disables the type system exactly where a bug is
      // cheapest to catch. Use `unknown` + a zod parse at boundaries, or a real
      // generic. There is no approved escape hatch — if you think you need one,
      // the contract in `@flowboard/shared` is wrong.
      '@typescript-eslint/no-explicit-any': 'error',

      // Unused vars are errors, but a leading underscore is the documented
      // opt-out for genuinely unused Express `_req`/`_next` positions.
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],

      // HARD GATE. All server logging goes through pino (so it reaches the
      // diagnostics ring buffer); all client feedback goes through sonner or
      // the logger. A stray `console.log` is either a leaked debug statement or
      // a log line the drawer will never show.
      //
      // The two legitimate exceptions — a process startup banner before the
      // logger exists, and CLI scripts (`db:migrate`, `db:seed`) whose whole
      // job is stdout — opt out per line with an explanatory disable:
      //   // eslint-disable-next-line no-console -- CLI output, no logger here.
      'no-console': 'error',
    },
  },
  // Prettier owns formatting. This must stay LAST so it can switch off every
  // stylistic rule the sets above turn on.
  prettierCompat,
);
