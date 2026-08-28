/**
 * Shared Prettier config for the FlowBoard monorepo.
 *
 * Consumed via `@flowboard/config/prettier`. Keep this the only place
 * formatting is decided — ESLint defers to Prettier (`eslint-config-prettier`
 * is spread last in the base flat config).
 *
 * @type {import('prettier').Config}
 */
export default {
  singleQuote: true,
  semi: true,
  printWidth: 100,
  trailingComma: 'all',
  // LF everywhere, matching `.gitattributes`. Without this Prettier follows the
  // platform and rewrites whole files to CRLF on Windows.
  endOfLine: 'lf',
};
