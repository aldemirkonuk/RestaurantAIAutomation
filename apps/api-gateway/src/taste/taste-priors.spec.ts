import { bandWord } from './taste-axes';
import { findClass } from './taste-class-match';
import { CLASS_PRIORS, classQ, isUnverifiedClass, NONE_BY_CLASS, PRIORS_VERSION, Q_BY_PROV, UNV_Q_FACTOR } from './taste-priors';
import { CLASS_SOURCES, PRIOR_SOURCES } from './taste-prior-sources';
import { rollup, RollupInput, RollupLine } from './taste-rollup';

const id = (name: string) => findClass(name)?.id;
const L = (name: string, qty: number, unit: 'g' | 'ml' = 'g', extra: Partial<RollupLine> = {}): RollupLine => ({ name, qty, unit, ...extra });
const dish = (...components: Array<[string, RollupLine[]]>): RollupInput => ({ kind: 'dish', components: components.map(([name, lines]) => ({ name, lines })) });
const drink = (method: string, lines: RollupLine[]): RollupInput => ({ kind: 'cocktail', method, components: [{ name: 'drink', lines }] });
const between = (v: number, lo: number, hi: number) => { expect(v).toBeGreaterThanOrEqual(lo); expect(v).toBeLessThan(hi); };

describe('class priors: the table', () => {
  it('has 60-80 classes, each with a source, none claiming more belief than a class prior may', () => {
    expect(CLASS_PRIORS.length).toBeGreaterThanOrEqual(60);
    expect(CLASS_PRIORS.length).toBeLessThanOrEqual(80);
    expect(new Set(CLASS_PRIORS.map((c) => c.id)).size).toBe(CLASS_PRIORS.length);
    for (const c of CLASS_PRIORS) {
      expect(CLASS_SOURCES[c.id]).toBeTruthy();
      for (const code of CLASS_SOURCES[c.id].codes) expect(PRIOR_SOURCES[code]).toBeTruthy();
      expect(c.q).toBeLessThanOrEqual(Q_BY_PROV.class_prior);
      for (const [f, v] of Object.entries(c.chem)) {
        expect(v).toBeGreaterThanOrEqual(0);
        if (f === 'abv') expect(v).toBeLessThanOrEqual(100);
      }
    }
    for (const k of Object.keys(NONE_BY_CLASS)) expect(CLASS_PRIORS.some((c) => c.id === k)).toBe(true);
  });
  it('never states a class whose per-100 chemistry adds past 100 g', () => {
    for (const c of CLASS_PRIORS) {
      const { se = 0, nacl = 0, fat = 0 } = c.chem;
      expect(se + nacl + fat).toBeLessThanOrEqual(100.01);
    }
  });
  it('is on priors version 5', () => expect(PRIORS_VERSION).toBe(5));
});

describe('class priors: an unverified figure lowers belief (r94)', () => {
  const unv = CLASS_PRIORS.filter((c) => CLASS_SOURCES[c.id].codes.includes('UNV'));
  it('discounts exactly the classes whose source codes carry UNV, by the stated factor', () => {
    expect(UNV_Q_FACTOR).toBe(0.8);
    expect(unv.length).toBeGreaterThanOrEqual(15);
    for (const c of CLASS_PRIORS) {
      const has = CLASS_SOURCES[c.id].codes.includes('UNV');
      expect(isUnverifiedClass(c.id)).toBe(has);
      expect(classQ(c)).toBeCloseTo(has ? c.q * 0.8 : c.q, 3);
    }
  });
  it('a verified class and an unverified one both stay at or under the class-prior ceiling', () => {
    for (const c of CLASS_PRIORS) expect(classQ(c)).toBeLessThanOrEqual(Q_BY_PROV.class_prior);
  });
  it('the roll-up marks an unverified line class_prior_estimate and a verified one class_prior', () => {
    const r = rollup(dish(['plate', [L('Tomato', 100), L('Salt', 1)]]));
    expect(r.basis.lineSources).toEqual([
      { name: 'Tomato', from: 'class_prior_estimate', prov: 'class_prior' },
      { name: 'Salt', from: 'class_prior', prov: 'class_prior' },
    ]);
    expect(r.basis.classPrior).toBe(2);
  });
  it('an unverified line lowers the confidence of the axes it drives, against the same line read as verified', () => {
    const run = () => rollup(dish(['plate', [L('Tomato', 150)]]));
    const flagged = run();
    const codes = CLASS_SOURCES.tomato.codes;
    CLASS_SOURCES.tomato.codes = codes.filter((c) => c !== 'UNV');
    let plain: ReturnType<typeof run>;
    try { plain = run(); } finally { CLASS_SOURCES.tomato.codes = codes; }
    expect(plain.basis.lineSources[0].from).toBe('class_prior');
    expect(flagged.axes.umami.conf).toBeLessThan(plain.axes.umami.conf);
    expect(flagged.axes.sweet.conf).toBeLessThan(plain.axes.sweet.conf);
    // the values themselves do not move: only the belief does
    expect(flagged.axes.umami.v).toBe(plain.axes.umami.v);
  });
});

