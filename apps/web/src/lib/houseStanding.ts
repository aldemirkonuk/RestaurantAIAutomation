/**
 * How much of the house is set, from the four things /house asks for: the
 * menu is current, a vendor is on the book, the last invoice is sent or
 * skipped, the money is set. Optional rows (drinks, the address, the count)
 * are not counted.
 *
 * Each is `true` (read, set), `false` (read, not set) or `null` (not read yet,
 * or the read failed). An unknown is never counted as unset (ADR 0020): while
 * any of the four is `null` the standing is `reading` and no count is made.
 */
export type HouseStanding = { kind: 'reading' } | { kind: 'counted'; set: number }

export const HOUSE_ROWS = 4

export function houseStanding(rows: readonly (boolean | null)[]): HouseStanding {
  if (rows.length !== HOUSE_ROWS || rows.some((row) => row === null)) return { kind: 'reading' }
  return { kind: 'counted', set: rows.filter((row) => row === true).length }
}
