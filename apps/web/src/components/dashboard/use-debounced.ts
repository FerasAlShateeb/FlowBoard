import { useEffect, useRef } from 'react';

/**
 * Runs `fn(value)` once `value` has been STABLE for `delay` ms.
 *
 * The dashboard's text facet is the only caller today: it holds a draft in
 * local state so typing is instant, and lets this hook push the settled string
 * out to the store — which is what turns one request per keystroke into one
 * request per pause, and (with `useGridUrlState`'s replace-vs-push rule) one
 * history entry per search rather than one per letter.
 *
 * TWO THINGS THAT ARE NOT INCIDENTAL:
 *
 *  - **The mount pass is skipped.** Without the guard, mounting a facet whose
 *    value came from the URL would fire `onChange` with the value it was just
 *    handed, i.e. a request nobody asked for and, worse, a write back over the
 *    URL that produced it.
 *  - **`fn` lives in a ref, not in the dependency array.** Call sites build the
 *    callback inline (it closes over store actions and `t`), so it has a new
 *    identity every render; depending on it would restart the timer on every
 *    keystroke's re-render and the debounce would never elapse.
 */
export function useDebounced<T>(value: T, fn: (value: T) => void, delay = 300): void {
  const mounted = useRef(false);
  const fnRef = useRef(fn);
  fnRef.current = fn;

  useEffect(() => {
    if (!mounted.current) {
      mounted.current = true;
      return;
    }

    const timer = setTimeout(() => {
      fnRef.current(value);
    }, delay);

    return () => {
      clearTimeout(timer);
    };
  }, [value, delay]);
}
