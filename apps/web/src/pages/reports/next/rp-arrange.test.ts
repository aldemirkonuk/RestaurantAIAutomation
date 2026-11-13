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
  liftCuttings,
  moveCutting,
  movedWords,
  pickedUpWords,
  placedWords,
  positionWords,
  projectCuttings,
  reorderCutting,
  resizeCutting,
  sameSlot,
  sheetLayouts,
  slotOf,
  slotRect,
} from './rp-arrange';
import { cloneLayout, correctBounds, getCompactor } from 'react-grid-layout/core';
import {
  DEFAULT_ON,
  DEFAULT_SLOTS,
  SHEET_BREAKPOINT_COLS,
  SHEET_COLS,
  SHEET_MIN_H,
  SHEET_MIN_W,
  type Cutting,
} from './rp-sheet';

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

  it('moves past its neighbour on one arrow press, both ways', () => {
    // Before 2026-11-11 a one-row nudge into a taller neighbour was pushed
    // back by compaction, so ArrowUp/ArrowDown never moved anything.
    const cs: Cutting[] = [
      { id: 'till', slot: { x: 0, y: 0, w: 6, h: 9 }, graph: 'area' },
      { id: 'ledger', slot: { x: 0, y: 9, w: 6, h: 4 }, graph: 'table' },
    ];
    const up = moveCutting(cs, 'ledger', 0, -1, 12);
    expect(slotOf(up, 'ledger')).toEqual({ x: 0, y: 0, w: 6, h: 4 });
    expect(slotOf(up, 'till')).toEqual({ x: 0, y: 4, w: 6, h: 9 });
    const down = moveCutting(up, 'ledger', 0, 1, 12);
    expect(slotOf(down, 'ledger')).toEqual({ x: 0, y: 9, w: 6, h: 4 });
    expect(slotOf(down, 'till')).toEqual({ x: 0, y: 0, w: 6, h: 9 });
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

/**
 * One sheet, several rulings. The saved sheet is in twelfths; a phone draws a
 * projection of it. Found in the browser 2026-11-11 at 390 px: the keyboard
 * moved the saved seven-wide slot on the four-column ruling, said "column 1 of
 * 4 … 7 columns wide", and every arrow answered "did not move".
 */
describe('a narrow ruling', () => {
  /** The house sheet's opening rows: two side by side, one full width below. */
  function house(): Cutting[] {
    return [
      { id: 'reading', slot: { x: 0, y: 0, w: 7, h: 9 }, graph: 'table' },
      { id: 'till', slot: { x: 7, y: 0, w: 5, h: 9 }, graph: 'area' },
      { id: 'writing', slot: { x: 0, y: 9, w: 12, h: 3 }, graph: 'table' },
    ];
  }

  it('draws every cutting inside the ruling, the way the grid does', () => {
    const drawn = projectCuttings(house(), 4);
    for (const c of drawn) {
      expect(c.slot.x + c.slot.w).toBeLessThanOrEqual(4);
    }
    expect(slotOf(drawn, 'reading')).toEqual({ x: 0, y: 0, w: 4, h: 9 });
    // Side by side on the wide sheet, one above the other here, left first.
    expect(slotOf(drawn, 'till')).toEqual({ x: 0, y: 9, w: 4, h: 9 });
    expect(slotOf(drawn, 'writing')).toEqual({ x: 0, y: 18, w: 4, h: 3 });
  });

  it('leaves the full ruling alone — the sheet IS the layout there', () => {
    const cs = house();
    expect(projectCuttings(cs, 12)).toBe(cs);
  });

  it('announces the square the reader can see, never the saved twelfths', () => {
    const slot = slotOf(projectCuttings(house(), 4), 'reading')!;
    const said = pickedUpWords('The reading', slot, 4);
    expect(said).toContain('column 1 of 4');
    expect(said).toContain('4 columns wide');
    expect(said).not.toContain('7 columns wide');
  });

  it('lets a held cutting actually move on the phone ruling', () => {
    const cs = house();
    // One press of ArrowUp: one place earlier in the narrow reading order.
    const next = reorderCutting(cs, 'writing', -1);
    const view = projectCuttings(next, 4);
    expect(slotOf(view, 'writing')!.y).toBeLessThan(slotOf(projectCuttings(cs, 4), 'writing')!.y);
    // …and the wide sheet is not touched at all.
    for (const c of cs) expect(slotOf(next, c.id)).toEqual(c.slot);
  });

  it('moves up past a cutting the wide sheet holds lower, at four columns', () => {
    // The house sheet on a tablet: Spend pacing sits under Against ourselves.
    // On twelve columns pacing (x0) cannot rise beside bench (x7) — goals is
    // in the way — so no wide rearrangement short of moving goals could say
    // "pacing first". The list can.
    const cs = DEFAULT_ON.map((id) => ({ id, slot: { ...DEFAULT_SLOTS[id] } }));
    const view = (xs: typeof cs) =>
      [...projectCuttings(xs, 4)].sort((p, q) => p.slot.y - q.slot.y).map((c) => c.id);
    expect(view(cs).indexOf('pacing')).toBe(view(cs).indexOf('bench') + 1);
    const next = reorderCutting(cs, 'pacing', -1);
    expect(view(next).indexOf('pacing')).toBe(view(next).indexOf('bench') - 1);
    for (const c of cs) expect(slotOf(next, c.id)).toEqual(c.slot);
    expect(reorderCutting(cs, 'reading', -1)).toBe(cs);
    expect(reorderCutting(cs, 'writing', 1)).toBe(cs);
  });

  it('re-reads the list in the wide reading order after a move on the full ruling', () => {
    const cs = reorderCutting(house(), 'writing', -1); // phone order: reading, writing, till
    const moved = moveCutting(cs, 'writing', 0, -1, 12);
    const next = liftCuttings(cs, cs, moved, 12);
    expect(next.map((c) => c.id)).toEqual(['writing', 'reading', 'till']);
  });

  it('gives the wide sheet back unchanged when nothing moved', () => {
    const cs = house();
    const drawn = projectCuttings(cs, 4);
    expect(liftCuttings(cs, drawn, drawn, 4)).toBe(cs);
  });

  it('rebuilds the wide arrangement from the narrow rows when only a height changed', () => {
    const cs = house();
    const drawn = projectCuttings(cs, 4);
    const taller = resizeCutting(drawn, 'writing', 0, 2, 4);
    const lifted = liftCuttings(cs, drawn, taller, 4);
    expect(slotOf(lifted, 'reading')).toEqual({ x: 0, y: 0, w: 7, h: 9 });
    expect(slotOf(lifted, 'till')).toEqual({ x: 7, y: 0, w: 5, h: 9 });
    expect(slotOf(lifted, 'writing')).toEqual({ x: 0, y: 9, w: 12, h: 5 });
  });

  it('never widens a cutting the reader narrowed, and never leaves the paper', () => {
    const cs = house();
    const drawn = projectCuttings(cs, 4);
    const narrower = resizeCutting(drawn, 'reading', -1, 0, 4);
    const lifted = liftCuttings(cs, drawn, narrower, 4);
    const r = slotOf(lifted, 'reading')!;
    expect(r.w).toBeLessThan(7);
    expect(r.w).toBeGreaterThanOrEqual(SHEET_MIN_W);
    for (const c of lifted) expect(c.slot.x + c.slot.w).toBeLessThanOrEqual(SHEET_COLS);
  });

  it('takes the same fraction of the paper when moved sideways on a six-column ruling', () => {
    const cs: Cutting[] = [{ id: 'till', slot: { x: 0, y: 0, w: 4, h: 4 }, graph: 'area' }];
    const drawn = projectCuttings(cs, 6);
    const moved = moveCutting(drawn, 'till', 1, 0, 6);
    expect(slotOf(liftCuttings(cs, drawn, moved, 6), 'till')).toEqual({ x: 2, y: 0, w: 4, h: 4 });
  });

  it('keeps a phone drag that puts a row-mate first as list order, not wide rows', () => {
    // The pointer path: the grid hands back the dragged projection. `till`
    // shares a row with `reading` on the wide sheet; the drag puts it first:
    // the list order changes, the wide sheet's squares do not.
    const cs = house();
    const drawn = projectCuttings(cs, 4);
    const before = slotOf(drawn, 'till')!;
    const moved = moveCutting(drawn, 'till', 0, -1, 4);
    const next = liftCuttings(cs, drawn, moved, 4);
    const after = slotOf(projectCuttings(next, 4), 'till')!;
    expect(after.y).toBe(0);
    expect(movedWords('Through the till', before, after, 4, 'move')).toContain('is now at column 1 of 4, row 1');
    expect(next.map((c) => c.id)).toEqual(['till', 'reading', 'writing']);
    expect(slotOf(next, 'till')).toEqual({ x: 7, y: 0, w: 5, h: 9 });
    expect(slotOf(next, 'reading')).toEqual({ x: 0, y: 0, w: 7, h: 9 });
    expect(slotOf(next, 'writing')).toEqual({ x: 0, y: 9, w: 12, h: 3 });
  });

  it('draws the order the list gives, whatever the wide columns', () => {
    // On the six-column ruling a 4-wide cutting at wide column 8 is clamped to
    // column 3; it still comes first when the list puts it first.
    const cs: Cutting[] = [
      { id: 'reading', slot: { x: 0, y: 0, w: 8, h: 6 }, graph: 'table' },
      { id: 'till', slot: { x: 8, y: 0, w: 4, h: 6 }, graph: 'area' },
    ];
    const view = projectCuttings(reorderCutting(cs, 'till', -1), 6);
    expect(slotOf(view, 'till')!.y).toBe(0);
    expect(slotOf(view, 'reading')!.y).toBe(6);
  });

  it('says so when a cutting at the top is pushed further up', () => {
    const cs = house();
    const drawn = projectCuttings(cs, 4);
    expect(moveCutting(drawn, 'reading', 0, -1, 4)).toBe(drawn);
  });

  it('hands each ruling a layout the grid draws exactly as handed, read or arranged', () => {
    // The house sheet, as the grid receives it. `correctBounds` then `compact`
    // is what react-grid-layout runs on it; static (arrange off) used to push
    // the right column below the left one on a phone.
    const cs = DEFAULT_ON.map((id) => ({ id, slot: { ...DEFAULT_SLOTS[id] } }));
    const wide = [...cs].sort((a, b) => a.slot.y - b.slot.y || a.slot.x - b.slot.x).map((c) => c.id);
    const compactor = getCompactor('vertical', false, false);
    for (const arranging of [false, true]) {
      const layouts = sheetLayouts(cs, arranging);
      for (const bp of Object.keys(SHEET_BREAKPOINT_COLS) as (keyof typeof SHEET_BREAKPOINT_COLS)[]) {
        const cols = SHEET_BREAKPOINT_COLS[bp];
        if (cols >= SHEET_COLS) continue; // the full ruling is the sheet itself
        const given = layouts[bp];
        const drawn = compactor.compact(correctBounds(cloneLayout(given), { cols }), cols);
        expect(drawn.map(({ i, x, y, w, h }) => ({ i, x, y, w, h }))).toEqual(
          given.map(({ i, x, y, w, h }) => ({ i, x, y, w, h })),
        );
        const order = [...drawn].sort((a, b) => a.y - b.y || a.x - b.x).map((l) => l.i);
        expect(order).toEqual(wide);
      }
    }
  });
});
