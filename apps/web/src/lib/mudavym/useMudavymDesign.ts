/**
 * Per-page gate for the Mudavym redesign.
 *
 * Precedence, checked in order:
 *
 * 1. `localStorage["mudavym.design.<page>"]` — per-browser dev/QA override so
 *    a designer can flip one page on this machine only. `"1" | "true" | "on"`
 *    forces the new design, `"0" | "false" | "off"` forces legacy — this is
 *    the ONLY way to see legacy on a `LIVE_PAGES` page, and it stays QA-only:
 *    it never reaches another browser or another house. Anything else (or
 *    absence) falls through.
 * 2. `LIVE_PAGES` — ADR 0149 row 36 (2026-09-17, "16 locked pages"). These
 *    keys resolve to the Mudavym design for every house, in code, regardless
 *    of the `restaurant_feature_flags` row: no flag request is spent, a
 *    missing row and an explicit `false` column both mean the same thing.
 *    This is a go-live, not a redesign of the precedence — the flag columns
 *    are untouched and unread for these pages; nothing here writes to the
 *    database.
 * 3. The per-restaurant feature flag `mudavym_design_<page>` via the existing
 *    flag API (`settingsApi.checkFeatureFlag` → POST
 *    `/settings/feature-flags/check`), for every page NOT in `LIVE_PAGES`.
 *    The gateway's registry
 *    (apps/api-gateway/src/settings/feature-flag-registry.ts) returns
 *    `{ enabled: false, active: false }` for any flag no code reads, so an
 *    unregistered page is safely OFF — a page team turns its flag real by
 *    adding it to ACTIVE_FEATURE_FLAGS with a `readBy` pointing at their
 *    PageGate call site. Registering the switch in Settings is the page
 *    team's job, not this hook's.
 * 4. Default: `false` — legacy renders while the check is in flight or when
 *    no restaurant is active. The gate must never flash the new design at
 *    someone who is not meant to see it.
 */

import { useContext, useEffect, useState } from 'react';
import { AuthContext } from '../../contexts/AuthContext';
import { settingsApi } from '../../services/api/settings';

/**
 * Pages enrolled in the Mudavym redesign. Page teams: append your page here
 * (this array is the source of the `MudavymPage` type, so the hook and
 * PageGate accept it immediately) and register `mudavym_design_<page>` in the
 * gateway's ACTIVE_FEATURE_FLAGS with a `readBy` pointing at your PageGate.
 */
