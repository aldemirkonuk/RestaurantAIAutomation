/**
 * The keyboard's half of the canvas.
 *
 * `Sheet.test.tsx` proves the POINTER callbacks are bound and that the layout
 * they receive becomes the slot we save. This file proves the other writer:
 * that a keystroke runs react-grid-layout's OWN `moveElement` + `compact`
 * pipeline, lands on the same ruling a drag would, respects the same floor and
 * the same edges — and, the part that is easiest to get wrong and impossible to
 * see, that the sentence read out to a screen reader is the position the sheet
 * GAVE rather than the one the key asked for.
 *
 * These are pure functions on purpose. jsdom cannot produce RGL's pointer
 * deltas, so the pointer half can only ever be tested at its seam; the keyboard
 * half is arithmetic, and arithmetic can be pinned exactly.
 */

import { describe, expect, it } from 'vitest';
import {
  cancelledWords,
  colsForWidth,
  moveCutting,
  movedWords,
  pickedUpWords,
  placedWords,
  positionWords,
  resizeCutting,
  sameSlot,
  slotOf,
  slotRect,
} from './rp-arrange';
import { SHEET_COLS, SHEET_MIN_H, SHEET_MIN_W, type Cutting } from './rp-sheet';

/** Two cuttings stacked in the same column — the shape compaction acts on. */
function stack(): Cutting[] {
  return [
    { id: 'till', slot: { x: 0, y: 0, w: 6, h: 4 }, graph: 'area' },
    { id: 'ledger', slot: { x: 0, y: 4, w: 6, h: 4 }, graph: 'table' },
  ];
}

/** Two cuttings side by side — nothing above or below either. */
function side(): Cutting[] {
  return [
    { id: 'till', slot: { x: 0, y: 0, w: 5, h: 4 }, graph: 'area' },
    { id: 'ledger', slot: { x: 5, y: 0, w: 5, h: 4 }, graph: 'table' },
  ];
}

describe('the ruling in play', () => {
  it('reads the column count through the library’s own breakpoints', () => {
    expect(colsForWidth(1440)).toBe(12); // lg
    expect(colsForWidth(1000)).toBe(12); // md
    expect(colsForWidth(800)).toBe(6); // sm
    expect(colsForWidth(500)).toBe(4); // xs
    expect(colsForWidth(320)).toBe(2); // xxs
  });

  it('falls back to the sheet’s own twelve when it cannot measure', () => {
    // A width of 0 is jsdom, or a sheet not laid out yet. Falling through to
    // `xxs`'s two columns would silently turn "we could not measure" into
    // "this is a phone", and every keyboard move would clamp at column 1.
    expect(colsForWidth(0)).toBe(SHEET_COLS);
    expect(colsForWidth(Number.NaN)).toBe(SHEET_COLS);
    expect(colsForWidth(-10)).toBe(SHEET_COLS);
  });

  it('gives a slot no pixel rectangle when the container has no width', () => {
    expect(slotRect({ x: 0, y: 0, w: 6, h: 4 }, 0, 12)).toBeNull();
    const rect = slotRect({ x: 0, y: 0, w: 6, h: 4 }, 1200, 12);
    expect(rect).not.toBeNull();
    expect(rect!.left).toBe(0);
    expect(rect!.top).toBe(0);
    expect(rect!.width).toBeGreaterThan(0);
    expect(rect!.height).toBeGreaterThan(0);
  });
});

describe('moving a cutting with the keyboard', () => {
  it('moves one column at a time', () => {
    const next = moveCutting(side(), 'till', 1, 0, 12);
    expect(slotOf(next, 'till')).toEqual({ x: 1, y: 0, w: 5, h: 4 });
  });

  it('cannot be pushed off the left edge or past the ruling on the right', () => {
    const atLeft = moveCutting(side(), 'till', -1, 0, 12);
    expect(slotOf(atLeft, 'till')).toEqual({ x: 0, y: 0, w: 5, h: 4 });

    // `ledger` is 5 wide at x=5, so x=7 is the last column it fits in.
    let cs = side();
    for (let i = 0; i < 10; i++) cs = moveCutting(cs, 'ledger', 1, 0, 12);
    expect(slotOf(cs, 'ledger')!.x).toBe(12 - 5);
  });

  it('cannot be pushed above the top of the sheet', () => {
    const next = moveCutting(side(), 'till', 0, -1, 12);
    expect(slotOf(next, 'till')).toEqual({ x: 0, y: 0, w: 5, h: 4 });
  });

  it('leaves the array untouched when the move changes nothing', () => {
    const cs = side();
    expect(moveCutting(cs, 'till', -1, 0, 12)).toBe(cs);
    expect(moveCutting(cs, 'till', 0, -1, 12)).toBe(cs);
  });

  it('runs the same compaction the pointer path runs — a gap closes behind it', () => {
    // Stacked in one column: nudging the lower one down leaves no gap, because
    // vertical compaction pulls it straight back. This is not a bug to hide;
    // it is why the announcement must report the RESULT.
    const cs = stack();
    const next = moveCutting(cs, 'ledger', 0, 1, 12);
    expect(slotOf(next, 'ledger')).toEqual({ x: 0, y: 4, w: 6, h: 4 });
  });

  it('swaps two stacked cuttings when one is pushed through the other', () => {
    const cs = stack();
    const next = moveCutting(cs, 'till', 0, 4, 12);
    // `till` asked for row 4; `ledger` was there, so it was displaced upward
    // and the ruling closed the gap. Both are still on the paper, in order.
    expect(slotOf(next, 'ledger')!.y).toBe(0);
    expect(slotOf(next, 'till')!.y).toBe(4);
  });

  it('does not know about ids that are not on the sheet', () => {
    const cs = side();
    expect(moveCutting(cs, 'restock', 1, 0, 12)).toBe(cs);
  });
});

