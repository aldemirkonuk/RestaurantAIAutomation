/**
 * Every constant the recipe roll-up uses, in one table, so nothing hides in a
 * formula (DESIGN D13). They are STARTING VALUES set from R3-DERIVE.md, not
 * literature facts and not fitted. Fit target: 40 items tasted blind by 3
 * staff, Spearman >= 0.7 on sweet / sour / salty / fat. Until then the UI says
 * "worked out from the recipe" and shows bands, never a bare number.
 *
 * Chemistry is per 100 g (solid) or 100 mL (liquid) of the ingredient as
 * bought: se = sucrose-equivalent sugar g, ce = citric-equivalent acid g,
 * nacl = salt g, fat g, glu / nuc = free glutamate / 5'-nucleotide g,
 * be = bitter equivalents (IBU-eq), abv = % ethanol.
 */
export interface Chem { se?: number; ce?: number; nacl?: number; fat?: number; glu?: number; nuc?: number; be?: number; abv?: number }
export type AromaFamilyKey = 'fruit' | 'citrus' | 'floral' | 'herbal' | 'spice' | 'nutty' | 'roasted' | 'smoky' | 'savoury' | 'earthy' | 'dairy' | 'woody' | 'funky';
export type Aroma = Partial<Record<AromaFamilyKey, number>>;

/** Bump when any value below changes: a stored layer then reads as stale. */
export const PRIORS_VERSION = 1;

/**
 * How far a source of chemistry is believed (R3 section 3 step 8). A class
 * prior is never above 0.6: it is the kind of ingredient, not this bottle.
 */
export const Q_BY_PROV = { measured: 1.0, dataset: 0.7, class_prior: 0.6, unknown: 0 } as const;
export type RollupProv = keyof typeof Q_BY_PROV;

export interface ClassPrior {
  id: string; match: RegExp; chem: Chem;
  /** Relative sd of the chemistry (one draw per line, all fields together). */
  rsd: number;
  /** Belief in this class (<= Q_BY_PROV.class_prior); loose classes are lower. */
  q: number;
  aroma?: Aroma; protein?: boolean; solid?: boolean;
}

