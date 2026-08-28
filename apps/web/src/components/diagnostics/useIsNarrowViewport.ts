import { useSyncExternalStore } from 'react';

/**
 * Is the viewport below the `md` breakpoint (768px)?
 *
 * The diagnostics drawer is the only caller: below `md` a left/right/top dock
 * has nowhere to go — a 280px-wide side panel on a 360px phone leaves 80px of
 * app — so the drawer forces an EFFECTIVE bottom dock while narrow and leaves
 * the stored preference alone, restoring it the moment the window widens.
 *
 * `useSyncExternalStore` over `matchMedia` rather than a `resize` listener with
 * `useState`: the media query fires once per CROSSING instead of once per
 * pixel of a drag, and the store form has no mount-time gap between reading the
 * value and subscribing to it — which is exactly the gap that renders one frame
 * of a side dock on a phone.
 *
 * Server/jsdom-safe: no `matchMedia` (node, or a test that skipped the stub)
 * answers `false`, i.e. "not narrow", which is the desktop default.
 */
export const NARROW_VIEWPORT_QUERY = '(max-width: 767.98px)';

function subscribe(onChange: () => void): () => void {
  const query = globalThis.matchMedia?.(NARROW_VIEWPORT_QUERY);
  if (!query) return () => undefined;
  query.addEventListener('change', onChange);
  return () => {
    query.removeEventListener('change', onChange);
  };
}

function getSnapshot(): boolean {
  return globalThis.matchMedia?.(NARROW_VIEWPORT_QUERY).matches ?? false;
}

/** Always `false` on the server: there is no viewport to be narrow. */
function getServerSnapshot(): boolean {
  return false;
}

export function useIsNarrowViewport(): boolean {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}
