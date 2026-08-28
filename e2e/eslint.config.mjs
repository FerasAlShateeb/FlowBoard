// Flat ESLint config for @flowboard/e2e (Playwright, Node runtime).
import globals from 'globals';
import base from '@flowboard/config/eslint';

export default [
  ...base,
  {
    files: ['**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
];