// Tight classes first (a standard strength, a standard syrup); loose ones after.
// Matching is on the accent-folded lower-case name; first match wins.
export const CLASS_PRIORS: readonly ClassPrior[] = [
  { id: 'ice-water', match: /^(ice|crushed ice|water|soda water|club soda|sparkling water)$/, chem: {}, rsd: 0, q: 0.6 },
  { id: 'honey-agave', match: /\b(honey|agave|maple)\b/, chem: { se: 75 }, rsd: 0.06, q: 0.5 },
  { id: 'rich-syrup', match: /\b(rich syrup|demerara syrup)\b/, chem: { se: 85 }, rsd: 0.04, q: 0.55 },
  { id: 'simple-syrup', match: /\b(simple syrup|sugar syrup|syrup)\b/, chem: { se: 61.5 }, rsd: 0.03, q: 0.6 },
  { id: 'sugar', match: /\b(sugar|sucre)\b/, chem: { se: 100 }, rsd: 0.01, q: 0.6, solid: true },
  { id: 'salt', match: /\b(salt|sea salt|sel)\b/, chem: { nacl: 100 }, rsd: 0.01, q: 0.6, solid: true },
  { id: 'lemon-lime', match: /\b(lemon|lime|limon)\b/, chem: { ce: 6.0, se: 2.5 }, rsd: 0.13, q: 0.5, aroma: { citrus: 0.75 } },
  { id: 'orange-juice', match: /\b(orange|portakal)\b.*\b(juice|suyu)\b|\b(juice|suyu)\b.*\b(orange|portakal)\b/, chem: { ce: 1.0, se: 8.5 }, rsd: 0.15, q: 0.45, aroma: { citrus: 0.6 } },
  { id: 'grapefruit-juice', match: /\bgrapefruit\b/, chem: { ce: 1.5, se: 7 }, rsd: 0.15, q: 0.45, aroma: { citrus: 0.6 } },
  { id: 'sweet-vermouth', match: /\b(sweet vermouth|rosso)\b/, chem: { abv: 16, se: 14, ce: 0.6, be: 8 }, rsd: 0.1, q: 0.45, aroma: { herbal: 0.6 } },
  { id: 'dry-vermouth', match: /\b(dry vermouth|vermouth)\b/, chem: { abv: 18, se: 3, ce: 0.6, be: 6 }, rsd: 0.1, q: 0.45, aroma: { herbal: 0.6 } },
  { id: 'bitter-liqueur', match: /\b(campari|aperol|amaro|fernet)\b/, chem: { abv: 25, se: 22, be: 55 }, rsd: 0.15, q: 0.4, aroma: { herbal: 0.6 } },
  { id: 'orange-liqueur', match: /\b(triple sec|cointreau|curacao|liqueur)\b/, chem: { abv: 35, se: 25 }, rsd: 0.12, q: 0.4 },
  { id: 'bitters', match: /\b(bitters)\b/, chem: { abv: 44, be: 120 }, rsd: 0.2, q: 0.4, aroma: { spice: 0.6 } },
  { id: 'dark-spirit', match: /\b(bourbon|whiskey|whisky|rye|scotch|rum|brandy|cognac|calvados)\b/, chem: { abv: 40, be: 10 }, rsd: 0.04, q: 0.6, aroma: { woody: 0.75 } },
  { id: 'clear-spirit', match: /\b(vodka|gin|tequila|mezcal|raki|aquavit|spirit)\b/, chem: { abv: 40, be: 3 }, rsd: 0.04, q: 0.6 },
  { id: 'wine', match: /\b(wine|prosecco|champagne|sparkling)\b/, chem: { abv: 12.5, ce: 0.6, se: 0.6 }, rsd: 0.15, q: 0.45 },
  { id: 'tonic-cola', match: /\b(tonic|cola|ginger ale|lemonade)\b/, chem: { se: 9, be: 6 }, rsd: 0.15, q: 0.4 },
  { id: 'beer', match: /\b(beer|lager|ale|stout)\b/, chem: { abv: 5, be: 20, se: 0.3 }, rsd: 0.25, q: 0.4 },
  { id: 'vinegar', match: /\b(vinegar|sirke)\b/, chem: { ce: 2.5 }, rsd: 0.15, q: 0.5 },
  { id: 'oil', match: /\b(olive oil|oil|yag)\b/, chem: { fat: 100 }, rsd: 0.01, q: 0.6 },
  { id: 'butter', match: /\b(butter|tereyagi)\b/, chem: { fat: 81, nacl: 1.5 }, rsd: 0.05, q: 0.5, aroma: { dairy: 0.6 } },
  { id: 'cream', match: /\b(cream|krema)\b/, chem: { fat: 35, se: 0.7, nacl: 0.1 }, rsd: 0.08, q: 0.5, aroma: { dairy: 0.5 } },
  { id: 'soy', match: /\b(soy sauce|tamari|fish sauce)\b/, chem: { nacl: 14, glu: 0.8, nuc: 0.0, se: 1 }, rsd: 0.15, q: 0.4, aroma: { savoury: 0.7 } },
  { id: 'yogurt', match: /\b(yogurt|yoghurt|yogurt|kefir)\b/, chem: { se: 0.94, ce: 0.54, fat: 3.3, nacl: 0.17, glu: 0.003 }, rsd: 0.2, q: 0.4, aroma: { dairy: 0.5 } },
  { id: 'milk', match: /\b(milk|sut)\b/, chem: { se: 1, fat: 3.5, nacl: 0.1 }, rsd: 0.1, q: 0.5, aroma: { dairy: 0.3 } },
  { id: 'cheese', match: /\b(cheese|feta|parmesan|peynir)\b/, chem: { fat: 28, nacl: 2, glu: 0.2 }, rsd: 0.3, q: 0.3, aroma: { dairy: 0.6, funky: 0.3 }, solid: true },
  { id: 'tomato', match: /\b(tomato|domates)\b/, chem: { se: 2.6, ce: 0.4, nacl: 0.01, glu: 0.15, be: 1 }, rsd: 0.25, q: 0.35, solid: true },
  { id: 'meat-lamb', match: /\b(lamb|kofta|kuzu|mutton)\b/, chem: { fat: 20, nacl: 0.18, glu: 0.012, nuc: 0.03 }, rsd: 0.3, q: 0.3, protein: true, solid: true },
  { id: 'meat-beef', match: /\b(beef|steak|veal|dana)\b/, chem: { fat: 15, nacl: 0.18, glu: 0.012, nuc: 0.03 }, rsd: 0.3, q: 0.3, protein: true, solid: true },
  { id: 'poultry', match: /\b(chicken|turkey|duck|tavuk)\b/, chem: { fat: 8, nacl: 0.2, glu: 0.02, nuc: 0.12 }, rsd: 0.3, q: 0.3, protein: true, solid: true },
  { id: 'fish', match: /\b(fish|salmon|tuna|cod|sea bass|shrimp|prawn)\b/, chem: { fat: 6, nacl: 0.2, glu: 0.02, nuc: 0.1 }, rsd: 0.35, q: 0.3, protein: true, solid: true },
  { id: 'onion-garlic', match: /\b(onion|garlic|shallot|sarimsak|sogan)\b/, chem: { se: 4, ce: 0.1 }, rsd: 0.3, q: 0.3, aroma: { savoury: 0.5 }, solid: true },
  { id: 'herb', match: /\b(parsley|mint|basil|dill|thyme|rosemary|herb)\b/, chem: {}, rsd: 0, q: 0.3, aroma: { herbal: 0.7 }, solid: true },
  { id: 'starch', match: /\b(flour|rice|pasta|bread|potato|bulgur|noodle)\b/, chem: { fat: 1, nacl: 0.05 }, rsd: 0.3, q: 0.3, solid: true },
];