describe('class priors: matching a label', () => {
  it('folds case, accents, spacing and plurals', () => {
    expect(id('  Tomatoes ')).toBe('tomato');
    expect(id('LEMON JUICE')).toBe('lemon-lime');
    expect(id('Anchovies')).toBe('anchovy');
    expect(id('Yoğurt')).toBe('yogurt');
    expect(id('Sarımsak')).toBe('garlic');
    expect(id('Angostura Bitters')).toBe('bitters');
    expect(id('Lime juice')).toBe('lemon-lime');
    expect(id('Eggs')).toBe('egg');
  });
  it('reads common synonyms', () => {
    expect(id('Whisky')).toBe('dark-spirit');
    expect(id('Spring onions')).toBe(undefined);
    expect(id('Rocket')).toBe('leafy-greens');
    expect(id('Capsicum')).toBe('bell-pepper');
    expect(id('Yoghurt')).toBe('yogurt');
    expect(id('Parmigiano Reggiano')).toBe('hard-cheese');
    expect(id('Rye flour')).toBe('starch');
  });
  it('lets the specific class beat the general one', () => {
    expect(id('Red wine')).toBe('red-wine');
    expect(id('Red wine vinegar')).toBe('vinegar');
    expect(id('Balsamic vinegar')).toBe('balsamic');
    expect(id('Tomato paste')).toBe('tomato-paste');
    expect(id('Ginger beer')).toBe('tonic-cola');
    expect(id('Sugar syrup')).toBe('simple-syrup');
    expect(id('Feta cheese')).toBe('feta');
  });
  it('never guesses: an ambiguous or prepared name stays unknown', () => {
    for (const n of ['Salt and pepper', 'Salt cod', 'Vermouth', 'Liqueur', 'Lemon zest', 'Tomato soup', 'Caesar salad dressing',
      'Vanilla ice cream', 'Cream cheese', 'Sour cream', 'Peanut butter cake', 'Almond milk', 'Spice mix', 'Chili', 'Sugar snap peas', 'Egg yolk', 'Stock cube', 'House shrub 7', '', '   ']) {
      expect([n, id(n)]).toEqual([n, undefined]);
    }
  });
});

