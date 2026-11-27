/** `swapSlot` — the square of paper a cutting keeps when its subject is swapped (R-7). */
import { describe, expect, it } from 'vitest';
import { DEFAULT_SLOTS, SHEET_COLS, swapSlot } from './rp-sheet';

describe('swapSlot', () => {
  it('grows a strip to the new subject’s declared height', () => {
    // The 12 x 3 writing desk swapped for the goals desk (7 x 11).
    expect(swapSlot(DEFAULT_SLOTS.writing, 'goals')).toEqual({
      x: 0,
      y: DEFAULT_SLOTS.writing.y,
      w: 12,
      h: DEFAULT_SLOTS.goals.h,
    });
  });

  it('never takes room the reader gave: a bigger square keeps its size', () => {
    const big = { x: 2, y: 4, w: 10, h: 20 };
    expect(swapSlot(big, 'pacing')).toEqual(big);
  });

  it('pulls a widened square left so it stays on the ruling', () => {
    // A 4-wide square at column 8 swapped for the 12-wide restock list.
    expect(swapSlot({ x: 8, y: 0, w: 4, h: 9 }, 'restock')).toEqual({ x: 0, y: 0, w: 12, h: 9 });
    const s = swapSlot({ x: 9, y: 0, w: 3, h: 3 }, 'reading');
    expect(s.x + s.w).toBeLessThanOrEqual(SHEET_COLS);
  });
});
