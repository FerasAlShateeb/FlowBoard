/**
 * Types `t()` against the ENGLISH catalog.
 *
 * With `resources: typeof en` declared here, `t('common:actions.save')` is
 * checked at compile time and `t('common:actions.saev')` is a build error —
 * which is the whole reason the catalogs are TypeScript modules rather than
 * JSON. English is the shape authority precisely because it is the
 * `fallbackLng`: a key Arabic has not translated yet still resolves, so Arabic
 * must never be allowed to introduce a key English does not have.
 *
 * Ambient module augmentation only — nothing is emitted, and this file must not
 * import anything at runtime.
 */
import type en from '@/locales/en';

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'common';
    resources: typeof en;
    returnNull: false;
  }
}
