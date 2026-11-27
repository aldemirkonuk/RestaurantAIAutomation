/**
 * How many empty rows the register draws while its list is read: as many as the
 * page already knows the list to have (the figures it reads beside it), so the
 * rows that land fill the room instead of making it. Nothing known holds one
 * row. A very long list is capped: past a screen the rest is below the fold,
 * where the signature and the books wait unseen until the read lands.
 */
export const READING_ROWS_MAX = 24;

export function readingRowCount(known: number | null | undefined): number {
  if (typeof known !== 'number' || !Number.isFinite(known) || known < 1) return 1;
  return Math.min(Math.floor(known), READING_ROWS_MAX);
}
