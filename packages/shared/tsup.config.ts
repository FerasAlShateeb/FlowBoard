import { defineConfig } from 'tsup';

/**
 * Dual ESM + CJS build for the contract layer.
 *
 * `apps/web` (Vite/ESM) takes `dist/index.js`; `apps/api` (CommonJS) takes
 * `dist/index.cjs`. Both read the same `dist/index.d.ts`.
 *
 * `noExternal: ['fractional-indexing']` is the load-bearing line. That package
 * is ESM-ONLY (`"type": "module"`, no CJS entry), so leaving it external would
 * emit a bare `require('fractional-indexing')` into `index.cjs` that throws
 * ERR_REQUIRE_ESM the moment the API imports the rank wrappers. Bundling it in
 * costs ~2 KB and makes the CJS output self-contained. `zod` stays external: it
 * ships both formats and is a direct dependency of every consumer, so bundling
 * it would ship two copies and break `instanceof ZodError`.
 */
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: true,
  target: 'es2022',
  noExternal: ['fractional-indexing'],
});
