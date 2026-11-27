/**
 * Sorting the list by what uses a good, so dead stock can be ranked (r106 g5). Fewest recipes first, a count that
 * was not read last (never as 0), ties by name then id so the order is total; the words say when nothing was read.
 */
import { describe, expect, it } from 'vitest';
import { sortRows, sortWords, type InvRow } from './useInventoryNextData';

const row = (id: string, name: string, usedIn: number | null | undefined) => ({ id, name, usedIn }) as unknown as InvRow;
const ids = (rows: InvRow[]) => rows.map((r) => r.id);

describe('Fewest recipes first', () => {
  const rows = [row('d', 'Dolin', 3), row('u1', 'Unread one', null), row('z', 'Zonin', 0), row('l', 'Not read yet', undefined), row('a', 'Aperol', 0), row('c', 'Campari', 1)];

  it('puts zero first, then fewest, and every unread row (failed or still loading) after every read one', () => {
    expect(ids(sortRows(rows, 'used'))).toEqual(['a', 'z', 'c', 'd', 'l', 'u1']);
  });
  it('an unread row is never ranked as a zero-use good', () => {
    expect(ids(sortRows(rows, 'used')).indexOf('u1')).toBeGreaterThan(ids(sortRows(rows, 'used')).indexOf('d'));
  });
  it('ties fall to name, then id, so the order is total whatever order the rows arrive in', () => {
    const twins = [row('b2', 'Same', 2), row('b1', 'Same', 2), row('a1', 'Alpha', 2)];
    expect(ids(sortRows(twins, 'used'))).toEqual(['a1', 'b1', 'b2']);
    expect(ids(sortRows([...twins].reverse(), 'used'))).toEqual(['a1', 'b1', 'b2']);
  });
  it('says so when no count was read for any row listed', () => {
    expect(sortWords('used', [row('x', 'X', null), row('y', 'Y', undefined)])).toMatch(/though no recipe count was read/);
    expect(sortWords('used', rows)).toBe('sorted Fewest recipes first');
  });
});
