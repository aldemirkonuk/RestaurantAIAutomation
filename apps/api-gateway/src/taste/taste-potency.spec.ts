import { findClass } from './taste-class-match';
import { CLASS_PRIORS, perceive, POTENCY, PotentTaste, PRIORS_VERSION, unperceive } from './taste-priors';
import { CLASS_SOURCES } from './taste-prior-sources';
import { LEAD_MAX, LEAD_WORD, leadTastes, rollup, RollupInput, RollupLine } from './taste-rollup';

const L = (name: string, qty: number, unit: 'g' | 'ml' = 'g', prep?: string): RollupLine => ({ name, qty, unit, prep });
const drink = (method: string, lines: RollupLine[]): RollupInput => ({ kind: 'cocktail', method, components: [{ name: 'd', lines }] });
const dish = (lines: RollupLine[]): RollupInput => ({ kind: 'dish', components: [{ name: 'd', lines }] });
const TASTES = Object.keys(POTENCY) as PotentTaste[];

describe('potency: a power law over a detection threshold (r96)', () => {
  it('reads nothing at or under the threshold and a rising value above it', () => {
    for (const t of TASTES) {
      expect(perceive(t, 0)).toBe(0);
      expect(perceive(t, POTENCY[t].T)).toBe(0);
      expect(perceive(t, POTENCY[t].T * 2)).toBeGreaterThan(0);
      let last = 0;
      for (let i = 1; i <= 20; i++) {
        const v = perceive(t, (POTENCY[t].c10 * i) / 20);
        expect(v).toBeGreaterThanOrEqual(last);
        last = v;
      }
      expect(perceive(t, POTENCY[t].c10 * 5)).toBe(10);
    }
  });
  it('undoes itself: the amount that tastes like v on its own reads v', () => {
    for (const t of TASTES) for (const v of [0.5, 2, 4.5, 7, 9.5]) expect(perceive(t, unperceive(t, v))).toBeCloseTo(v, 6);
    expect(unperceive('bitter', 0)).toBe(0);
  });
  it('keeps the r92 beer anchors: a 20 IBU lager is medium (5.5), a 50 IBU IPA 8.6', () => {
    expect(Math.abs(perceive('bitter', 20) - 5.5)).toBeLessThan(0.5);
    expect(Math.abs(perceive('bitter', 50) - 8.6)).toBeLessThan(0.5);
  });
  it('is on priors version 6, so a stored layer worked out under the old curves reads stale', () => {
    expect(PRIORS_VERSION).toBe(6);
  });
});

describe('the lead: which tastes a cook names first', () => {
  it('names a taste only from medium up, strongest first, at most three', () => {
    const ax = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { v }]));
    expect(leadTastes(ax({ sweet: 3.9, sour: 3 }))).toEqual([]);
    expect(leadTastes(ax({ sweet: 4, sour: 6 }))).toEqual(['sour', 'sweet']);
    expect(leadTastes(ax({ sweet: 5, sour: 6, salty: 7, bitter: 8 }))).toHaveLength(LEAD_MAX);
    expect(leadTastes(ax({ sweet: 5, sour: 6, salty: 7, bitter: 8 }))).toEqual(['bitter', 'salty', 'sour']);
  });
  it('lets the savoury aroma stand in for umami, but never both', () => {
    const ax = (o: Record<string, number>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, { v }]));
    expect(leadTastes(ax({ umami: 3, savoury: 5 }))).toEqual(['savoury']);
    expect(leadTastes(ax({ umami: 5, savoury: 6 }))).toEqual(['umami']);
    expect(LEAD_WORD.fat).toBe('rich');
    expect(LEAD_WORD.umami).toBe('savoury');
  });
});

