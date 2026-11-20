import { bandWord } from './taste-axes';
import { GoodTaste, rollup, RollupLine } from './taste-rollup';

/** gin + lime + syrup, shaken: the worked example the walk used (R85 finding 4). */
const gimlet = (gin: Partial<RollupLine> = {}, more: RollupLine[] = []) => rollup({
  kind: 'cocktail', method: 'Shake',
  components: [{ name: 'drink', lines: [
    { name: 'Gin', qty: 50, unit: 'ml', ...gin }, { name: 'Lime juice', qty: 20, unit: 'ml' },
    { name: 'Simple syrup', qty: 15, unit: 'ml' }, ...more,
  ] }],
});
/** Staff described the house gin as bitter and juniper-led (juniper reads as the herbal family). */
const staffGin: GoodTaste = { prov: 'staff', axes: { bitter: { v: 6 }, herbal: { v: 7 } } };
const band = (r: ReturnType<typeof rollup>, k: string) => (r.axes[k] ? bandWord(r.axes[k].v) : 'absent');

describe('rollup: a line that names a good uses the good\'s own taste', () => {
  const label = gimlet();
  const layered = gimlet({ own: staffGin });
  it('a bitter, juniper gin lifts the bitter and herbal bands over the label\'s class prior', () => {
    expect(band(layered, 'bitter')).toBe('light');
    expect(band(layered, 'herbal')).toBe('medium');
    expect(band(label, 'herbal')).toBe('absent'); // the label "Gin" has no aroma in the prior
    expect(layered.axes.bitter.v).toBeGreaterThan(2);
    expect(layered.axes.herbal.v).toBeGreaterThan(4);
  });
  it('an axis the good does not state still comes from the class prior (alcohol from the label)', () => {
    expect(layered.axes.alcohol.v).toBe(label.axes.alcohol.v);
  });
  it('records which lines used the good and which used a class prior', () => {
    expect(layered.basis.lineSources).toEqual([
      { name: 'Gin', from: 'good', prov: 'staff' },
      { name: 'Lime juice', from: 'class_prior', prov: 'class_prior' },
      { name: 'Simple syrup', from: 'class_prior', prov: 'class_prior' },
    ]);
    expect(layered.basis).toMatchObject({ staff: 1, classPrior: 2 });
    expect(label.basis.lineSources.every((s) => s.from === 'class_prior')).toBe(true);
  });
  it('a measured good is believed more than a staff line', () => {
    const measured = gimlet({ own: { prov: 'measured', axes: staffGin.axes } });
    expect(measured.axes.bitter.conf).toBeGreaterThan(layered.axes.bitter.conf);
  });
  it('a good whose layer states nothing the roll-up reads is treated as the label', () => {
    const r = gimlet({ own: { prov: 'staff', axes: { body: { v: 5 } } } });
    const v = (x: typeof r) => Object.fromEntries(Object.entries(x.axes).map(([k, a]) => [k, a.v]));
    expect(v(r)).toEqual(v(label));
    expect(r.basis.lineSources[0].from).toBe('class_prior');
  });
  it('a good the label does not name still counts once it has a layer', () => {
    const r = rollup({ kind: 'cocktail', method: 'Shake', components: [{ name: 'drink', lines: [
      { name: 'House Cordial', qty: 30, unit: 'ml', own: { prov: 'dataset', axes: { sweet: { v: 7 }, sour: { v: 4 } } } },
    ] }] });
    expect(r.basis.unknown).toBe(0);
    expect(r.axes.sweet.v).toBeGreaterThan(1);
    expect(r.basis.lineSources[0]).toMatchObject({ from: 'good', prov: 'dataset' });
  });
  it('is the same twice and moves its hash when the good\'s taste moves', () => {
    expect(gimlet({ own: staffGin })).toEqual(layered);
    expect(gimlet({ own: { prov: 'staff', axes: { bitter: { v: 7 }, herbal: { v: 7 } } } }).basis.inputHash).not.toBe(layered.basis.inputHash);
  });
});

describe('rollup: an axis is "none" only when every line\'s value on it is known', () => {
  it('does not state bitter as none when the lime and syrup say nothing about bitter', () => {
    const r = gimlet();
    expect(r.axes.bitter).toBeUndefined();
    expect(r.basis.notKnown).toContain('bitter');
  });
  it('still states a zero where every line says so (fat, salt and umami in gin, lime and syrup)', () => {
    const r = gimlet();
    for (const k of ['fat', 'salty', 'umami']) expect(r.axes[k]).toMatchObject({ v: 0 });
    expect(r.basis.notKnown).not.toContain('fat');
  });
  it('a line the roll-up cannot read makes every zero unknown', () => {
    const r = gimlet({}, [{ name: 'Orgeat of the house', qty: 10, unit: 'ml' }]);
    for (const k of ['fat', 'salty', 'umami']) expect(r.axes[k]).toBeUndefined();
    expect(r.basis.notKnown).toEqual(expect.arrayContaining(['fat', 'salty', 'umami']));
  });
  it('a line with no amount makes every zero unknown', () => {
    const r = gimlet({}, [{ name: 'Salt', qty: null, unit: 'g' }]);
    expect(r.axes.salty).toBeUndefined();
    expect(r.basis.notKnown).toContain('salty');
  });
  it('a good\'s own typed zero is a known zero, and a stated value is never hidden', () => {
    const r = gimlet({ own: { prov: 'staff', axes: { bitter: { v: 0 }, fat: { v: 0 } } } });
    expect(r.axes.fat).toMatchObject({ v: 0 });
    // lime still says nothing about bitter, so bitter stays unknown rather than "none".
    expect(r.axes.bitter).toBeUndefined();
    expect(gimlet({ own: staffGin }).axes.bitter).toBeDefined();
  });
  it('ice is known to add nothing, so it does not make a zero unknown', () => {
    const r = gimlet({}, [{ name: 'Ice', qty: 40, unit: 'g' }]);
    expect(r.axes.fat).toMatchObject({ v: 0 });
  });
});