export const MUDAVYM_PAGES = [
  'dashboard',
  'orders',
  'receiving',
  'receiving_door',
  'providers',
  'communications',
  'team',
  'inventory',
  'receipts',
  'documents_reports',
  'reports',
  'notifications',
  'recommendations',
  'calendar',
  'settings',
  'profile',
  'cellar',
  // Not a redesign of a shipping page: `/connections` is a NEW route (ADR
  // 0114). With the flag off the route redirects to `/profile` and the nav
  // entry is absent, so OFF means "this surface does not exist here" rather
  // than "the old design".
  'connections',
  // ADR 0104 D12 slice 2 — the canonical document at /documents/:id. OFF by
  // default like every other page here; the gate's `legacy` branch redirects
  // to /receipts, which is this view's other face.
  'document',
  // ADR 0133 (2026-09-06), new-pages wave. `/logs` only — the other nine
  // pages that ADR covers are not part of this addition; see the migration
  // 20260912080000's own note for why they arrive separately.
  'logs',
  // ADR 0113/0143/0144 + sketch 121. `/get-started`'s flyleaf-and-contents
  // book. Flag off, `legacy` is today's GetStarted — unchanged, not a
  // redirect, because it is still the real onboarding path for every house
  // until this one is turned on. Held back from LIVE_PAGES.
  'arrival',
  // ADR 0143: one desk and one switch, including the old health bookmark.
  // [2026-09-25: live for every house in code — see LIVE_PAGES below.]
  'admin',
  // Not a page: the app SHELL (sketch 119 direction D, the founder's pick of
  // 2026-09-21; ADR 0149 row 5). `DashboardLayout` reads this gate and renders
  // `HouseShell` — rooms rail, house header, counter, the phone's four doors —
  // around whatever page is routed, legacy or rebuilt. Off, the legacy
  // Sidebar layout renders byte-for-byte. Column added by 20260921114300.
  // [2026-09-25: live for every house in code — see LIVE_PAGES below; "off"
  // is now reachable only through the browser's QA override.]
  'shell',
  // ADR 0160 §111 / ADR 0149 row 52 (2026-09-21). `/help` resolves on for
  // every house in code — see LIVE_PAGES below — so it carries no
  // `mudavym_design_help` ACTIVE registry entry; enrolling it here is still
  // required, since MUDAVYM_PAGES is the source of the `MudavymPage` type
  // PageGate, HouseHeader and PAGE_NAMES all key off.
  'help',
  // ADR 0160 sec110 item 7 (2026-09-17). A NEW route with no legacy
  // counterpart, same posture as `connections` above: `legacy` is a redirect
  // to `/cellar`, never a real fallback page. Live with the cellar (below);
  // no `mudavym_design_menu` column exists or is needed.
  'menu',
  // ADR 0144 -- the /authorize consent page. Enrolled after the 2026-09-17
  // go-live, so NOT in LIVE_PAGES: flag-gated, OFF by default (20260922220200).
  // [2026-09-25: superseded — now in LIVE_PAGES, live for every house in
  // code; the 20260922220200 column stays, unread.]
  'authorize_integration',
  // ADR 0160 §112 (/vendor-prices). Flag-gated, OFF by default, NOT in
  // LIVE_PAGES — the founder flips it per house (column: 20260926170000).
  'vendor_prices',
] as const;

export type MudavymPage = (typeof MUDAVYM_PAGES)[number];

/**
 * ADR 0149 row 36 (founder, 2026-09-17): "16 locked pages" — resolves to the
 * Mudavym design for every house, in code, with no `restaurant_feature_flags`
 * read and no database write. `receiving` is the receiving DESK (the flagged
 * list/history page, route `/receiving`) — distinct from `receiving_door`,
 * which IS live. `settings` joined 2026-09-19 after its sketch review cleared
 * (ADR 0160 "109 — settings · A, the interview"; PR #419) — same code-side
 * always-on as the original sixteen, still no database write. `help` joined
 * 2026-09-21 (ADR 0149 row 52 / PR #413) the same way. `cellar` and `menu`
 * joined with the cellar lane's merge (prior cellar ruling).
 *
 * [2026-09-25, ADR 0149 row 36's bracket: `shell`, `admin` and
 * `authorize_integration` joined, on the founder's 2026-09-22 page-gap answers
 * Q2 ("I want all locked pages to be live (production)") and Q4 ("turn on for
 * every house the instant each PR merges — no staged single-house rollout").
 * Before this, a 2026-09-25 production read found `shell` and `admin` ON for
 * all 14 existing houses, but a house created later got the legacy shell and
 * admin because both columns default to false; in code it no longer matters
 * which row a house has, or whether it has one. Their three columns stay,
 * unread (ADR 0149 never deletes a column).]
 *
 * 23 keys. Held back, still flag-gated: `recommendations`, `receiving`, and
 * `arrival` (the /get-started book, whose `legacy` slot is the ADR 0213 plan
 * of record — OFF until deliberately flipped). `MUDAVYM_PAGES.length` is 26;
 * this is deliberately not "the rest" spelled
 * generically — `useMudavymDesign.test.tsx` asserts the two sets partition
 * `MUDAVYM_PAGES` exactly, so an addition to either without the other fails a
 * test rather than silently mis-routing a house.
 */