describe('worked examples the walk got wrong (r95 w1), with no staff layer on anything', () => {
  it('negroni: bitter is at least medium and is named, after the sweetness it carries', () => {
    const r = rollup(drink('Stir over ice', [L('Gin', 30, 'ml'), L('Campari', 30, 'ml'), L('Sweet vermouth', 30, 'ml')]));
    expect(r.axes.bitter.v).toBeGreaterThanOrEqual(4);
    expect(r.basis.lead).toContain('bitter');
    expect(r.basis.lead).toContain('sweet');
    expect(r.basis.lineSources.every((x) => x.from !== 'good')).toBe(true);
  });
  it('negroni: more Campari is more bitter, by concentration in the glass', () => {
    const base = rollup(drink('Stir over ice', [L('Gin', 30, 'ml'), L('Campari', 30, 'ml'), L('Sweet vermouth', 30, 'ml')]));
    const heavy = rollup(drink('Stir over ice', [L('Gin', 20, 'ml'), L('Campari', 50, 'ml'), L('Sweet vermouth', 20, 'ml')]));
    const light = rollup(drink('Stir over ice', [L('Gin', 40, 'ml'), L('Campari', 10, 'ml'), L('Sweet vermouth', 40, 'ml')]));
    expect(heavy.axes.bitter.v).toBeGreaterThan(base.axes.bitter.v + 0.5);
    expect(light.axes.bitter.v).toBeLessThan(base.axes.bitter.v - 1);
    expect(light.basis.lead).not.toContain('bitter');
  });
  it('kofta: names its richness and its savoury depth', () => {
    const r = rollup(dish([L('Lamb mince', 230, 'g', 'grilled'), L('Onion', 40), L('Salt', 3), L('Cumin', 2)]));
    expect(r.axes.fat.v).toBeGreaterThanOrEqual(6);
    expect(r.basis.lead.slice(0, 2)).toEqual(['fat', 'umami']);
    expect(r.basis.lead.map((k) => LEAD_WORD[k])).toEqual(expect.arrayContaining(['rich', 'savoury']));
  });
  it('caesar salad: with its dressing and croutons known, it reads rich, salty and savoury', () => {
    const r = rollup(dish([L('Romaine', 120), L('Parmesan', 25), L('Caesar dressing', 40, 'ml'), L('Croutons', 20)]));
    expect(r.basis.unknownNames).toEqual([]);
    expect(r.basis.lead.map((k) => LEAD_WORD[k]).sort()).toEqual(['rich', 'salty', 'savoury']);
    expect(r.axes.fat.v).toBeGreaterThanOrEqual(4);
    expect(r.axes.salty.v).toBeGreaterThanOrEqual(4);
    // Both new classes carry an unverified figure, so the card marks them as estimates.
    const from = Object.fromEntries(r.basis.lineSources.map((x) => [x.name, x.from]));
    expect(from['Caesar dressing']).toBe('class_prior_estimate');
    expect(from.Croutons).toBe('class_prior_estimate');
  });
  it('caesar salad without the dressing class would still be thin (what the walk saw)', () => {
    const r = rollup(dish([L('Romaine', 120), L('Parmesan', 25)]));
    expect(r.basis.lead).not.toContain('fat');
  });
  it('gimlet: stays sour-led', () => {
    const r = rollup(drink('Shake with ice', [L('Gin', 60, 'ml'), L('Lime juice', 25, 'ml'), L('Sugar syrup', 15, 'ml')]));
    expect(r.basis.lead[0]).toBe('sour');
    expect(r.axes.sour.v).toBeGreaterThan(r.axes.sweet.v + 2);
    expect(r.axes.bitter?.v ?? 0).toBeLessThan(2);
  });
  it('a potent line is not diluted by being one of many: 25 g parmesan still lifts umami in a 205 g bowl', () => {
    const without = rollup(dish([L('Romaine', 180), L('Croutons', 20)]));
    const withCheese = rollup(dish([L('Romaine', 155), L('Croutons', 20), L('Parmesan', 25)]));
    expect(withCheese.axes.umami.v).toBeGreaterThan((without.axes.umami?.v ?? 0) + 1.5);
  });
});

describe('the new classes (r96)', () => {
  it('finds a caesar dressing and croutons, which a "prepared dish" label would otherwise hide', () => {
    expect(findClass('Caesar Dressing')?.id).toBe('caesar-dressing');
    expect(findClass('Croutons')?.id).toBe('crouton');
    expect(findClass('garlic croutons')?.id).toBe('crouton');
  });
  it('still leaves a prepared dish unknown', () => {
    expect(findClass('Caesar salad')).toBeUndefined();
    expect(findClass('Tomato soup')).toBeUndefined();
    expect(findClass('Ranch dressing')).toBeUndefined();
  });
  it('reads the cheese, the anchovy and the bitter liqueurs a caesar and a negroni lean on', () => {
    expect(findClass('Parmigiano Reggiano')?.id).toBe('hard-cheese');
    expect(findClass('Anchovies')?.id).toBe('anchovy');
    for (const n of ['Campari', 'Amaro Montenegro', 'Averna', 'Cynar', 'Suze']) expect(findClass(n)?.id).toBe('bitter-liqueur');
    expect(findClass('Aperol')?.id).toBe('aperol');
  });
  it('gives each new class a source code and marks every unverified figure as UNV', () => {
    for (const id of ['caesar-dressing', 'crouton']) {
      expect(CLASS_PRIORS.some((c) => c.id === id)).toBe(true);
      expect(CLASS_SOURCES[id].codes).toContain('UNV');
    }
  });
});
