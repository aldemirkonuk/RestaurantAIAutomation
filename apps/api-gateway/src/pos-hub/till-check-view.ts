/**
 * What the check view says beyond the margin (a till check, read after the
 * fact). Two small pure helpers so the service stays a thin reader.
 *
 * - `priceNotSentLines` counts the lines a till sent with no price and no
 *   comp. `pos_checks.items` keeps the till's own words (price null when the
 *   till sent none), so the count is read from what was stored, not from the
 *   import's one-off tally that no screen ever saw. A comped line has no
 *   price on purpose and is not a gap.
 * - `recentChecksLimit` keeps the list read bounded.
 */

export const DEFAULT_RECENT_CHECKS = 30;
export const MAX_RECENT_CHECKS = 100;

export function recentChecksLimit(raw: unknown): number {
  const n = typeof raw === "string" ? Number(raw) : (raw as number);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_RECENT_CHECKS;
  return Math.min(Math.floor(n), MAX_RECENT_CHECKS);
}

export function priceNotSentLines(items: unknown): number {
  if (!Array.isArray(items)) return 0;
  let n = 0;
  for (const it of items) {
    if (!it || typeof it !== "object") continue;
    const line = it as { price?: unknown; comped?: unknown };
    if (line.comped === true) continue;
    if (line.price === null || line.price === undefined) n++;
  }
  return n;
}
