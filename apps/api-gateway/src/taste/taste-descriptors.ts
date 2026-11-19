import { DESCRIPTOR_KEYS } from './taste-axes';

/**
 * Which flavour words staff may tick, by what is being tasted. The chip list
 * for a food is the food list; a drink gets the words its trade uses. Own
 * word lists that map onto the published ones (WSET SAT for wine and spirits,
 * BJCP for beer, the SCA tasters' families for coffee, WSET balance for
 * cocktails) without copying any wheel's artwork. Bitterness, body, alcohol
 * and carbonation are numeric axes already, so they are not chips. The web
 * copies these lists verbatim.
 */
export type DescriptorFamily = 'food' | 'wine' | 'spirit' | 'beer' | 'coffee' | 'cocktail';

const FINISH = ['short-finish', 'medium-finish', 'long-finish'] as const;

export const DESCRIPTORS_BY_FAMILY: Record<DescriptorFamily, readonly string[]> = {
  food: DESCRIPTOR_KEYS,
  wine: [
    'citrus-fruit', 'green-fruit', 'stone-fruit', 'tropical-fruit', 'red-fruit', 'black-fruit',
    'dried-fruit', 'floral', 'herbal', 'spice', 'oak', 'earthy', 'mineral', ...FINISH,
  ],
  spirit: [
    'citrus-fruit', 'orchard-fruit', 'stone-fruit', 'tropical-fruit', 'dried-fruit', 'floral',
    'herbal', 'juniper', 'spice', 'vanilla', 'caramel', 'oak', 'smoky', 'earthy', 'nutty', ...FINISH,
  ],
  beer: [
    'bready', 'biscuity', 'caramel', 'toasty', 'roasty', 'chocolate', 'citrus-fruit', 'piney',
    'floral', 'herbal', 'fruity-yeast', 'spicy-yeast', 'clean', 'tart', 'funky', 'dry-finish',
  ],
  coffee: [
    'berry', 'citrus-fruit', 'stone-fruit', 'floral', 'honey', 'caramel', 'nutty', 'cocoa',
    'spice', 'roasted', 'smoky', 'vegetal', 'winey', 'clean',
  ],
  cocktail: [
    'spirit-forward', 'boozy', 'balanced', 'sour-led', 'sweet-led', 'bitter-led', 'refreshing',
    'strong', 'long-and-light', 'citrus-fruit', 'herbal', 'spice', 'smoky',
  ],
};

/** Ledger `kind` -> family. Anything unlisted (food, other) is food; a supply is never tasted. */
const BY_GOOD_KIND: Record<string, DescriptorFamily> = {
  wine: 'wine', sake: 'wine', cider: 'wine',
  spirit: 'spirit', whiskey: 'spirit', liqueur: 'spirit',
  beer: 'beer',
  non_alcoholic: 'coffee', soft_drink: 'coffee',
  cocktail: 'cocktail',
};

export function descriptorFamily(subjectKind: 'good' | 'cocktail' | 'dish', goodKind?: string | null): DescriptorFamily {
  if (subjectKind === 'cocktail') return 'cocktail';
  if (subjectKind === 'dish') return 'food';
  return BY_GOOD_KIND[goodKind ?? ''] ?? 'food';
}
