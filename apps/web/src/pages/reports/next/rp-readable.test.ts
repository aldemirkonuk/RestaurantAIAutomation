import { describe, expect, it } from 'vitest';
import { defaultIdsFor, heldMark, layoutFor, readableBy, type ReadersOf } from './rp-readable';
import { DEFAULT_ON, DEFAULT_SLOTS, HOUSE_LAYOUT_CUTTINGS } from './rp-sheet';
import { decodeSheet, defaultSheet } from './useReportsNextData';

/**
 * r36 reports audit, gap 3. The readers once the staff trains land: the till,
 * the bench, pacing, quadrants and the ledger join the room and the servers
 * as owner-and-manager registers.
 */
const MERGED: ReadersOf = (id) =>
  ['till', 'bench', 'pacing', 'quadrants', 'ledger', 'seats', 'service'].includes(id)
    ? ['owner', 'manager']
    : undefined;

describe('the sheet a role is handed is one it can read', () => {
  it('staff open on readable cuttings only, as many as the house sheet holds, desk last', () => {
    const { ids, slots } = defaultIdsFor('staff', MERGED);
    expect(ids).toEqual(['reading', 'goals', 'week', 'ahead', 'restock', 'writing']);
    expect(ids.every((id) => readableBy(id, 'staff', MERGED))).toBe(true);
    // Packed: no cutting overlaps another.
    const cells = new Set<string>();
    for (const id of ids)
      for (let x = slots[id].x; x < slots[id].x + slots[id].w; x++)
        for (let y = slots[id].y; y < slots[id].y + slots[id].h; y++) {
          expect(cells.has(`${x},${y}`)).toBe(false);
          cells.add(`${x},${y}`);
        }
  });

  it('fills a held cutting with a readable one off the house sheet', () => {
    const one: ReadersOf = (id) => (id === 'ledger' ? ['owner'] : undefined);
    const { ids } = defaultIdsFor('staff', one);
    expect(ids).toHaveLength(DEFAULT_ON.length);
    expect(ids).not.toContain('ledger');
    expect(ids).toContain('seats');
    expect(ids[ids.length - 1]).toBe('writing');
  });

  it('owners, managers and an unknown role keep the hand-set house sheet', () => {
    for (const role of ['owner', 'manager', null] as const) {
      const { ids, slots } = defaultIdsFor(role, MERGED);
      expect(ids).toEqual(DEFAULT_ON);
      expect(slots).toBe(DEFAULT_SLOTS);
    }
  });

  it('"Before service" keeps what the floor can read, and is not padded', () => {
    expect(layoutFor(HOUSE_LAYOUT_CUTTINGS.service, 'staff', MERGED)).toEqual(['reading', 'week']);
    expect(layoutFor(HOUSE_LAYOUT_CUTTINGS.service, 'manager', MERGED)).toEqual(
      HOUSE_LAYOUT_CUTTINGS.service,
    );
  });

  it('a held analysis is marked with who it is written for; a readable one is not', () => {
    expect(heldMark('seats', 'staff', MERGED)).toBe(' (owners and managers)');
    expect(heldMark('seats', 'manager', MERGED)).toBe('');
    expect(heldMark('week', 'staff', MERGED)).toBe('');
    expect(heldMark('seats', null, MERGED)).toBe('');
    expect(heldMark('ledger', 'staff', () => ['owner'])).toBe(' (owners)');
  });

  it('the hook hands staff with no saved sheet the readable default (catalogue readers)', () => {
    // On this base the room and the servers are already held from staff.
    for (const sheet of [decodeSheet(undefined, 'staff'), defaultSheet('staff')]) {
      const ids = sheet.cuttings.map((c) => c.id);
      expect(ids).not.toContain('seats');
      expect(ids).not.toContain('service');
      expect(ids.every((id) => readableBy(id, 'staff'))).toBe(true);
    }
    expect(decodeSheet(undefined).cuttings.map((c) => c.id)).toEqual(DEFAULT_ON);
  });
});
