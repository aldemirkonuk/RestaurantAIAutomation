import { DESCRIPTORS_BY_FAMILY, descriptorFamily, DescriptorFamily } from './taste-descriptors';
import { DESCRIPTOR_KEYS } from './taste-axes';

const FAMILIES = Object.keys(DESCRIPTORS_BY_FAMILY) as DescriptorFamily[];

describe('descriptorFamily', () => {
  it.each([
    ['wine', 'wine'], ['sake', 'wine'], ['cider', 'wine'],
    ['spirit', 'spirit'], ['whiskey', 'spirit'], ['liqueur', 'spirit'],
    ['beer', 'beer'], ['non_alcoholic', 'coffee'], ['soft_drink', 'coffee'],
    ['cocktail', 'cocktail'], ['food', 'food'], ['other', 'food'],
  ])('a good of kind %s offers the %s words', (kind, family) => {
    expect(descriptorFamily('good', kind)).toBe(family);
  });
  it('a cocktail row offers cocktail words and a dish offers food words, whatever the good kind', () => {
    expect(descriptorFamily('cocktail')).toBe('cocktail');
    expect(descriptorFamily('dish', 'wine')).toBe('food');
  });
  it('an unknown or missing good kind falls back to food words, never to nothing', () => {
    expect(descriptorFamily('good', 'mead')).toBe('food');
    expect(descriptorFamily('good', null)).toBe('food');
  });
});

describe('DESCRIPTORS_BY_FAMILY', () => {
  it('food keeps the original twelve words', () => {
    expect(DESCRIPTORS_BY_FAMILY.food).toEqual(DESCRIPTOR_KEYS);
  });
  it.each(FAMILIES)('%s has no repeated word and every word is lower-case kebab', (f) => {
    const list = DESCRIPTORS_BY_FAMILY[f];
    expect(new Set(list).size).toBe(list.length);
    for (const w of list) expect(w).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });
  it('a drink family carries what its trade tastes for, and none carries the food-only words', () => {
    expect(DESCRIPTORS_BY_FAMILY.wine).toEqual(expect.arrayContaining(['red-fruit', 'oak', 'long-finish']));
    expect(DESCRIPTORS_BY_FAMILY.spirit).toEqual(expect.arrayContaining(['juniper', 'vanilla']));
    expect(DESCRIPTORS_BY_FAMILY.beer).toEqual(expect.arrayContaining(['bready', 'piney', 'fruity-yeast']));
    expect(DESCRIPTORS_BY_FAMILY.coffee).toEqual(expect.arrayContaining(['berry', 'cocoa']));
    expect(DESCRIPTORS_BY_FAMILY.cocktail).toEqual(expect.arrayContaining(['spirit-forward', 'sour-led']));
    for (const f of ['wine', 'spirit', 'beer', 'coffee'] as const) {
      for (const w of ['savoury', 'rich', 'sweet-and-sour', 'tangy']) expect(DESCRIPTORS_BY_FAMILY[f]).not.toContain(w);
    }
  });
});
