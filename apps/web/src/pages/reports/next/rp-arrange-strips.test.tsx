/**
 * A strip folds to 72 px but the cuttings are static while reading, so nothing
 * rises into the rows it gives back: a strip beside a tall card left a blank
 * block the strip's width. While reading, strips run the full width and the
 * cards are re-set around them, with no cell of the ruling left uncovered.
 */
import { describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import type { ReactNode } from 'react';

const grid = vi.hoisted(() => ({ layouts: [] as Record<string, unknown>[] }));

vi.mock('react-grid-layout/legacy', () => ({
  Responsive: (props: Record<string, unknown>) => {
    grid.layouts.push(props.layouts as Record<string, unknown>);
    return <div data-testid="grid">{props.children as ReactNode}</div>;
  },
}));

import Sheet from './Sheet';
import { flowStrips, sheetLayouts } from './rp-arrange';
import { DEFAULT_ON, DEFAULT_SLOTS, outlineSlots, type AnalysisId, type Slot } from './rp-sheet';
import { STRIP_ROWS } from './rp-strip';

const house = (strips: AnalysisId[]) =>
  DEFAULT_ON.map((id) => {
    const strip = strips.includes(id);
    return {
      id,
      strip,
      slot: strip ? { ...DEFAULT_SLOTS[id], h: STRIP_ROWS } : DEFAULT_SLOTS[id],
    };
  });

/** Cells of the 12-column ruling inside the sheet's height that no cutting covers. */
function holes(slots: Slot[]): number {
  const rows = Math.max(...slots.map((s) => s.y + s.h));
  let empty = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < 12; c++) {
      if (!slots.some((s) => c >= s.x && c < s.x + s.w && r >= s.y && r < s.y + s.h)) empty++;
    }
  }
  return empty;
}

function overlaps(slots: Slot[]): boolean {
  return slots.some((a, i) =>
    slots.some(
      (b, j) => i < j && a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h,
    ),
  );
}

const lgSlots = (strips: AnalysisId[]): Slot[] =>
  sheetLayouts(house(strips), false).lg.map(({ x, y, w, h }) => ({ x, y, w, h }));

describe('the sheet while reading, with strips', () => {
  it('[REVERT-FAILS] the house sheet leaves no blank cell when the till folds beside the reading', () => {
    const slots = lgSlots(['till']);
    expect(holes(slots)).toBe(0);
    expect(overlaps(slots)).toBe(false);
  });

  it('[REVERT-FAILS] leaves no blank cell for any one, two or three strips on the house sheet', () => {
    const ids = DEFAULT_ON;
    for (const a of ids) {
      expect(holes(lgSlots([a]))).toBe(0);
      for (const b of ids) {
        if (b <= a) continue;
        expect(holes(lgSlots([a, b]))).toBe(0);
        for (const c of ids) {
          if (c <= b) continue;
          const slots = lgSlots([a, b, c]);
          expect(holes(slots)).toBe(0);
          expect(overlaps(slots)).toBe(false);
        }
      }
    }
  });

  it('[REVERT-FAILS] a strip spans all twelve columns at its folded height', () => {
    const layout = sheetLayouts(house(['till', 'week']), false).lg;
    for (const id of ['till', 'week']) {
      const l = layout.find((i) => i.i === id)!;
      expect([l.x, l.w, l.h]).toEqual([0, 12, STRIP_ROWS]);
    }
  });

  it('no strip: the sheet is handed over exactly as it was', () => {
    const cuttings = house([]);
    expect(flowStrips(cuttings)).toBe(cuttings);
    expect(sheetLayouts(cuttings, false).lg.map((l) => [l.i, l.x, l.y, l.w, l.h])).toEqual(
      outlineSlots().map(({ id, slot }) => [id, slot.x, DEFAULT_SLOTS[id].y, slot.w, slot.h]),
    );
  });

  it('arranging gives every cutting its own slot back, strips or not', () => {
    const cuttings = house(['till']);
    const lg = sheetLayouts(cuttings, true).lg;
    expect(lg.find((l) => l.i === 'till')).toMatchObject({ x: 4, w: 8 });
  });

  it('the narrower rulings do not read the strip flag', () => {
    const a = sheetLayouts(house(['till']), false);
    const b = sheetLayouts(house([]).map((c) => (c.id === 'till' ? { ...c, slot: { ...c.slot, h: STRIP_ROWS } } : c)), false);
    expect(a.sm).toEqual(b.sm);
    expect(a.xs).toEqual(b.xs);
  });

  it('the grid is handed the flowed layout', () => {
    grid.layouts = [];
    const spy = vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1100);
    render(
      <Sheet
        arranging={false}
        onMove={() => {}}
        cuttings={house(['till']).map((c) => ({ ...c, body: <p>{c.id}</p> }))}
      />,
    );
    spy.mockRestore();
    const lg = grid.layouts.at(-1)!.lg as { i: string; x: number; w: number }[];
    expect(lg.find((l) => l.i === 'till')).toMatchObject({ x: 0, w: 12 });
  });
});
