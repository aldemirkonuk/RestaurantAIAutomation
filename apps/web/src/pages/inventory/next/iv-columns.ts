/**
 * Which register columns say nothing for any listed row (N-18).
 *
 * A column whose every cell is a dash is noise next to a 14 px name, so the
 * register hides it behind a "Columns" control. Two things are never hidden,
 * because hiding them would hide a way to act or a failed read (ADR 0020).
 * When any row's stock could not be read, its dashes mean "not read", so
 * nothing is hidden at all. Also kept:
 *   - the price column for a manager, whose cells are the price editor;
 *   - Type and Zone while the library or the zones could not be read, where
 *     the dash means "could not be read", not "nothing recorded".
 */
import type { InvRow } from './useInventoryNextData';

export type EmptyColumn = 'Type' | 'Zone' | 'Vel/day' | 'Runway' | 'Your price' | 'Value';

export interface EmptyColumnsInput {
  rows: InvRow[];
  canManage: boolean;
  libraryUnread: boolean;
  locationsUnavailable: boolean;
}

export function emptyColumns({ rows, canManage, libraryUnread, locationsUnavailable }: EmptyColumnsInput): Set<EmptyColumn> {
  const out = new Set<EmptyColumn>();
  if (rows.length === 0 || rows.some((r) => r.stock === null)) return out;
  if (!libraryUnread && rows.every((r) => !r.type || r.type === 'unclassified')) out.add('Type');
  if (!locationsUnavailable && rows.every((r) => r.zones === null || (r.stock === null && r.zones.every((z) => z.qty <= 0)))) out.add('Zone');
  if (rows.every((r) => r.velocity === null)) out.add('Vel/day');
  if (rows.every((r) => r.runway === null)) out.add('Runway');
  if (!canManage && rows.every((r) => r.bottle === null && r.glass === null)) out.add('Your price');
  // An unread cost is not an empty column: the cell says it could not be read (ADR 0020).
  if (rows.every((r) => r.value === null && r.rollupReadable !== false)) out.add('Value');
  return out;
}
