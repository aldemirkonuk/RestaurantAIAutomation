/**
 * A wine's "Last 14 days" line (F-1302).
 *
 * The gateway sends each day as `{ date, out, in }` (inventory.service.ts
 * `getItemActivity`): `out` is what left the shelf (pours, sales, waste),
 * `in` what came onto it. The line is depletion, so it is drawn from `out`.
 * It read `qty`/`total`/`depleted`/`count`/`value` before, none of which the
 * gateway sends, so every day was 0 and the card said there were no pours.
 */
export function dailyDepletion(activity: { daily?: unknown } | null | undefined): number[] {
  const days = Array.isArray(activity?.daily) ? (activity.daily as any[]) : [];
  return days.map((d) => {
    const out = Number(d?.out);
    return Number.isFinite(out) && out > 0 ? out : 0;
  });
}
