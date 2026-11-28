import { dilutionFor, rollup, RollupInput } from './taste-rollup';

const whiskeySour: RollupInput = {
  kind: 'cocktail', method: 'Shake with ice, strain',
  components: [{ name: 'drink', lines: [
    { name: 'Bourbon', qty: 60, unit: 'ml' }, { name: 'Lemon juice', qty: 22.5, unit: 'ml' },
    { name: '1:1 simple syrup', qty: 15, unit: 'ml' },
  ] }],
};
const kofta: RollupInput = {
  kind: 'dish',
  components: [
    { name: 'kofta', lines: [{ name: 'Lamb mince', qty: 150, unit: 'g', prep: 'seared' }, { name: 'Salt', qty: 1.2, unit: 'g' }] },
    { name: 'garlic yogurt', lines: [{ name: 'Yogurt', qty: 60, unit: 'g' }] },
    { name: 'tomato', lines: [{ name: 'Tomato', qty: 50, unit: 'g', prep: 'charred' }] },
  ],
};
const near = (got: number, want: number, tol: number) => expect(Math.abs(got - want)).toBeLessThanOrEqual(tol);

describe('rollup: a cocktail (R3 section 4, whiskey sour)', () => {
  const r = rollup(whiskeySour);
  it('lands on the worked example within a band', () => {
    near(r.axes.sweet.v, 3.8, 0.4);
    near(r.axes.sour.v, 6.2, 0.4);
    near(r.axes.bitter.v, 1.4, 0.4);
    // R3 used the label's 45 %; the class prior for a dark spirit is 40 %, so the warmth reads lower.
    near(r.axes.alcohol.v, 3.6, 0.4);
  });
  it('reaches the worked example\'s 4.4 warmth once the bottle\'s own 45 % is stated', () => {
    const lines = [...whiskeySour.components[0].lines];
    lines[0] = { name: 'Bourbon', qty: 60, unit: 'ml', chem: { abv: 45, be: 10 }, chemProv: 'dataset' };
    near(rollup({ ...whiskeySour, components: [{ name: 'drink', lines }] }).axes.alcohol.v, 4.4, 0.3);
  });
  it('says a shaken drink is watered by about a quarter, and that it was read, not assumed', () => {
    expect(r.basis.dilution).toBeCloseTo(0.27, 2);
    expect(r.basis.dilutionAssumed).toBe(false);
  });
  it('is tart-leaning and has oak and citrus on the nose', () => {
    expect(r.axes.sour.v).toBeGreaterThan(r.axes.sweet.v);
    expect(r.axes.woody.v).toBeGreaterThan(5);
    near(r.axes.citrus.v, 4, 0.8);
  });
  it('states a typed zero for fat, because every line is understood', () => {
    expect(r.axes.fat.v).toBe(0);
  });
  it('gives the same interval twice and an interval that holds the value', () => {
    expect(rollup(whiskeySour)).toEqual(r);
    for (const a of Object.values(r.axes)) {
      expect(a.lo).toBeLessThanOrEqual(a.v + 0.05);
      expect(a.hi).toBeGreaterThanOrEqual(a.v - 0.05);
    }
  });
  it('waters the drink: dropping dilution raises sour and alcohol', () => {
    const neat = rollup({ ...whiskeySour, method: 'neat' });
    expect(neat.axes.sour.v).toBeGreaterThan(r.axes.sour.v);
    expect(neat.axes.alcohol.v).toBeGreaterThan(r.axes.alcohol.v);
  });
  it('assumes a quarter when the method says nothing, and says it assumed', () => {
    expect(dilutionFor('cocktail', null)).toEqual({ d: 0.25, sd: 0.08, assumed: true });
    expect(dilutionFor('dish', 'shake')).toEqual({ d: 0, sd: 0, assumed: false });
  });
  it('never claims the certainty of a measurement from class priors alone', () => {
    for (const a of Object.values(r.axes)) {
      expect(a.conf).toBeLessThanOrEqual(0.6);
      expect(a.sd).toBeGreaterThanOrEqual(1.2);
    }
  });
  it('lets a measured value win and narrow the interval', () => {
    const measured = rollup({ ...whiskeySour, components: [{ name: 'drink', lines: [
      whiskeySour.components[0].lines[0],
      { name: 'Lemon juice', qty: 22.5, unit: 'ml', chem: { ce: 6.0, se: 2.5 }, chemProv: 'measured' },
      { name: '1:1 simple syrup', qty: 15, unit: 'ml', chem: { se: 61.5 }, chemProv: 'measured' },
    ] }] });
    expect(measured.axes.sour.conf).toBeGreaterThan(0.9); // lemon alone drives sour, and it was measured
    expect(measured.axes.sour.conf).toBeGreaterThan(r.axes.sour.conf);
    expect(measured.axes.sour.hi - measured.axes.sour.lo).toBeLessThan(r.axes.sour.hi - r.axes.sour.lo);
    expect(measured.basis.measured).toBe(2);
  });
});