describe('resizing a cutting with the keyboard', () => {
  it('grows and shrinks by one grid unit', () => {
    const wider = resizeCutting(side(), 'till', 1, 0, 12);
    expect(slotOf(wider, 'till')!.w).toBe(6);
    const taller = resizeCutting(side(), 'till', 0, 1, 12);
    expect(slotOf(taller, 'till')!.h).toBe(5);
  });

  it('keeps the same floor the pointer resize has', () => {
    let cs = side();
    for (let i = 0; i < 10; i++) cs = resizeCutting(cs, 'till', -1, -1, 12);
    expect(slotOf(cs, 'till')!.w).toBe(SHEET_MIN_W);
    expect(slotOf(cs, 'till')!.h).toBe(SHEET_MIN_H);
  });

  it('cannot be widened off the paper', () => {
    let cs = side();
    for (let i = 0; i < 20; i++) cs = resizeCutting(cs, 'ledger', 1, 0, 12);
    const s = slotOf(cs, 'ledger')!;
    expect(s.x + s.w).toBeLessThanOrEqual(12);
  });

  it('leaves the array untouched when the size cannot change', () => {
    const cs = side();
    const min = resizeCutting(
      resizeCutting(resizeCutting(cs, 'till', -1, -1, 12), 'till', -1, -1, 12),
      'till',
      -1,
      -1,
      12,
    );
    expect(resizeCutting(min, 'till', -1, -1, 12)).toBe(min);
  });
});

describe('what a screen reader is told', () => {
  it('counts columns and rows from one, the way paper does', () => {
    expect(positionWords({ x: 0, y: 0, w: 7, h: 9 }, 12)).toBe(
      'column 1 of 12, row 1, 7 columns wide, 9 rows tall',
    );
    expect(positionWords({ x: 3, y: 2, w: 1, h: 1 }, 12)).toBe(
      'column 4 of 12, row 3, 1 column wide, 1 row tall',
    );
  });

  it('teaches the keys on pick-up, once, on the control the reader is standing on', () => {
    const said = pickedUpWords('The reading', { x: 0, y: 0, w: 7, h: 9 }, 12);
    expect(said).toContain('The reading picked up');
    expect(said).toContain('Shift and an arrow key resize it');
    expect(said).toContain('Escape puts it back');
  });

  it('reports the position the SHEET gave, not the one the key asked for', () => {
    const cs = stack();
    const before = slotOf(cs, 'ledger')!;
    const next = moveCutting(cs, 'ledger', 0, 1, 12);
    const after = slotOf(next, 'ledger')!;
    // The nudge was accepted by the handler and undone by compaction. The
    // sentence must say so rather than announcing row 6.
    expect(sameSlot(before, after)).toBe(true);
    const said = movedWords('Figures of record', before, after, 12, 'move');
    expect(said).toContain('did not move');
    expect(said).toContain('row 5');
    expect(said).not.toContain('row 6');
  });

  it('says which thing did not change — a move or a size', () => {
    const s = { x: 0, y: 0, w: 5, h: 4 };
    expect(movedWords('Through the till', s, s, 12, 'resize')).toContain('did not change size');
  });

  it('names both positions when a cutting is placed, and says nothing is kept yet', () => {
    const said = placedWords(
      'Through the till',
      { x: 0, y: 0, w: 5, h: 4 },
      { x: 4, y: 0, w: 5, h: 4 },
      12,
    );
    expect(said).toContain('placed at column 5');
    expect(said).toContain('from column 1');
    expect(said).toContain('Rule the sheet off to keep it');
  });

  it('does not pretend a cutting moved when it was placed where it started', () => {
    const s = { x: 2, y: 1, w: 5, h: 4 };
    expect(placedWords('Through the till', s, s, 12)).toContain('placed back where it was');
  });

  it('names where a cancelled move put the cutting back', () => {
    expect(cancelledWords('The room', { x: 0, y: 0, w: 6, h: 8 }, 12)).toBe(
      'Move cancelled. The room is back at column 1 of 12, row 1, 6 columns wide, 8 rows tall.',
    );
  });
});
