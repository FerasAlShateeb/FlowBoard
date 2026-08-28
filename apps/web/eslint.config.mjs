// Flat ESLint config for @flowboard/web (Vite + React 19, browser runtime).
import globals from 'globals';
import base, { reactHooksConfig } from '@flowboard/config/eslint';

export default [
  ...base,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
  },
  // Hook correctness. `rules-of-hooks` is an error (a mis-ordered hook is a
  // real bug that surfaces renders later); `exhaustive-deps` is a warning (a
  // good heuristic that cannot see a stable ref). See `@flowboard/config`.
  { ...reactHooksConfig, files: ['src/**/*.{ts,tsx}'] },
  // App source ships to a browser: Vite defines no `process`, so a `process.env`
  // read is a runtime crash rather than a type error. Keep Node globals out of
  // anything that actually gets bundled.
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: ['src/**/*.test.{ts,tsx}', 'src/test/**'],
    rules: {
      'no-restricted-globals': [
        'error',
        { name: 'process', message: 'Browser bundle: use `lib/env`, not Node globals.' },
        { name: 'require', message: 'Browser bundle: use ESM imports, not Node globals.' },
        { name: '__dirname', message: 'Browser bundle: no Node globals.' },
      ],
    },
  },
  // Node-context config files (vite.config.ts, vitest configs) legitimately use
  // Node globals and are never bundled.
  {
    files: ['*.{ts,mts,js,mjs}'],
    languageOptions: { globals: { ...globals.node } },
  },
];
