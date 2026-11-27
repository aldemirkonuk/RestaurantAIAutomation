/** r109 drinks-g2: batch for a bottle. The bottle is never over-filled, as figured or as printed. */
import { describe, expect, it } from 'vitest';
import { batchAtService, batchHead, batchParts, bottleWords, planBatch, readBottle, readWater, type BatchLine } from './recipeBatch';

const ml = (id: string, n: number, unitCode = 'ml', qtyBase = n * 10): BatchLine => ({ id, name: id, qtyEntered: n, unitCode, qtyBase, baseUnit: 'ml10' });
const negroni = [ml('Gin', 30), ml('Campari', 30), ml('Vermouth', 30)];
const none = new Set<string>();

const plan = (lines: BatchLine[], p: number, c: number, out = none, yieldServes = 1) => {
  const a = planBatch(lines, yieldServes, out, p, c);
  if (a.kind !== 'plan') throw new Error(`no plan: ${a.kind}`);
  return a.plan;
};

describe('planBatch', () => {
  it('Negroni 30/30/30 stirred at 20% in 1 l: 9 serves, a 108 ml pour, 270 x 3 and 162 water', () => {
    const p = plan(negroni, 20, 1000);
    expect(p.serves).toBe(9);
    expect(Math.round(p.pourMl)).toBe(108);
    expect(p.parts.map((x) => x.ml)).toEqual([270, 270, 270]);
    expect(p.waterMl).toBe(162);
    expect(p.spareMl).toBe(28);
    expect(batchHead(p)).toBe('1 l bottle: 9 serves, pour 108 ml.');
    expect(batchParts(p)).toBe('Gin 270 ml, Campari 270 ml, Vermouth 270 ml, Water 162 ml. 28 ml spare.');
  });

  it('an oz line is batched by its ml and says its typed amount beside it', () => {
    // 1.5 US oz is 44.4 ml as the gateway stores it (444 tenths).
    const p = plan([ml('Rye', 1.5, 'oz', 444)], 0, 700);
    expect(p.serves).toBe(15);
    expect(p.parts[0]).toMatchObject({ ml: 666, typed: '22.5 US oz' });
  });

  it('a soda line left out is not in the bottle and is said as added at service, per serve', () => {
    const lines = [ml('Gin', 50), ml('Soda', 100), { id: 'Lime', name: 'Lime', qtyEntered: 1, unitCode: 'each', qtyBase: 1000, baseUnit: 'each_milli' }];
    const p = plan(lines, 0, 750, new Set(['Soda']));
    expect(p.serves).toBe(15);
    expect(p.parts.map((x) => x.id)).toEqual(['Gin']);
    expect(batchAtService(p)).toBe('Add at service, each serve: Soda 100 ml, Lime 1 each.');
  });

  it('a recipe that makes 4 is batched per serve', () => {
    expect(plan([ml('Punch', 400)], 0, 1000, none, 4).serves).toBe(10);
  });

  it('floors, never rounds: 7 serves of a 133.3 ml pour, each part down to a whole ml', () => {
    const p = plan([ml('A', 33.3, 'ml', 333), ml('B', 100)], 0, 1000);
    expect(p.serves).toBe(7);
    expect(p.parts.map((x) => x.ml)).toEqual([233, 700]);
    expect(p.spareMl).toBe(67);
  });

  it('says when nothing is batched by volume, and when one pour is more than the bottle', () => {
    expect(planBatch([ml('Soda', 100)], 1, new Set(['Soda']), 0, 700).kind).toBe('nothing');
    expect(planBatch([ml('Big', 800)], 1, none, 0, 700)).toMatchObject({ kind: 'too-big', pourMl: 800 });
  });

  it('never over-fills: 200 random recipes, figured and printed', () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
    for (let k = 0; k < 200; k++) {
      const lines = Array.from({ length: 1 + Math.floor(rnd() * 6) }, (_, i) => ml(`l${i}`, 0, 'ml', 1 + Math.floor(rnd() * 900)));
      const p = Math.round(rnd() * 400) / 10;
      const c = [700, 750, 1000, 1750, 1 + Math.floor(rnd() * 5000)][Math.floor(rnd() * 5)];
      const y = 1 + Math.floor(rnd() * 3);
      const a = planBatch(lines, y, none, p, c);
      if (a.kind !== 'plan') continue;
      const printed = a.plan.parts.reduce((s, x) => s + x.ml, 0) + a.plan.waterMl;
      expect(a.plan.serves * a.plan.pourMl).toBeLessThanOrEqual(c + 1e-9);
      expect(printed).toBeLessThanOrEqual(c);
      expect(a.plan.spareMl).toBe(c - printed);
      expect((a.plan.serves + 1) * a.plan.pourMl).toBeGreaterThan(c);
    }
  });
});

describe('the boxes', () => {
  it('water reads 0 to 40 in either mark; a bottle is whole ml', () => {
    expect(readWater('12,5')).toBe(12.5);
    expect(readWater('41')).toBeNull();
    expect(readBottle('900')).toBe(900);
    expect(readBottle('0')).toBeNull();
    expect(readBottle('1.5')).toBeNull();
  });
  it('names the bottle', () => {
    expect([700, 750, 1000, 1750, 905].map(bottleWords)).toEqual(['70 cl', '75 cl', '1 l', '1.75 l', '905 ml']);
  });
});
