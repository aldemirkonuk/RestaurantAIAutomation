/**
 * The last answer for (house, page flag), kept for this tab so the first render
 * of a gated page already knows it and does not wait a round trip (perf-p10-2).
 * Only a SEEDED guess: the read still goes out and its answer wins. Keyed by
 * house id, so one house's answer is never read for another; wiped on sign-out
 * and house switch (forgetHouseReads). Storage may be blocked or throw: an
 * unreadable seed is "unknown", which behaves exactly as before.
 *
 * Its own module so AuthContext can wipe it without importing the hook
 * (which imports AuthContext).
 */
import type { MudavymPage } from './useMudavymDesign';

const SEED_PREFIX = 'mudavym.flagSeed:';

function seedKey(restaurantId: string, page: MudavymPage): string {
  return `${SEED_PREFIX}${restaurantId}:mudavym_design_${page}`;
}

export function readSeed(restaurantId: string | null, page: MudavymPage): boolean | null {
  if (!restaurantId) return null;
  try {
    const raw = window.sessionStorage.getItem(seedKey(restaurantId, page));
    return raw === '1' ? true : raw === '0' ? false : null;
  } catch {
    return null;
  }
}

export function writeSeed(restaurantId: string, page: MudavymPage, enabled: boolean): void {
  try {
    window.sessionStorage.setItem(seedKey(restaurantId, page), enabled ? '1' : '0');
  } catch {
    /* blocked storage: the next visit simply asks first */
  }
}

export function clearFlagSeeds(): void {
  try {
    const store = window.sessionStorage;
    for (let i = store.length - 1; i >= 0; i--) {
      const k = store.key(i);
      if (k && k.startsWith(SEED_PREFIX)) store.removeItem(k);
    }
  } catch {
    /* blocked storage: nothing was kept */
  }
}
