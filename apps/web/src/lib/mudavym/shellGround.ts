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
 *   - the store's `ground` — measured by PageGate after its child has mounted
 *     AND whenever the person's own choice changes (`groundChoice.ts`,
 *     ADR 0169), for the shell overlays whose triggers live in the header,
 *     i.e. OUTSIDE the page's `.mudavym` root, where an anchor walk finds
 *     nothing.
 *
 * [ADR 0169 round 5, 2026-09-20 — the self-reference bug.] `readShellGroundFromDom`
 * below used to query every `.mudavym[data-ground=…]` in the document with no
 * exclusion but `.mdv-ovl`. `HouseHeader` and the sidebar's `NavTooltip`
 * (`components/layout/Sidebar.tsx`) are THEMSELVES `.mudavym` roots — they carry
 * an explicit `data-ground` ONLY to mirror whatever this function last returned
 * (PageGate hands it straight through as a prop; see PageGate's header comment
 * for why it has to be a second declaration rather than inheritance). Once a
 * charcoal answer had been mirrored onto the header, a LATER call to this same
 * function — even one correctly triggered by a fresh choice or a page change —
 * found the header's own leftover mirror before it found (or failed to find)
 * anything the page itself declared, and answered charcoal again. The header
 * never got a chance to update, because the thing measuring it was reading
 * what it had told the header to say the time before. `:not(.mdv-hdr)` and
 * `:not(.mdv-hint)` below close that: only a genuine page-authored `data-ground`
 * (or the overlay case `.mdv-ovl` already excluded) counts as a declaration.
 * PageGate-level regression coverage: `HouseHeader.test.tsx`'s "PageGate" suite.
 *
 * HONEST LIMIT: a page that changed its OWN declared ground at runtime (not
 * the person's choice — an actual page rewriting its own `data-ground`) would
 * still leave the store's copy stale until the next mount or choice change. No
 * page does that today — `ground` is a static prop on all eight rebuilt pages
 * that accept one (grep `ground?: 'charcoal'`) — and the anchor reader is
 * unaffected either way.
 */

import { createContext, useSyncExternalStore } from 'react';
import { getGroundChoice } from './groundChoice';

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
 * A host with no `data-ground` stands on whatever a person chose for this
 * device (`groundChoice.ts`, ADR 0169; paper until they say otherwise) — the
 * same rule `styles/mudavym.css` paints it with, so this answer and the pixel
 * always agree without the host declaring anything.
 * [2026-09-19, ADR 0169: before this, an undeclared host was hardcoded
 * 'paper' here, described as agreeing with an app-level `.dark` rule that (by
 * the time of this correction) no longer exists in `mudavym.css` — ADR 0138
 * had already moved the charcoal column off `.dark .mudavym` on 2026-09-12.
 * That description was stale; this reader now asks the one place that knows.]
 *
 * Returning `null` rather than guessing is still the point for an anchor
 * outside every `.mudavym` root — a default here would answer for a question
 * that was never asked, the absence-reported-as-health shape (ADR 0020).
 */
export function readGroundFromDom(anchor?: Element | null): MudavymGround | null {
  if (typeof document === 'undefined') return null;
  const host = anchor?.closest?.('.mudavym') as HTMLElement | null | undefined;
  if (!host) return null;
  const declared = host.getAttribute('data-ground');
  if (declared === 'charcoal' || declared === 'paper') return declared;
  return getGroundChoice();
}

/**
 * The ground of the Mudavym page currently on screen, read off the document.
 * PageGate's measurement (see the header note) and the last-resort answer for
 * an overlay whose trigger lives outside every page root.
 *
 * Checked in order: an explicit charcoal declaration, an explicit paper
 * declaration (a per-surface decision always wins — ADR 0169 changes neither
 * branch), else the person's own choice for this device.
 */
export function readShellGroundFromDom(): MudavymGround {
  if (typeof document === 'undefined') return getGroundChoice();
  // `:not(.mdv-ovl)` keeps an open overlay out of the answer: the overlay root
  // is itself a `.mudavym[data-ground]` node portalled into <body>, and reading
  // it back would be the system asking itself what it just said.
  //
  // `:not(.mdv-hdr)` and `:not(.mdv-hint)` do the same for the gate's own
  // chrome (`HouseHeader`, the sidebar's `NavTooltip`) — both are `.mudavym`
  // roots that only ever MIRROR the value this function returned last time,
  // never a genuine declaration of their own. Without this exclusion a stale
  // mirror answers for the very call meant to refresh it — the file header's
  // "self-reference bug" note above. A real per-surface declaration (DoorNext,
  // the canonical document) never carries either class, so this excludes
  // nothing that was ever an honest answer.
  const EXCLUDE = ':not(.mdv-ovl):not(.mdv-hdr):not(.mdv-hint)';
  if (document.querySelector(`.mudavym[data-ground="charcoal"]${EXCLUDE}`)) {
    return 'charcoal';
  }
  if (document.querySelector(`.mudavym[data-ground="paper"]${EXCLUDE}`)) {
    return 'paper';
  }
  return getGroundChoice();
}

/**
 * The ground a subtree stands on, when a provider says so.
 *
 * `undefined` means "nobody declared one" — the overlay then falls back to the
 * DOM reader above. A default of `'paper'` here would silently overrule a
 * charcoal page, which is the bug this context exists to avoid.
 */
export const MudavymGroundContext = createContext<MudavymGround | undefined>(undefined);