describe('rollup: a dish (R3 section 5, seared kofta, garlic yogurt, charred tomato)', () => {
  const r = rollup(kofta);
  it('lands on the worked example peaks within a band', () => {
    // R3's 5.5 used salty k 0.9; r92 recalibrated k to 1.4 (well-seasoned food reads medium), which puts this dish (0.8 % salt on the raw meat, shared with yogurt and tomato) at 3.6.
    near(r.axes.salty.v, 3.6, 0.5);
    near(r.axes.umami.v, 6.4, 1.2);
    near(r.axes.fat.v, 7.1, 0.8);
    near(r.axes.sour.v, 3.7, 0.8);
  });
  it('keeps the smoke in the garnish: peak is above the mean bite', () => {
    expect(r.axes.smoky.v).toBeGreaterThan(r.basis.mean.smoky + 1);
    expect(r.basis.contrast.smoky).toBeGreaterThan(1);
  });
  it('is rich and savoury, not sweet', () => {
    expect(r.axes.fat.v).toBeGreaterThan(r.axes.sweet.v + 4);
    expect(r.axes.sweet.v).toBeLessThan(2);
  });
  it('takes up fat when fried, and tastes bitter from char but not from plain cooking', () => {
    const one = (name: string, prep?: string): RollupInput => ({ kind: 'dish', components: [{ name: 'x', lines: [{ name, qty: 100, unit: 'g', prep }] }] });
    expect(rollup(one('Chicken', 'fried')).axes.fat.v).toBeGreaterThan(rollup(one('Chicken')).axes.fat.v + 1);
    expect(rollup(one('Tomato', 'charred')).axes.bitter.v).toBeGreaterThan(rollup(one('Tomato', 'roasted')).axes.bitter.v + 0.8);
  });
  it('has no dilution, and no certainty above what a class prior can give', () => {
    expect(r.basis.dilution).toBeNull();
    for (const a of Object.values(r.axes)) expect(a.conf).toBeLessThanOrEqual(0.6);
  });
});

describe('rollup: what it does not know', () => {
  const withMore = (extra: RollupInput['components'][0]['lines']): RollupInput => ({
    ...whiskeySour, components: [{ name: 'drink', lines: [...whiskeySour.components[0].lines, ...extra] }],
  });
  it('lowers confidence for a line of unknown chemistry, and names it', () => {
    const base = rollup(whiskeySour);
    const r = rollup(withMore([{ name: 'House shrub 7', qty: 20, unit: 'ml' }]));
    expect(r.basis.unknown).toBe(1);
    expect(r.basis.unknownNames).toEqual(['House shrub 7']);
    expect(r.axes.sour.conf).toBeLessThan(base.axes.sour.conf);
    expect(r.axes.sour.sd).toBeGreaterThan(base.axes.sour.sd);
  });
  it('does not state a zero it cannot stand behind', () => {
    expect(rollup(withMore([{ name: 'House shrub 7', qty: 20, unit: 'ml' }])).axes.fat).toBeUndefined();
  });
  it('leaves a quantity-less line out and lowers confidence for it', () => {
    const base = rollup(whiskeySour);
    const r = rollup(withMore([{ name: 'Salt', qty: null, unit: 'g' }]));
    expect(r.basis.unquantified).toBe(1);
    expect(r.axes.salty?.v ?? 0).toBeLessThan(0.5);
    expect(r.axes.sweet.conf).toBeLessThan(base.axes.sweet.conf);
  });
  it('treats ice as a known zero, and an accent-folded name as its class', () => {
    const r = rollup(withMore([{ name: 'Ice', qty: 50, unit: 'g' }, { name: 'Yoğurt', qty: 5, unit: 'g' }, { name: 'Sarımsak', qty: 2, unit: 'g' }]));
    expect(r.basis.unknown).toBe(0);
    expect(r.basis.classPrior).toBe(6);
  });
  it('stays inside 0..10 and finite for silly input', () => {
    const r = rollup({ kind: 'dish', components: [{ name: 'x', lines: [{ name: 'Salt', qty: 1e6, unit: 'g' }, { name: 'Oil', qty: 1e6, unit: 'g', prep: 'fried' }] }] });
    for (const a of Object.values(r.axes)) {
      for (const n of [a.v, a.lo, a.hi, a.sd, a.conf]) expect(Number.isFinite(n)).toBe(true);
      expect(a.v).toBeGreaterThanOrEqual(0);
      expect(a.v).toBeLessThanOrEqual(10);
    }
  });
  it('gives an empty recipe no axes at all, not zeros', () => {
    expect(rollup({ kind: 'dish', components: [{ name: 'x', lines: [] }] }).axes).toEqual({});
  });
});

describe('rollup: salt and bitter read as a cook would (r92)', () => {
  const potato = (salt: number) => rollup({ kind: 'dish', components: [{ name: 'x', lines: [{ name: 'Potato', qty: 100 - salt, unit: 'g' }, { name: 'Salt', qty: salt, unit: 'g' }] }] }).axes.salty.v;
  it('a dish at 1.2 % salt is medium, 2 % pronounced, 3 % dominant', () => {
    near(potato(1.2), 5, 0.8); near(potato(2), 6.9, 0.8);
    expect(potato(3)).toBeGreaterThanOrEqual(8);
  });
  it('gin at 40 % diluted 3:1 keeps a medium bitter when staff said bitter 6', () => {
    const r = rollup({ kind: 'cocktail', method: 'neat', components: [{ name: 'd', lines: [{ name: 'Gin', qty: 75, unit: 'ml', own: { prov: 'staff', axes: { bitter: { v: 6 } } } }, { name: 'Water', qty: 25, unit: 'ml' }] }] });
    near(r.axes.bitter.v, 5, 0.8);
  });
});
