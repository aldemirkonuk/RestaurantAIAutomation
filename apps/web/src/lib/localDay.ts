/**
 * The calendar day an instant falls on, on THIS device's clock, as `YYYY-MM-DD`.
 *
 * `toISOString().slice(0, 10)` is the UTC date, and for a house west of
 * Greenwich that is tomorrow from the evening on: a sale rung at 20:00 PDT on
 * Friday is a Saturday in UTC. Pages that have no house-zone read to hand file
 * by the device's day instead — the same clock their own hour grids and
 * weekday labels already use — so one sale never sits on two days.
 */
export function localDayKey(at: Date | number): string {
  const d = typeof at === 'number' ? new Date(at) : at;
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}