/** Cooking: y = mass kept, B = browning 0..1, fatUp = fat taken up (g/100 g), smoky = char. */
export interface Method { id: string; match: RegExp; y: number; B: number; fatUp?: number; smoky?: boolean; umamiX?: number }
export const METHODS: readonly Method[] = [
  { id: 'grill-char', match: /\b(grill|grilled|char|charred|blackened)\b/, y: 0.75, B: 0.85, smoky: true },
  { id: 'fry', match: /\b(fry|fried|deep fried)\b/, y: 0.9, B: 0.65, fatUp: 8 },
  { id: 'sear', match: /\b(sear|seared|saute|sauteed|pan fried|pan seared)\b/, y: 0.75, B: 0.7 },
  { id: 'roast', match: /\b(roast|roasted|baked|bake)\b/, y: 0.7, B: 0.65 },
  { id: 'braise', match: /\b(braise|braised|stew|stewed)\b/, y: 0.8, B: 0.2, umamiX: 1.15 },
  { id: 'reduce', match: /\b(reduce|reduced|reduction)\b/, y: 0.45, B: 0 },
  { id: 'boil', match: /\b(boil|boiled|poach|poached|steam|steamed)\b/, y: 0.95, B: 0 },
];

/** Cocktail water added by the method (share of the mixed volume). Priors, sd 0.05. */
export const DILUTION_BY_METHOD: ReadonlyArray<{ match: RegExp; d: number }> = [
  { match: /\b(stir|stirred)\b/, d: 0.22 },
  { match: /\b(shake|shaken)\b/, d: 0.27 },
  { match: /\b(blend|blended|frozen)\b/, d: 0.4 },
  { match: /\b(build|built|highball|on ice)\b/, d: 0.25 },
  { match: /\b(neat|straight|shot)\b/, d: 0 },
];
export const DILUTION_DEFAULT = 0.25;
export const DILUTION_SD = 0.05;
export const DILUTION_SD_ASSUMED = 0.08;

/** Saturating curves (R3 step 4): value = 10 * (1 - exp(-x / k)). */
export const K = { sweet: 12, sour: 8, salty: 0.9, bitter: 25, umami: 0.5, fat: 12, aromaRef: 28 } as const;
export const SOLID_SALT_RELEASE = 0.8;
export const YAMAGUCHI = 1218;
/** Mutual suppression (R3 step 5). */
export const SUPPRESS = { sweetBySour: 0.03, sourBySweet: 0.035, bitterBySweet: 0.04, bitterBySalt: 0.03 } as const;
/** Alcohol warmth runs 0 at 8 % ABV to 10 at 40 %. */
export const ABV_FLOOR = 8;
export const ABV_SPAN = 32;
/** How much of the roast/smoke from browning a protein vs other food carries. */
export const ROAST_K = { protein: 0.9, other: 0.5, smoke: 0.6 } as const;
/** A dish's bites: weight = mass ^ 0.7; the headline is the peak (R3 step 7). */
export const BITE_EXPONENT = 0.7;
export const DRAWS = 200;
