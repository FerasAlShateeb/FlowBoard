// Flat ESLint config for @flowboard/shared — the runtime-neutral contract layer.
// Extends the shared base and adds `sharedPackageConfig`, which forbids browser
// AND Node globals so this package imports cleanly in both the Vite bundle and
// the Node API process.
import base, { sharedPackageConfig } from '@flowboard/config/eslint';

export default [...base, { ...sharedPackageConfig, files: ['src/**/*.ts'] }];
