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
 */
import { useRef, useSyncExternalStore } from 'react';
import { openStackSize, subscribeOpenStack } from './overlayState';

export function useOwnTurn(wants: boolean): boolean {
  const othersOpen = useSyncExternalStore(subscribeOpenStack, openStackSize, () => 0) > 0;
  // Decided in render, so a sheet that may show does so on its first frame
  // (no flash, no frame late). A drawer that mounts in the very same commit
  // as the read is the one order this cannot see; the walked case (drawer at
  // 1.2 s, the read at 3.7 s) is two commits.
  const held = useRef(false);
  if (!wants) held.current = false;
  else if (!othersOpen) held.current = true;
  return wants && held.current;
}
