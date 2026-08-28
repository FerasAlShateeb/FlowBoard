// Flat ESLint config for @flowboard/api (Node / Express 5 runtime).
import globals from 'globals';
import base from '@flowboard/config/eslint';

export default [
  ...base,
  {
    files: ['src/**/*.ts'],
    languageOptions: { globals: { ...globals.node } },
  },
];
