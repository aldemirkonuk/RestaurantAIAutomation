import { findClass } from './taste-class-match';

const id = (name: string) => findClass(name)?.id;

describe('class priors: matching a label', () => {
  it('folds case, accents, spacing and plurals', () => {
    expect(id('  Tomatoes ')).toBe('tomato');
    expect(id('LEMON JUICE')).toBe('lemon-lime');
    expect(id('Anchovies')).toBe('anchovy');
    expect(id('Sarımsak')).toBe('garlic');
  });
  it('reads common synonyms', () => {
    expect(id('Whisky')).toBe('dark-spirit');
    expect(id('Rocket')).toBe('leafy-greens');
    expect(id('Yoghurt')).toBe('yogurt');
  });
  it('lets the specific class beat the general one', () => {
    expect(id('Red wine')).toBe('red-wine');
    expect(id('Red wine vinegar')).toBe('vinegar');
    expect(id('Tomato paste')).toBe('tomato-paste');
    expect(id('Ginger beer')).toBe('tonic-cola');
    expect(id('Feta cheese')).toBe('feta');
  });
  it('never guesses: an ambiguous or prepared name stays unknown', () => {
    for (const n of ['Salt and pepper', 'Salt cod', 'Vermouth', 'Liqueur', 'Lemon zest', 'Tomato soup', 'Caesar salad dressing',
      'Vanilla ice cream', 'Cream cheese', 'Sour cream', 'Almond milk', 'Spice mix', 'Chili', 'Sugar snap peas', 'Egg yolk', 'Stock cube', 'House shrub 7', '', '   ']) {
      expect([n, id(n)]).toEqual([n, undefined]);
    }
  });
});

