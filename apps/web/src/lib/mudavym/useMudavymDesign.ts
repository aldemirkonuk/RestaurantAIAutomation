/**
 * Per-page gate for the Mudavym redesign.
 *
 * Precedence, checked in order:
 *
 * 1. `localStorage["mudavym.design.<page>"]` — per-browser dev override so a
 *    designer can flip one page on this machine only. `"1" | "true" | "on"`
 *    forces the new design, `"0" | "false" | "off"` forces legacy. Anything
 *    else (or absence) falls through.
 * 2. The per-restaurant feature flag `mudavym_design_<page>` via the existing
 *    flag API (`settingsApi.checkFeatureFlag` → POST
 *    `/settings/feature-flags/check`). The gateway's registry
 *    (apps/api-gateway/src/settings/feature-flag-registry.ts) returns
 *    `{ enabled: false, active: false }` for any flag no code reads, so an
 *    unregistered page is safely OFF — a page team turns its flag real by
 *    adding it to ACTIVE_FEATURE_FLAGS with a `readBy` pointing at their
 *    PageGate call site. Registering the switch in Settings is the page
 *    team's job, not this hook's.
 * 3. Default: `false` — legacy renders while the check is in flight or when
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
  // ADR 0160 sec110 item 7 (2026-09-17). A NEW route with no legacy
  // counterpart, same posture as `connections` above: `legacy` is a redirect,
  // never a real fallback page. On for every house via `ALWAYS_ON_PAGES`
  // below — no `mudavym_design_menu` column exists or is needed.
  'menu',
] as const;

export type MudavymPage = (typeof MUDAVYM_PAGES)[number];

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
 * Pages the founder decided ship for EVERY house, with no per-house dial —
 * ADR 0149 (finish every page, then delete legacy once) and the 2026-09-17
 * wiring instruction for this build: "render the new page for every house,
 * no new per-house flag; make the page resolve on."
 *
 * This has to be a bypass checked BEFORE the remote flag is fetched, not a
 * `defaultValue: true` in the gateway's registry, because a `defaultValue`
 * only fills in when the STORED COLUMN is missing
 * (`settings.service.ts#normalize`) — and `restaurant_cellar_registers`'s
 * migration gives `mudavym_design_cellar` `boolean NOT NULL DEFAULT false`.
 * Every house that already has a `restaurant_feature_flags` row (nearly all
 * of them, since the table is one row of many flags per restaurant) reads
 * that real, stored `false` and never reaches the registry default at all —
 * measured 2026-09-18, the flip only ever affected houses with no row yet.
 * Checking this set first means neither that column value nor a flag-read
 * network failure (`fetchFlag`'s `.catch(() => false)` above) can ever knock
 * one of these pages back to legacy for anyone.
 *
 * `menu` is here for the same reason `cellar` is (ADR 0160 sec110 item 7): a
 * brand-new route with no legacy page to fall back to, so there is nothing a
 * per-house flag would usefully gate — it also means `/menu`'s `PageGate`
 * never has to issue a `checkFeatureFlag` request at all.
 */
const ALWAYS_ON_PAGES: ReadonlySet<MudavymPage> = new Set(['cellar', 'menu']);

/**
 * `true` → render the Mudavym design for this page; `false` → legacy.
 * See module doc for precedence, and `ALWAYS_ON_PAGES` above for the pages
 * that skip it entirely. Usually consumed via `<PageGate/>`.
 */
export function useMudavymDesign(page: MudavymPage): boolean {
  const override = typeof window === 'undefined' ? null : readOverride(page);
  // Reactive restaurant identity: a switch happens while gated pages stay
  // mounted, and reading localStorage inside the effect alone would leave the
  // previous restaurant's flag verdict rendering for the new one (Opus
  // review 2026-08-31). The context is consumed optionally — a gate must
  // degrade to the localStorage fallback outside an AuthProvider (tests,
  // isolated mounts), never crash the page it wraps.
  const activeRestaurantId = useContext(AuthContext)?.activeRestaurantId ?? null;
  const [remote, setRemote] = useState(false);

  useEffect(() => {
    if (override !== null) return; // overridden — don't spend the request
    if (ALWAYS_ON_PAGES.has(page)) return; // on for every house — no request needed
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
  }, [page, override, activeRestaurantId]);

  if (override !== null) return override;
  if (ALWAYS_ON_PAGES.has(page)) return true;
  return remote;
}
