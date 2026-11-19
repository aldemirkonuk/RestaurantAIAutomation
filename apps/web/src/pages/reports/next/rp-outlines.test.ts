/**
 * r75: the paper drawn while the reader's sheet is on its way stands where the
 * house sheet will, so nothing below it moves when the sheet lands.
 */
import { describe, expect, it } from 'vitest';
import { verticalCompactor } from 'react-grid-layout/core';
import {
  DEFAULT_ON,
  DEFAULT_SLOTS,
  SHEET_COLS,
  outlineSlots,
  slotHeightPx,
} from './rp-sheet';

describe('outlineSlots', () => {
  it('[REVERT-FAILS] lies exactly where the grid compacts the house sheet to', () => {
    const grid = verticalCompactor.compact(
      DEFAULT_ON.map((id) => ({ i: id, ...DEFAULT_SLOTS[id] })),
      SHEET_COLS,
    );
    const want = Object.fromEntries(grid.map((l) => [l.i, { x: l.x, y: l.y, w: l.w, h: l.h }]));
    for (const { id, slot } of outlineSlots()) expect(slot, id).toEqual(want[id]);
  });

  it('[REVERT-FAILS] stands one outline per cutting on the house sheet, none over another', () => {
    const o = outlineSlots();
    expect(o.map((c) => c.id)).toEqual(DEFAULT_ON);
    for (const a of o)
      for (const b of o) {
        if (a === b) continue;
        const apart =
          a.slot.x + a.slot.w <= b.slot.x ||
          b.slot.x + b.slot.w <= a.slot.x ||
          a.slot.y + a.slot.h <= b.slot.y ||
          b.slot.y + b.slot.h <= a.slot.y;
        expect(apart, `${a.id} / ${b.id}`).toBe(true);
      }
  });

  it('reserves the sheet’s whole height, not one 322 px row', () => {
    const foot = Math.max(...outlineSlots().map((c) => c.slot.y + c.slot.h));
    expect(slotHeightPx(foot)).toBeGreaterThan(1500);
  });
});
