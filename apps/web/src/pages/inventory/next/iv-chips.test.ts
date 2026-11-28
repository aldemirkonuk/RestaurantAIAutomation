/**
 * The Unused chip and the Used in column's rules (r105 g5). A count that was
 * not read is never "unused", so only a read 0 matches the chip, and a failed
 * read keeps the column to say so.
 */
import { describe, expect, it } from 'vitest';
import { CHIPS, chipMatch, type InvRow } from './useInventoryNextData';
import { emptyColumns } from './iv-columns';
import { readView } from './iv-url';

const row = (usedIn: number | null | undefined) => ({ id: 'i', stock: 1, zones: [], type: 'red', velocity: 1, runway: 1, bottle: 1, glass: 1, value: 1, usedIn }) as unknown as InvRow;

describe('Unused chip', () => {
  it('is listed beside Price signals and survives a reload through the url', () => {
    const ids = CHIPS.map((c) => c.id);
    expect(ids.indexOf('unused')).toBe(ids.indexOf('price') + 1);
    expect(readView(new URLSearchParams('chip=unused')).chip).toBe('unused');
  });

  it('matches only a good read as used by no recipe', () => {
    expect(chipMatch(row(0), 'unused')).toBe(true);
    expect(chipMatch(row(3), 'unused')).toBe(false);
    expect(chipMatch(row(null), 'unused')).toBe(false);
    expect(chipMatch(row(undefined), 'unused')).toBe(false);
  });
});

describe('Used in column', () => {
  const input = (rows: InvRow[]) => ({ rows, canManage: true, libraryUnread: false, locationsUnavailable: false });
  it('is hidden while reading and when every good is read as 0, shown once any count is above 0 or unread', () => {
    expect(emptyColumns(input([row(undefined), row(undefined)])).has('Used in')).toBe(true);
    expect(emptyColumns(input([row(0), row(0)])).has('Used in')).toBe(true);
    expect(emptyColumns(input([row(0), row(2)])).has('Used in')).toBe(false);
    expect(emptyColumns(input([row(null), row(null)])).has('Used in')).toBe(false);
  });
});
