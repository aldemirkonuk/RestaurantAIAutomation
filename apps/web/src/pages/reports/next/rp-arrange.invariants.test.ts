import { describe, expect, it } from 'vitest';
import {
  liftCuttings,
  moveCutting,
  projectCuttings,
  reorderCutting,
  resizeCutting,
  clearOverlaps,
} from './rp-arrange';
import { DEFAULT_SLOTS, packSlots, swapSlot, SHEET_COLS, SHEET_MIN_H, SHEET_MIN_W, type AnalysisId, type Slot } from './rp-sheet';

type P = { id: AnalysisId; slot: Slot };
const IDS = ['reading', 'till', 'goals', 'bench', 'pacing', 'week', 'ahead'] as unknown as AnalysisId[];

function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}
const overlap = (a: Slot, b: Slot) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

function check(cs: P[], cols: number, ids: AnalysisId[], why: string) {
  expect(cs.map((c) => c.id).sort(), why).toEqual([...ids].sort());
  for (const c of cs) {
    expect(c.slot.x, `${why} x`).toBeGreaterThanOrEqual(0);
    expect(c.slot.y, `${why} y`).toBeGreaterThanOrEqual(0);
    expect(c.slot.x + c.slot.w, `${why} right edge ${c.id}`).toBeLessThanOrEqual(cols);
    expect(c.slot.w, `${why} w`).toBeGreaterThanOrEqual(Math.min(SHEET_MIN_W, cols));
    expect(c.slot.h, `${why} h`).toBeGreaterThanOrEqual(SHEET_MIN_H);
  }
  for (let i = 0; i < cs.length; i++)
    for (let j = i + 1; j < cs.length; j++)
      expect(overlap(cs[i].slot, cs[j].slot), `${why} overlap ${cs[i].id}/${cs[j].id}`).toBe(false);
}

describe('arrange invariants (fuzz)', () => {
  it('keeps every cutting on the paper, apart, and present', () => {
    const r = rng(7);
    for (let run = 0; run < 400; run++) {
      const n = 2 + Math.floor(r() * 6);
      const ids = IDS.slice(0, n);
      const packed = packSlots(ids);
      let cs: P[] = ids.map((id) => ({ id, slot: packed[id] }));
      check(cs, SHEET_COLS, ids, `start ${run}`);
      for (let step = 0; step < 25; step++) {
        const cols = [12, 6, 4, 2][Math.floor(r() * 4)];
        const id = ids[Math.floor(r() * n)];
        const op = Math.floor(r() * 4);
        const d = () => Math.floor(r() * 3) - 1;
        const before = JSON.stringify(cs);
        if (cols === 12) {
          cs =
            op === 0 ? moveCutting(cs, id, d(), d(), 12)
            : op === 1 ? resizeCutting(cs, id, d(), d(), 12)
            : op === 2 ? moveCutting(cs, id, d(), 0, 12)
            : resizeCutting(cs, id, d(), 0, 12);
          check(cs, 12, ids, `wide run ${run} step ${step} op ${op} from ${before}`);
        } else {
          const proj = projectCuttings(cs, cols);
          check(proj, cols, ids, `project ${cols} run ${run} from ${before}`);
          const next =
            op === 0 ? moveCutting(proj, id, d(), d(), cols)
            : op === 1 ? resizeCutting(proj, id, d(), d(), cols)
            : op === 2 ? reorderCutting(proj, id, d() === 0 ? 1 : (d() as 1 | -1))
            : moveCutting(proj, id, d(), 0, cols);
          check(next, cols, ids, `narrow ${cols} op ${op} run ${run}`);
          cs = liftCuttings(cs, proj, next, cols);
          check(cs, 12, ids, `lift ${cols} op ${op} run ${run} step ${step} from ${before}`);
        }
      }
    }
  });

  it('a swap that grows its square, once cleared, still leaves nothing laid over anything', () => {
    const r = rng(11);
    const all = Object.keys(DEFAULT_SLOTS) as AnalysisId[];
    for (let run = 0; run < 300; run++) {
      const on = all.filter(() => r() < 0.6);
      if (on.length < 2) continue;
      const packed = packSlots(on);
      let cs: P[] = on.map((id) => ({ id, slot: packed[id] }));
      for (let step = 0; step < 6; step++) {
        const from = cs[Math.floor(r() * cs.length)].id;
        const off = all.filter((id) => !cs.some((c) => c.id === id));
        if (off.length === 0) break;
        const to = off[Math.floor(r() * off.length)];
        cs = clearOverlaps(
          cs.map((c) => (c.id === from ? { id: to, slot: swapSlot(c.slot, to) } : c)),
          to,
        );
        check(cs, SHEET_COLS, cs.map((c) => c.id), `swap run ${run} step ${step}`);
      }
    }
  });
});
