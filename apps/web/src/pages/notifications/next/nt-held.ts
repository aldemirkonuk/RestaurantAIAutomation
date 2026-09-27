/**
 * The held low-stock queue's words — kept out of `HeldBand.tsx` so that file
 * exports components only (react-refresh), and so the sentences can be
 * pinned without mounting anything.
 */

import type { HeldLowStockCrossing, HeldLowStockResponse } from '@/services/api/notifications';

export function reasonWords(reason: HeldLowStockCrossing['reason']): string {
  if (reason === 'instant_cooldown') return 'Held because another alert went out in the last 15 minutes.';
  if (reason === 'prefs') return 'Held because this house’s settings save low stock for the digest.';
  return 'Held. The reason was not recorded.';
}

/** "12 PM" — the hour the digest cron actually keeps. */
function hourWords(hour: number): string {
  const d = new Date(2000, 0, 1, hour);
  return d.toLocaleTimeString('en-US', { hour: 'numeric' });
}

/** When — or whether — the held wines will be told. */
export function whenTold(digest: HeldLowStockResponse['digest']): string {
  if (!digest) return 'When the next digest goes out could not be read.';
  if (!digest.low_stock_enabled) {
    return 'Low-stock alerts are turned off for everyone here, so these will not be sent on their own.';
  }
  if (digest.frequency === 'off') {
    return 'No one here takes the daily digest, so these will not be sent on their own.';
  }
  const at = `They go out together in the daily digest at ${hourWords(digest.hour)}`;
  // Founder item 61 (2026-09-27, "UTC, said on the page (Recommended)"): a
  // house with no time zone this server can read gets its digest on UTC, and
  // the page says so in these words.
  if (digest.zone_source === 'fallback' || digest.timezone === 'UTC') {
    return `${at} UTC — this house has no time zone set yet.`;
  }
  return `${at}, ${zoneWords(digest.timezone)}.`;
}

/**
 * "Los Angeles time" for `America/Los_Angeles` — the zone the gateway reports
 * the digest is kept in (the house's own since PR #488), in words. Falls back
 * to the raw zone name when it has no city part.
 */
function zoneWords(zone: string): string {
  const city = zone.split('/').pop()?.replace(/_/g, ' ').trim();
  return city && city !== zone ? `${city} time` : `${zone} time`;
}
