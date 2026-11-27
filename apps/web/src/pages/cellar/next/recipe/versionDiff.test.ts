/** r109 drinks-g4: what an earlier version differs by from the current one. */
import { describe, expect, it } from 'vitest';
import type { RecipeLine } from '../../../../services/api/recipes';
import { NO_COST_DIFFERENCE, costDifference, diffLines, diffMeta, foldName } from './versionDiff';

let pos = 0;
const L = (label: string, qty: number, extra: Partial<RecipeLine> & { usablePct?: number | null } = {}) => ({
  role: 'stocked' as const, inventoryId: null, componentId: null, componentName: null, label, itemName: null, qtyEntered: qty, unitCode: 'ml', position: pos++, ...extra,
});
const gin = (qty = 50, id = 'g1', name = 'Plymouth gin') => L('gin', qty, { inventoryId: id, itemName: name });
const kinds = (d: { kind: string }[]) => d.map((x) => x.kind);

describe('diffLines', () => {
  it('says an amount change as "Gin 50 ml, now 45 ml"', () => {
    expect(diffLines([gin(50)], [gin(45)])).toEqual([{ kind: 'changed', text: 'Plymouth gin 50 ml, now 45 ml' }]);
  });

  it('a swapped good reads as changed, not removed and added', () => {
    const d = diffLines([gin(50), L('Campari', 30, { inventoryId: 'c1', itemName: 'Campari' })], [gin(50, 'g2', 'Tanqueray gin'), L('Campari', 30, { inventoryId: 'c1', itemName: 'Campari' })]);
    expect(d).toEqual([{ kind: 'changed', text: 'Plymouth gin 50 ml, now Tanqueray gin' }, { kind: 'same', text: 'Campari 30 ml' }]);
  });

  it('lines moved to another place are the same lines, not changed: pairs by what they draw, never by position alone', () => {
    const a = [gin(50), L('Vermouth', 30, { inventoryId: 'v1', itemName: 'Vermouth' })];
    const b = [L('Vermouth', 30, { inventoryId: 'v1', itemName: 'Vermouth' }), gin(50)];
    expect(kinds(diffLines(a, b))).toEqual(['same', 'same']);
  });

  it('a good on two lines pairs in position order', () => {
    const d = diffLines([gin(20), gin(30)], [gin(20), gin(35)]);
    expect(d).toEqual([{ kind: 'same', text: 'Plymouth gin 20 ml' }, { kind: 'changed', text: 'Plymouth gin 30 ml, now 35 ml' }]);
  });

  it('unlinked and untracked lines pair by folded name; leftovers are added or taken out', () => {
    const d = diffLines(
      [L('Şeker şurubu', 10, { role: 'untracked' }), L('Soda', 60, { role: 'untracked' })],
      [L('  seker  SURUBU', 10, { role: 'untracked' }), L('Lime juice', 25, { role: 'made', componentId: 'm1', componentName: 'House lime' })],
    );
    expect(d).toEqual([
      { kind: 'same', text: 'Şeker şurubu 10 ml' },
      { kind: 'removed', text: 'Taken out since: Soda 60 ml' },
      { kind: 'added', text: 'Added since: House lime 25 ml' },
    ]);
    expect(foldName(' İSOT  Biber ')).toBe('isot biber');
  });

  it('says a usable share and a counted switch that changed', () => {
    expect(diffLines([gin(50, 'g1', 'Limes')].map((l) => ({ ...l, usablePct: 45 })), [gin(50, 'g1', 'Limes')])).toEqual([
      { kind: 'changed', text: 'Limes: usable share 45%, now all of it' },
    ]);
    expect(diffLines([L('Soda', 60)], [L('Soda', 60, { role: 'untracked' })])[0].text).toBe('Soda: now not counted');
  });

  // r100 P3: a line whose link or counted state changed pairs with itself by its label, never reads as taken out and added.
  it('a linked line marked not counted is one change, not one taken out and one added', () => {
    const d = diffLines([gin(50)], [L('gin', 50, { role: 'untracked' })]);
    expect(d).toEqual([{ kind: 'changed', text: 'gin: now not counted' }]);
  });

  it('an untracked line that is now counted and linked is one change', () => {
    const d = diffLines([L('soda', 60, { role: 'untracked' })], [L('soda', 60, { inventoryId: 's1', itemName: 'Soda water' })]);
    expect(d).toEqual([{ kind: 'changed', text: 'Soda water: now counted' }]);
  });

  it('a loose line that was linked while another stocked line was added above it is not paired with the wrong good', () => {
    const was = [gin(50, 'g1', 'Gin'), L('lime juice', 25)];
    const now = [gin(50, 'g1', 'Gin'), L('syrup', 15, { inventoryId: 's1', itemName: 'Sugar Syrup' }), L('lime juice', 25, { inventoryId: 'lj', itemName: 'Lime Juice' })];
    const d = diffLines(was, now);
    expect(d).toEqual([
      { kind: 'same', text: 'Gin 50 ml' },
      { kind: 'changed', text: 'lime juice 25 ml, now Lime Juice' },
      { kind: 'added', text: 'Added since: Sugar Syrup 15 ml' },
    ]);
  });
});

describe('diffMeta and costDifference', () => {
  const v = { yieldServes: 1, glass: 'Coupe', garnish: null, method: 'Stir' };
  it('says serves, glass, garnish and method', () => {
    expect(diffMeta({ ...v, lines: [] }, { yieldServes: 4, glass: 'Rocks', garnish: 'Orange', method: 'Shake', lines: [] }, 'serve')).toEqual([
      'Makes 1 serves, now 4', 'Glass Coupe, now Rocks', 'Garnish none, now Orange', 'The method is worded differently',
    ]);
    expect(diffMeta({ ...v, lines: [] }, { ...v, glass: 'Rocks', lines: [] }, 'plate')).toEqual([]);
  });

  const c = (perServeExact: number, complete = true) => ({ perServe: Math.round(perServeExact * 100) / 100, perServeExact, priced: 2, of: complete ? 2 : 3, complete });
  const say = (n: number) => `£${n.toFixed(2)}`;
  it('says the difference only when both costs are complete', () => {
    expect(costDifference(c(1.004), c(1.124), say, 'serve')).toBe("£0.12 less a serve than the current, at today's prices.");
    expect(costDifference(c(2), c(1.5), say, 'plate')).toBe("£0.50 more a plate than the current, at today's prices.");
    expect(costDifference(c(1.004, false), c(1.124), say, 'serve')).toBe(NO_COST_DIFFERENCE);
    expect(costDifference(c(1), null, say, 'serve')).toBe(NO_COST_DIFFERENCE);
  });
});