export const LIVE_PAGES: ReadonlySet<MudavymPage> = new Set<MudavymPage>([
  'dashboard',
  'orders',
  'receiving_door',
  'providers',
  'communications',
  'team',
  'inventory',
  'receipts',
  'documents_reports',
  'document',
  'reports',
  'calendar',
  'profile',
  'connections',
  'notifications',
  'logs',
  'settings',
  'help',
  'cellar',
  'menu',
  'shell',
  'admin',
  'authorize_integration',
]);

/** Same key the API client uses for the X-Restaurant-Id header (client.ts). */
const ACTIVE_RESTAURANT_KEY = 'activeRestaurantId';

export function overrideKeyFor(page: MudavymPage): string {
  return `mudavym.design.${page}`;
}

export function flagKeyFor(page: MudavymPage): string {
  return `mudavym_design_${page}`;
}

/** null = no override present; boolean = forced state. */
function readOverride(page: MudavymPage): boolean | null {
  try {
    const raw = window.localStorage.getItem(overrideKeyFor(page));
    if (raw === null) return null;
    const v = raw.trim().toLowerCase();
    if (v === '1' || v === 'true' || v === 'on') return true;
    if (v === '0' || v === 'false' || v === 'off') return false;
    return null;
  } catch {
    return null; // storage blocked — behave as if no override
  }
}

/**
 * One in-flight/settled promise per restaurant+flag for the session, so ten
 * gated components cost one request. Cleared by clearMudavymDesignCache().
 */
const flagCache = new Map<string, Promise<boolean>>();

function fetchFlag(restaurantId: string, page: MudavymPage): Promise<boolean> {
  const key = `${restaurantId}:${flagKeyFor(page)}`;
  let cached = flagCache.get(key);
  if (!cached) {
    cached = settingsApi
      .checkFeatureFlag(restaurantId, flagKeyFor(page))
      .then((res) => res.active && res.enabled)
      .catch(() => false); // network/API failure → legacy, never a broken page
    flagCache.set(key, cached);
  }
  return cached;
}

/** Test/dev helper: forget cached flag results (e.g. after switching branch). */
export function clearMudavymDesignCache(): void {
  flagCache.clear();
}

/**
 * `true` → render the Mudavym design for this page; `false` → legacy.
 * See module doc for precedence. Usually consumed via `<PageGate/>`.
 */
export function useMudavymDesign(page: MudavymPage): boolean {
  const override = typeof window === 'undefined' ? null : readOverride(page);
  const live = LIVE_PAGES.has(page);
  // Reactive restaurant identity: a switch happens while gated pages stay
  // mounted, and reading localStorage inside the effect alone would leave the
  // previous restaurant's flag verdict rendering for the new one (Opus
  // review 2026-08-31). The context is consumed optionally — a gate must
  // degrade to the localStorage fallback outside an AuthProvider (tests,
  // isolated mounts), never crash the page it wraps. Read unconditionally
  // (not only for held-back pages) so hook order never depends on `live`.
  const activeRestaurantId = useContext(AuthContext)?.activeRestaurantId ?? null;
  const [remote, setRemote] = useState(false);

  useEffect(() => {
    if (override !== null) return; // overridden — don't spend the request
    if (live) return; // LIVE_PAGES resolves in code — no flag row to fetch
    let cancelled = false;
    setRemote(false); // never carry one restaurant's verdict into another's
    let restaurantId: string | null = activeRestaurantId ?? null;
    if (!restaurantId) {
      try {
        restaurantId = window.localStorage.getItem(ACTIVE_RESTAURANT_KEY);
      } catch {
        restaurantId = null;
      }
    }
    if (!restaurantId) {
      return;
    }
    fetchFlag(restaurantId, page).then((enabled) => {
      if (!cancelled) setRemote(enabled);
    });
    return () => {
      cancelled = true;
    };
  }, [page, override, live, activeRestaurantId]);

  if (override !== null) return override;
  return live || remote;
}