describe('worked examples: a band a cook would accept (R3 starting values, recalibrated r92)', () => {
  const band = (v: number) => bandWord(v);

  it('gimlet: tart, lightly sweet, gin warmth; the bottle\'s own bitter 6 is not lost', () => {
    const lines = (own?: RollupLine['own']) => [L('Gin', 60, 'ml', { own }), L('Lime juice', 25, 'ml'), L('Simple syrup', 15, 'ml')];
    const r = rollup(drink('Shake with ice', lines()));
    between(r.axes.sour.v, 5, 8); between(r.axes.sweet.v, 2.5, 5); between(r.axes.alcohol.v, 2.5, 5);
    expect(r.axes.bitter?.v ?? 0).toBeLessThan(2);
    const staff = rollup(drink('Shake with ice', lines({ prov: 'staff', axes: { bitter: { v: 6 } } })));
    expect(['light', 'medium']).toContain(band(staff.axes.bitter.v));
    expect(staff.axes.bitter.v).toBeGreaterThan((r.axes.bitter?.v ?? 0) + 1.5);
  });

  it('gin at 40% diluted 3:1 keeps a moderate bitter when staff said bitter 6', () => {
    const r = rollup(drink('neat', [L('Gin', 75, 'ml', { own: { prov: 'staff', axes: { bitter: { v: 6 } } } }), L('Water', 25, 'ml')]));
    expect(band(r.axes.bitter.v)).toBe('medium');
    between(r.axes.alcohol.v, 6, 8);
  });

  it('negroni: bitter and sweet both stand up, no one axis dominates', () => {
    const r = rollup(drink('Stir over ice', [L('Gin', 30, 'ml'), L('Campari', 30, 'ml'), L('Sweet vermouth', 30, 'ml')]));
    between(r.axes.bitter.v, 3.5, 8); between(r.axes.sweet.v, 3.5, 7); between(r.axes.alcohol.v, 3.5, 6.5);
    expect(r.axes.sour.v).toBeLessThan(2);
    expect(r.axes.herbal.v).toBeGreaterThan(4);
  });

  it('a dish at 1.2% salt by weight is noticeably salty, not mainly salty', () => {
    const r = rollup(dish(['x', [L('Potato', 98.8), L('Salt', 1.2)]]));
    expect(['medium', 'pronounced']).toContain(band(r.axes.salty.v));
    between(r.axes.salty.v, 4.5, 5.8);
    between(rollup(dish(['x', [L('Potato', 99.5), L('Salt', 0.5)]])).axes.salty.v, 2, 3.5);
    between(rollup(dish(['x', [L('Potato', 98), L('Salt', 2)]])).axes.salty.v, 6, 7.9);
    expect(band(rollup(dish(['x', [L('Potato', 97), L('Salt', 3)]])).axes.salty.v)).toBe('dominant');
  });

  it('kofta (r87: 3 g salt in 248 g, grilled) reads salty but not "mainly"', () => {
    const r = rollup(dish(['kofta', [L('Lamb mince', 200, 'g', { prep: 'grilled' }), L('Onion', 40), L('Salt', 3), L('Spice mix', 5)]]));
    between(r.axes.salty.v, 4.5, 7.5);
    expect(r.axes.fat.v).toBeGreaterThan(5);
    expect(r.axes.salty.v).toBeLessThan(r.axes.fat.v);
    expect(r.basis.unknownNames).toEqual(['Spice mix']);
  });

  it('caesar salad: savoury and noticeably salty from cheese and anchovy, lemony not sour, not sweet', () => {
    const r = rollup(dish(
      ['salad', [L('Romaine lettuce', 120), L('Bread', 20)]],
      ['dressing', [L('Olive oil', 25, 'ml'), L('Lemon juice', 10, 'ml'), L('Anchovies', 8), L('Parmesan', 25), L('Garlic', 3), L('Egg', 15)]],
    ));
    between(r.axes.salty.v, 3.5, 7.5); expect(r.axes.umami.v).toBeGreaterThan(3.9);
    expect(r.axes.sweet.v).toBeLessThan(2); between(r.axes.sour.v, 0.5, 5);
    expect(r.basis.unknown).toBe(0);
  });

  it('tomato soup: gently salty, light-medium sweet and tart, some savoury depth', () => {
    const r = rollup(dish(['soup', [L('Canned tomatoes', 500), L('Chicken stock', 300, 'ml'), L('Onion', 60), L('Butter', 20), L('Cream', 50, 'ml'), L('Salt', 4), L('Sugar', 5)]]));
    between(r.axes.salty.v, 3, 6.5); between(r.axes.sweet.v, 1, 3.5); between(r.axes.sour.v, 1, 4); between(r.axes.umami.v, 3, 8);
    expect(r.basis.unknown).toBe(0);
  });

  it('keeps unrelated drinks and dishes where they were: a dry gin sour is still tart', () => {
    const r = rollup(drink('Shake', [L('Gin', 50, 'ml'), L('Lemon juice', 25, 'ml'), L('Simple syrup', 15, 'ml')]));
    expect(r.axes.sour.v).toBeGreaterThan(r.axes.sweet.v);
  });
});
