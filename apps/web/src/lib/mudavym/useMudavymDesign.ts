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
 * `true` → render the Mudavym design for this page; `false` → legacy.
 * See module doc for precedence. Usually consumed via `<PageGate/>`.
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

  return override !== null ? override : remote;
}
