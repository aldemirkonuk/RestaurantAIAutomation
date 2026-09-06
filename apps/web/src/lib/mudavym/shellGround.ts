/**
 * The shell gate — is a Mudavym page on screen right now, and on what ground?
 *
 * WHY THIS EXISTS
 * ---------------
 * The app shell renders nine overlays over EVERY page (command palette, Ask AI,
 * shortcuts, recently-viewed, the notifications popover, the user menu, the
 * theme menu, the branch switcher, the mobile scrim). They are shared by the
 * legacy pages and the rebuilt ones. ADR 0042's promise is that a page with its
 * flag off renders byte-for-byte as it always has — so the shell may not simply
 * be restyled. It has to ask, at render time, whether the page underneath is a
 * Mudavym page, and only then wear the house shape.
 *
 * `PageGate` claims a slot while it is showing a `next` tree and releases it on
 * unmount. Nothing else writes here.
 *
 * THE GROUND IS A DOM FACT, NOT A PROP
 * ------------------------------------
 * PageGate cannot be told the ground: it renders `next` as-is, and the page —
 * not the gate — owns `data-ground` (see PageGate's header comment for the CSS
 * reason). Route entries pass no ground at all (App.tsx:301-365); the one page
 * that forces charcoal hardcodes it on its own root (DoorNext.tsx:380). So the
 * ground is read back off the DOM the page rendered.
 *
 * Two readers, deliberately:
 *
 *   - `readGroundFromDom(anchor)` — the live answer, used by an overlay at the
 *     moment it opens. When the opener is inside a `.mudavym` subtree this is
 *     exact and has no timing dependency at all.
 *   - the store's `ground` — measured once by PageGate after its child has
 *     mounted, for the shell overlays whose triggers live in the header, i.e.
 *     OUTSIDE the page's `.mudavym` root, where an anchor walk finds nothing.
 *
 * HONEST LIMIT: a page that changed its own ground at runtime would leave the
 * store's copy stale until the next mount. No page does that today — `ground`
 * is a static prop on all eight rebuilt pages that accept one (grep
 * `ground?: 'charcoal'`) — and the anchor reader is unaffected either way.
 */

import { createContext, useSyncExternalStore } from 'react';

export type MudavymGround = 'paper' | 'charcoal';

export interface MudavymShellState {
  /** True while a rebuilt (Mudavym) page is mounted. */
  on: boolean;
  /** The ground that page is standing on. Meaningless while `on` is false. */
  ground: MudavymGround;
}

const OFF: MudavymShellState = { on: false, ground: 'paper' };

/**
 * Claims, not a boolean: React can mount the next route's tree before it
 * unmounts the previous one, and a bare flag would be cleared by the departing
 * page after the arriving one set it.
 */
const claims = new Map<symbol, MudavymGround>();
const listeners = new Set<() => void>();
let snapshot: MudavymShellState = OFF;

function recompute(): void {
  let next: MudavymShellState = OFF;
  if (claims.size > 0) {
    // Last claim wins — the arriving page, in the overlap described above.
    let ground: MudavymGround = 'paper';
    for (const g of claims.values()) ground = g;
    next = { on: true, ground };
  }
  if (next.on === snapshot.on && next.ground === snapshot.ground) return;
  snapshot = next;
  for (const l of listeners) l();
}

/** PageGate only. `token` is the gate instance's identity. */
export function claimMudavymShell(token: symbol, ground: MudavymGround): void {
  claims.set(token, ground);
  recompute();
}

/** PageGate only. */
export function releaseMudavymShell(token: symbol): void {
  if (claims.delete(token)) recompute();
}

export function getMudavymShell(): MudavymShellState {
  return snapshot;
}

export function subscribeMudavymShell(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Tests only — the store is module state and would otherwise leak across specs. */
export function resetMudavymShell(): void {
  claims.clear();
  recompute();
}

/**
 * Is a Mudavym page on screen, and on what ground? Server snapshot is `OFF`,
 * so an SSR/prerender pass renders the legacy shell rather than guessing.
 */
export function useMudavymShell(): MudavymShellState {
  return useSyncExternalStore(subscribeMudavymShell, getMudavymShell, () => OFF);
}

/**
 * The ground of the `.mudavym` subtree `anchor` sits in, or `null` when it sits
 * in none (a shell trigger in the header is outside every page root).
 *
 * A host with no `data-ground` is paper, exactly as the page itself reads it:
 * an app-level `.dark` then turns BOTH the page and the overlay charcoal
 * through `.dark .mudavym`, so the two still agree without either declaring it.
 *
 * Returning `null` rather than a paper default is the point — a default here
 * would answer "paper" for a question that was never asked, which is the
 * absence-reported-as-health shape (ADR 0020).
 */
export function readGroundFromDom(anchor?: Element | null): MudavymGround | null {
  if (typeof document === 'undefined') return null;
  const host = anchor?.closest?.('.mudavym') as HTMLElement | null | undefined;
  if (!host) return null;
  return host.getAttribute('data-ground') === 'charcoal' ? 'charcoal' : 'paper';
}

/**
 * The ground of the Mudavym page currently on screen, read off the document.
 * PageGate's measurement (see the header note) and the last-resort answer for
 * an overlay whose trigger lives outside every page root.
 */
export function readShellGroundFromDom(): MudavymGround {
  if (typeof document === 'undefined') return 'paper';
  // `:not(.mdv-ovl)` keeps an open overlay out of the answer: the overlay root
  // is itself a `.mudavym[data-ground]` node portalled into <body>, and reading
  // it back would be the system asking itself what it just said.
  return document.querySelector('.mudavym[data-ground="charcoal"]:not(.mdv-ovl)')
    ? 'charcoal'
    : 'paper';
}

/**
 * The ground a subtree stands on, when a provider says so.
 *
 * `undefined` means "nobody declared one" — the overlay then falls back to the
 * DOM reader above. A default of `'paper'` here would silently overrule a
 * charcoal page, which is the bug this context exists to avoid.
 */
export const MudavymGroundContext = createContext<MudavymGround | undefined>(undefined);
