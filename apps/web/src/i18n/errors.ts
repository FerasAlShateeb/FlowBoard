import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { ApiError, NETWORK_ERROR_CODE } from '@/lib/api';
import type enErrors from '@/locales/en/errors';

/**
 * Envelope `error.code` → localized copy — the twin of `i18n/validation.ts`,
 * one level up.
 *
 * ── The split ───────────────────────────────────────────────────────────────
 * `i18n/validation.ts` localizes FIELD errors: a zod message that a shared
 * schema attached, rendered under an input by `FormMessage`. This module
 * localizes REQUEST errors: the `{ code, message }` an API failure carries, and
 * which almost always ends up in a toast.
 *
 * ── Why code, not message ───────────────────────────────────────────────────
 * `error.code` is stable machine surface (`WIP_LIMIT_EXCEEDED`); `error.message`
 * is English prose written for a log line. Branching on the code and rendering
 * OUR string is the only thing that keeps a server sentence off an Arabic
 * screen. Codes are looked up lower-cased, because the API spells them
 * SCREAMING_SNAKE and the catalog spells them snake_case — one normalization
 * here rather than a convention every call site has to remember.
 *
 * ── Why the fallback is the server message ──────────────────────────────────
 * An unmapped code is a real possibility across five waves of parallel work, and
 * a toast reading "Something went wrong" for a failure the server explained
 * precisely is worse than a sentence in the wrong language. So the ladder is:
 * catalog entry → server message → generic. The catalog is expected to grow;
 * the fallback is what stops a gap becoming a dead end.
 */

/** A key of the `errors` namespace, derived from the English catalog. */
export type ErrorKey = keyof typeof enErrors;

/** Minimal `t` shape — accepts i18next's `TFunction` without importing it. */
type Translate = (key: string) => string;

/**
 * The generic last resort, used when the error is not an {@link ApiError} at all
 * (a thrown `TypeError` from a bad render, say) or carries no message.
 */
const FALLBACK_KEY = 'errors:unknown';

/**
 * The code the HTTP client uses when `fetch` itself rejected. Mapped explicitly
 * because "could not reach the server" is advice, not an error report.
 */
const NETWORK_KEY = `errors:${NETWORK_ERROR_CODE}`;

/**
 * Localizes one failure into a sentence fit for a toast.
 *
 * @param t   an i18next `t` bound to (at least) the `errors` namespace
 * @param error whatever landed in a `catch` / `onError`
 */
export function apiErrorMessage(t: Translate, error: unknown): string {
  if (!(error instanceof ApiError)) {
    // A non-ApiError reaching a mutation handler is a bug in OUR code, not a
    // rejected request. Say something honest and generic rather than leaking a
    // stack-shaped `Error.message`.
    return t(FALLBACK_KEY);
  }

  if (error.code === NETWORK_ERROR_CODE) return t(NETWORK_KEY);

  const key = `errors:${error.code.toLowerCase()}`;
  const translated = t(key);
  // i18next returns the KEY itself when nothing matched (`returnNull: false`,
  // no `parseMissingKeyHandler`), which is how a miss is detected without
  // reaching for `i18n.exists()` and a second instance reference.
  if (translated !== key) return translated;

  return error.message || t(FALLBACK_KEY);
}

/**
 * The hook form: returns a stable `(error) => string`.
 *
 * @example
 *   const describe = useApiErrorMessage();
 *   onError: (error) => { setBanner(describe(error)); }
 */
export function useApiErrorMessage(): (error: unknown) => string {
  const { t } = useTranslation(['errors']);
  return useCallback((error: unknown) => apiErrorMessage(t as Translate, error), [t]);
}

/**
 * The one every mutation uses: a stable `onError` handler that raises a
 * localized destructive toast.
 *
 * Project checklist §B — "toast on every mutation failure" — is satisfied by
 * passing this straight through:
 *
 * @example
 *   const onError = useApiErrorToast();
 *   useMutation({ mutationFn, onError });
 */
export function useApiErrorToast(): (error: unknown) => void {
  const describe = useApiErrorMessage();
  return useCallback(
    (error: unknown) => {
      toast.error(describe(error));
    },
    [describe],
  );
}
