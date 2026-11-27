/**
 * A first-run preference sheet waits its turn (r109 inventory-5, walk UX P1).
 *
 * One first-run queue: the data terms, then the sheet or drawer the person
 * opened, then theme. The first ground choice is the last in that queue. It
 * opens on its own after a read lands, and a drawer opened by a deep link
 * (`?open=`) can already be on screen by then; the sheet's focus trap would
 * leave the drawer, Cmd-K and J/K dead under it. So a sheet that `wants` to
 * show is shown only once no other overlay is open; from then on it HOLDS its
 * turn (its own entry on the stack, or a drawer opened above it later, never
 * takes it away), until it no longer wants to show.
 *
 * The data-terms gate does NOT use this: the terms go first and are never put
 * behind a drawer (ADR 0207 section 19). A drawer is held for the terms
 * instead (`useDataTermsSignInBusy`). Nothing here accepts, dismisses or skips
 * anything: a sheet that is waiting is still owed, and it shows the moment the
 * drawer closes.
 *
 * A deep link's drawer mounts only after the list read, which can land AFTER
 * the account's ground source is known (walk: YOUR THEME and the drawer on
 * screen together at 1.2 s and 3.7 s, "Not now" dead under the drawer). So a
 * `?open=` present on the page's first paint counts as an overlay that is
 * coming, and the sheet waits for it: until a drawer has been seen (the rule
 * above then holds it until the drawer closes), the param is gone, or
 * DEEP_LINK_GIVES_UP_MS has passed (a link that opens nothing never starves a
 * sheet that is owed).
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { openStackSize, subscribeOpenStack } from './overlayState';

export const DEEP_LINK_GIVES_UP_MS = 10_000;

// `?highlight=` is the older name for the same drawer (iv-url.ts ALIASES): the dashboard's
// low-stock alert and the one-tap action centre still link with it (r110 inventory-1).
const DRAWER_PARAMS = ['open', 'highlight'] as const;
const hasOpenParam = () => {
  if (typeof window === 'undefined') return false;
  const params = new URLSearchParams(window.location.search);
  return DRAWER_PARAMS.some((key) => params.has(key));
};
/** Read once, on the first paint of the first first-run sheet: a later in-app `?open=` is not a link from outside. */
let atLoad: { deepLink: boolean; at: number } | null = null;
function loadedWith(): { deepLink: boolean; at: number } {
  if (atLoad === null) atLoad = { deepLink: hasOpenParam(), at: Date.now() };
  return atLoad;
}
/** Test seam: forget the first paint. */
export function resetDeepLinkAtLoad(): void {
  atLoad = null;
}

export function useOwnTurn(wants: boolean): boolean {
  const othersOpen = useSyncExternalStore(subscribeOpenStack, openStackSize, () => 0) > 0;
  const load = loadedWith();
  const sawOverlay = useRef(false);
  const [gaveUp, setGaveUp] = useState(false);
  if (othersOpen) sawOverlay.current = true;
  const coming = load.deepLink && !sawOverlay.current && !gaveUp && hasOpenParam();
  useEffect(() => {
    if (!wants || !coming) return;
    const t = setTimeout(() => setGaveUp(true), Math.max(0, DEEP_LINK_GIVES_UP_MS - (Date.now() - load.at)));
    return () => clearTimeout(t);
  }, [wants, coming, load.at]);
  // Decided in render, so a sheet that may show does so on its first frame
  // (no flash, no frame late). A drawer that mounts in the very same commit
  // as the read is the one order this cannot see; the walked case (drawer at
  // 1.2 s, the read at 3.7 s) is two commits.
  const held = useRef(false);
  if (!wants) held.current = false;
  else if (!othersOpen && !coming) held.current = true;
  return wants && held.current;
}
