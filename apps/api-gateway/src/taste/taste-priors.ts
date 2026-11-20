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
export const PRIORS_VERSION = 4;

/**
 * How far a source of chemistry is believed (R3 section 3 step 8). A class
 * prior is never above 0.6: it is the kind of ingredient, not this bottle.
 */
export const Q_BY_PROV = { measured: 1.0, dataset: 0.7, staff: 0.6, class_prior: 0.6, unknown: 0 } as const;
export type RollupProv = keyof typeof Q_BY_PROV;

export interface ClassPrior {
  id: string; match: RegExp; chem: Chem;
  /** Relative sd of the chemistry (one draw per line, all fields together). */
  rsd: number;
  /** Belief in this class (<= Q_BY_PROV.class_prior); loose classes are lower. */
  q: number;
  aroma?: Aroma; protein?: boolean; solid?: boolean;
  /** Wins over looser classes when a label fits several (two tight ones, or none, leave it unknown). */
  tight?: boolean;
  /** A label that fits `match` but also this is not this class ("salted", "almond milk"). */
  not?: RegExp;
}

// Matching is on the normalised label (taste-class-match.ts: lower-case, accent-folded, singular, synonyms).
// One class -> it; several -> only a single `tight` class may win, else the label stays unknown. Sources: taste-prior-sources.ts.
export const CLASS_PRIORS: readonly ClassPrior[] = [
  // --- water, sugars, salt
  { id: 'ice-water', match: /^(ice|crushed ice|water|soda water|club soda|sparkling water)$/, chem: {}, rsd: 0, q: 0.6, tight: true },
  { id: 'honey-agave', match: /\b(honey|agave|maple)\b/, chem: { se: 85 }, rsd: 0.06, q: 0.5 },
  { id: 'rich-syrup', match: /\b(rich syrup|demerara syrup)\b/, chem: { se: 85 }, rsd: 0.04, q: 0.55, tight: true },
  { id: 'simple-syrup', match: /\b(simple syrup|gomme|syrup)\b/, chem: { se: 61.5 }, rsd: 0.03, q: 0.6, tight: true, not: /\b(rich|demerara|grenadine|lemon|lime|orange|ginger|maple|cough)\b/ },
  { id: 'sugar', match: /\b(sugar|sucre)\b/, chem: { se: 100 }, rsd: 0.01, q: 0.6, solid: true, not: /\b(snap|pea|beet|cane juice|free)\b/ },
  { id: 'salt', match: /\b(salt|sea salt|sel)\b/, chem: { nacl: 100 }, rsd: 0.01, q: 0.6, solid: true },
  // --- citrus and fruit juices
  { id: 'lemon-lime', match: /\b(lemon|lime|limon)\b/, chem: { ce: 6.0, se: 2.5 }, rsd: 0.13, q: 0.5, aroma: { citrus: 0.75 }, not: /\b(syrup|cordial|squash|sorbet|liqueur|bitters|soda|oil|grass|thyme|balm)\b/ },
  { id: 'orange-juice', match: /\b(orange|portakal)\b.*\b(juice|suyu)\b|\b(juice|suyu)\b.*\b(orange|portakal)\b/, chem: { ce: 1.0, se: 8.5 }, rsd: 0.15, q: 0.45, aroma: { citrus: 0.6 } },
  { id: 'grapefruit-juice', match: /\bgrapefruit\b/, chem: { ce: 1.5, se: 7 }, rsd: 0.15, q: 0.45, aroma: { citrus: 0.6 }, not: /\b(syrup|soda|bitters|liqueur|cordial)\b/ },
  { id: 'pineapple-juice', match: /\bpineapple\b.*\bjuice\b|\bjuice\b.*\bpineapple\b/, chem: { se: 10.5, ce: 0.7 }, rsd: 0.15, q: 0.4, aroma: { fruit: 0.7 } },
  { id: 'cranberry-juice', match: /\bcranberry (juice|cocktail)\b|\bjuice\b.*\bcranberry\b/, chem: { se: 12.5, ce: 0.9 }, rsd: 0.2, q: 0.35, aroma: { fruit: 0.5 } },
  // --- vermouth, bitter liqueurs, liqueurs
  { id: 'sweet-vermouth', match: /\b(sweet vermouth|vermouth rosso|rosso|carpano|antica formula)\b/, chem: { abv: 16, se: 14, ce: 0.6, be: 8 }, rsd: 0.1, q: 0.45, aroma: { herbal: 0.6 }, tight: true },
  { id: 'dry-vermouth', match: /\b(dry vermouth|vermouth dry|noilly prat|dolin dry)\b/, chem: { abv: 18, se: 3, ce: 0.6, be: 6 }, rsd: 0.1, q: 0.45, aroma: { herbal: 0.6 }, tight: true },
  { id: 'bitter-liqueur', match: /\b(campari|amaro|averna|cynar)\b/, chem: { abv: 25, se: 22, be: 55 }, rsd: 0.15, q: 0.4, aroma: { herbal: 0.6 }, tight: true },
  { id: 'aperol', match: /\baperol\b/, chem: { abv: 11, se: 24, be: 28 }, rsd: 0.15, q: 0.4, aroma: { citrus: 0.5, herbal: 0.4 }, tight: true },
  { id: 'fernet', match: /\bfernet\b/, chem: { abv: 39, se: 9, be: 80 }, rsd: 0.2, q: 0.35, aroma: { herbal: 0.7, spice: 0.3 }, tight: true },
  { id: 'orange-liqueur', match: /\b(triple sec|cointreau|curacao|grand marnier|orange liqueur)\b/, chem: { abv: 35, se: 25 }, rsd: 0.12, q: 0.4, aroma: { citrus: 0.6 }, tight: true },
  { id: 'coffee-liqueur', match: /\b(kahlua|coffee liqueur|tia maria)\b/, chem: { abv: 21, se: 38, be: 8 }, rsd: 0.1, q: 0.4, aroma: { roasted: 0.6 }, tight: true },
  { id: 'bitters', match: /\bbitters\b/, chem: { abv: 44, be: 120 }, rsd: 0.2, q: 0.4, aroma: { spice: 0.6 }, tight: true },
  // --- spirits by type
  { id: 'gin', match: /\b(gin|genever|jenever)\b/, chem: { abv: 40, be: 3 }, rsd: 0.04, q: 0.6, aroma: { herbal: 0.6, citrus: 0.25, spice: 0.2 }, tight: true },
  { id: 'agave-spirit', match: /\b(tequila|mezcal|mescal)\b/, chem: { abv: 40, be: 3 }, rsd: 0.04, q: 0.6, aroma: { earthy: 0.45, herbal: 0.3 }, tight: true },
  { id: 'anise-spirit', match: /\b(raki|arak|ouzo|pastis)\b/, chem: { abv: 45, be: 3 }, rsd: 0.08, q: 0.5, aroma: { spice: 0.9, herbal: 0.4 }, tight: true },
  { id: 'brandy', match: /\b(brandy|cognac|armagnac|calvados|pisco|grappa)\b/, chem: { abv: 40, be: 6 }, rsd: 0.04, q: 0.6, aroma: { woody: 0.5, fruit: 0.45 }, tight: true },
  { id: 'dark-spirit', match: /\b(bourbon|whiskey|rye|scotch|rum)\b/, chem: { abv: 40, be: 10 }, rsd: 0.04, q: 0.6, aroma: { woody: 0.75 }, not: /\b(bread|flour|grain|berry|cake)\b/ },
  { id: 'clear-spirit', match: /\b(vodka|aquavit|spirit)\b/, chem: { abv: 40, be: 3 }, rsd: 0.04, q: 0.6 },
  // --- wine and beer styles
  { id: 'red-wine', match: /\b(red wine|cabernet|merlot|pinot noir|shiraz|syrah|malbec|chianti|rioja)\b/, chem: { abv: 13.5, ce: 0.6, se: 0.6, be: 3 }, rsd: 0.12, q: 0.45, aroma: { fruit: 0.6 }, tight: true, not: /\bvinegar\b/ },
  { id: 'white-wine', match: /\b(white wine|chardonnay|sauvignon blanc|riesling|pinot grigio|chablis|albarino)\b/, chem: { abv: 12.5, ce: 0.75, se: 0.7, be: 0.5 }, rsd: 0.12, q: 0.45, aroma: { fruit: 0.5, floral: 0.2 }, tight: true, not: /\bvinegar\b/ },
  { id: 'sparkling-wine', match: /\b(prosecco|champagne|cava|sparkling wine|cremant)\b/, chem: { abv: 12, ce: 0.7, se: 1, be: 0.5 }, rsd: 0.12, q: 0.45, aroma: { fruit: 0.4 }, tight: true },
  { id: 'fortified-wine', match: /\b(port|sherry|madeira|marsala)\b/, chem: { abv: 18, se: 10, ce: 0.5 }, rsd: 0.25, q: 0.35, aroma: { nutty: 0.5, fruit: 0.4 }, tight: true, not: /\bvinegar\b/ },
  { id: 'wine', match: /\b(wine|sparkling)\b/, chem: { abv: 12.5, ce: 0.6, se: 0.6 }, rsd: 0.15, q: 0.45, not: /\bvinegar\b/ },
  { id: 'ipa', match: /\b(ipa|india pale ale)\b/, chem: { abv: 6.5, be: 50, se: 0.3 }, rsd: 0.2, q: 0.4, aroma: { citrus: 0.4, herbal: 0.3 }, tight: true },
  { id: 'stout', match: /\b(stout|porter)\b/, chem: { abv: 4.5, be: 35, se: 0.5 }, rsd: 0.2, q: 0.4, aroma: { roasted: 0.7 }, tight: true },
  { id: 'beer', match: /\b(beer|lager|ale|pilsner)\b/, chem: { abv: 5, be: 20, se: 0.3 }, rsd: 0.25, q: 0.4 },
  { id: 'tonic-cola', match: /\b(tonic|cola|ginger ale|ginger beer|lemonade)\b/, chem: { se: 9, be: 6 }, rsd: 0.15, q: 0.4, tight: true },
  // --- acids, oils, sauces
  { id: 'vinegar', match: /\b(vinegar|sirke)\b/, chem: { ce: 2.5 }, rsd: 0.15, q: 0.5, tight: true, not: /\bbalsamic\b/ },
  { id: 'balsamic', match: /\bbalsamic\b/, chem: { se: 14, ce: 3, nacl: 0.06 }, rsd: 0.15, q: 0.4, tight: true },
  { id: 'oil', match: /\b(olive oil|oil|yag)\b/, chem: { fat: 100 }, rsd: 0.01, q: 0.6 },
  { id: 'soy', match: /\b(soy sauce|tamari)\b/, chem: { nacl: 14, glu: 0.8, nuc: 0.0, se: 0.5 }, rsd: 0.15, q: 0.4, aroma: { savoury: 0.7 }, tight: true },
  { id: 'fish-sauce', match: /\bfish sauce\b/, chem: { nacl: 20, glu: 1.0 }, rsd: 0.15, q: 0.35, aroma: { savoury: 0.8, funky: 0.6 }, tight: true },
  { id: 'ketchup', match: /\b(ketchup|catsup)\b/, chem: { se: 24, ce: 1.0, nacl: 2.3, glu: 0.15 }, rsd: 0.15, q: 0.4, tight: true },
  { id: 'mayonnaise', match: /\b(mayonnaise|mayo)\b/, chem: { fat: 75, nacl: 1.6, ce: 0.3 }, rsd: 0.1, q: 0.4, tight: true },
  { id: 'tomato-paste', match: /\btomato (paste|puree concentrate)\b/, chem: { se: 12, ce: 3, nacl: 0.3, glu: 0.8 }, rsd: 0.25, q: 0.3, aroma: { savoury: 0.5 }, tight: true },
  { id: 'tomato-canned', match: /\b(canned|tinned|crushed|chopped|plum|peeled) tomato\b|\b(passata|tomato sauce|tomato puree)\b/, chem: { se: 4, ce: 0.7, nacl: 0.35, glu: 0.2 }, rsd: 0.25, q: 0.3, aroma: { savoury: 0.3 }, tight: true },
  { id: 'stock', match: /\b(stock|broth|bouillon|consomme|fumet)\b/, chem: { nacl: 0.5, fat: 0.3, se: 0.3, glu: 0.05, nuc: 0.01 }, rsd: 0.35, q: 0.3, aroma: { savoury: 0.5 }, tight: true, not: /\b(concentrate|paste|base|granule)\b/ },
  // --- dairy and egg
  { id: 'butter', match: /\b(butter|tereyagi)\b/, chem: { fat: 81, nacl: 1.6 }, rsd: 0.05, q: 0.5, aroma: { dairy: 0.6 }, not: /\b(peanut|almond|nut|cocoa|shea|bean|lettuce|milk)\b/ },
  { id: 'cream', match: /\b(cream|krema)\b/, chem: { fat: 35, se: 0.7, nacl: 0.1 }, rsd: 0.08, q: 0.5, aroma: { dairy: 0.5 }, not: /\b(sour|tartar|coconut|cheese)\b/ },
  { id: 'yogurt', match: /\b(yogurt|kefir)\b/, chem: { se: 0.94, ce: 0.54, fat: 3.3, nacl: 0.12, glu: 0.003 }, rsd: 0.2, q: 0.4, aroma: { dairy: 0.5 } },
  { id: 'milk', match: /\b(milk|sut)\b/, chem: { se: 1, fat: 3.3, nacl: 0.1 }, rsd: 0.1, q: 0.5, aroma: { dairy: 0.3 }, not: /\b(coconut|almond|oat|soy|rice|condensed|evaporated|powder)\b/ },
  { id: 'hard-cheese', match: /\b(parmesan|grana padano|pecorino|reggiano)\b/, chem: { fat: 26, nacl: 3.9, glu: 1.2 }, rsd: 0.2, q: 0.35, aroma: { dairy: 0.6, funky: 0.4 }, solid: true, tight: true },
  { id: 'feta', match: /\b(feta|halloumi|beyaz peynir)\b/, chem: { fat: 21.5, nacl: 2.3, glu: 0.12 }, rsd: 0.25, q: 0.3, aroma: { dairy: 0.6, funky: 0.3 }, solid: true, tight: true },
  { id: 'cheddar-type', match: /\b(cheddar|gouda|emmental|emmentaler|gruyere|edam|kasar|kashar|kasseri)\b/, chem: { fat: 33, nacl: 1.7, glu: 0.18 }, rsd: 0.2, q: 0.35, aroma: { dairy: 0.6, funky: 0.3 }, solid: true, tight: true },
  { id: 'cheese', match: /\b(cheese|peynir)\b/, chem: { fat: 28, nacl: 2, glu: 0.2 }, rsd: 0.3, q: 0.3, aroma: { dairy: 0.6, funky: 0.3 }, solid: true, not: /\b(cream|cottage|ricotta|curd|cake)\b/ },
  { id: 'egg', match: /\begg\b/, chem: { fat: 9.5, nacl: 0.36, glu: 0.02 }, rsd: 0.1, q: 0.4, aroma: { dairy: 0.2 }, protein: true, solid: true, not: /\b(white|noodle|roll|plant)\b/ },
  // --- tomato, meat, fish
  { id: 'tomato', match: /\b(tomato|domates)\b/, chem: { se: 2.6, ce: 0.4, nacl: 0.01, glu: 0.15, be: 1 }, rsd: 0.25, q: 0.35, solid: true },
  { id: 'meat-lamb', match: /\b(lamb|kofta|kuzu|mutton)\b/, chem: { fat: 23, nacl: 0.15, glu: 0.012, nuc: 0.03 }, rsd: 0.3, q: 0.3, protein: true, solid: true },
  { id: 'meat-beef', match: /\b(beef|steak|veal|dana)\b/, chem: { fat: 15, nacl: 0.18, glu: 0.012, nuc: 0.03 }, rsd: 0.3, q: 0.3, protein: true, solid: true },
  { id: 'pork', match: /\bpork\b/, chem: { fat: 14, nacl: 0.17, glu: 0.023, nuc: 0.05 }, rsd: 0.3, q: 0.3, protein: true, solid: true },
  { id: 'bacon', match: /\b(bacon|pancetta|guanciale|lardon)\b/, chem: { fat: 40, nacl: 2.1, glu: 0.03, nuc: 0.05 }, rsd: 0.25, q: 0.3, aroma: { savoury: 0.5 }, protein: true, solid: true, tight: true },
  { id: 'poultry', match: /\b(chicken|turkey|duck|tavuk)\b/, chem: { fat: 8, nacl: 0.2, glu: 0.02, nuc: 0.12 }, rsd: 0.3, q: 0.3, protein: true, solid: true },
  { id: 'anchovy', match: /\banchovy\b/, chem: { fat: 9.7, nacl: 9.3, glu: 0.5 }, rsd: 0.25, q: 0.35, aroma: { savoury: 0.8, funky: 0.5 }, protein: true, solid: true, tight: true },
  { id: 'fish', match: /\b(fish|salmon|tuna|cod|sea bass|shrimp|prawn)\b/, chem: { fat: 6, nacl: 0.2, glu: 0.02, nuc: 0.1 }, rsd: 0.35, q: 0.3, protein: true, solid: true },
  // --- vegetables, herbs, spices, starch
  { id: 'onion', match: /\b(onion|shallot|sogan)\b/, chem: { se: 4, ce: 0.1 }, rsd: 0.3, q: 0.3, aroma: { savoury: 0.5 }, solid: true, not: /\b(scallion|spring|green)\b/ },
  { id: 'garlic', match: /\b(garlic|sarimsak)\b/, chem: { se: 1, ce: 0.1, nacl: 0.04, fat: 0.5 }, rsd: 0.3, q: 0.3, aroma: { savoury: 0.9 }, solid: true },
  { id: 'carrot', match: /\b(carrot|havuc)\b/, chem: { se: 4.7, ce: 0.15, nacl: 0.18, fat: 0.2 }, rsd: 0.25, q: 0.35, solid: true },
  { id: 'bell-pepper', match: /\bbell pepper\b/, chem: { se: 3.5, ce: 0.2, nacl: 0.01, fat: 0.3 }, rsd: 0.3, q: 0.3, solid: true, tight: true },
  { id: 'leafy-greens', match: /\b(lettuce|romaine|arugula|spinach|kale|chard|cabbage)\b/, chem: { se: 0.9, nacl: 0.1, fat: 0.3 }, rsd: 0.35, q: 0.3, solid: true },
  { id: 'mushroom', match: /\b(mushroom|shiitake|champignon|cremini)\b/, chem: { se: 1.5, nacl: 0.02, fat: 0.3, glu: 0.05 }, rsd: 0.35, q: 0.3, aroma: { earthy: 0.7, savoury: 0.4 }, solid: true },
  { id: 'potato', match: /\b(potato|patates)\b/, chem: { se: 0.8, nacl: 0.02, fat: 0.1, glu: 0.03 }, rsd: 0.3, q: 0.35, solid: true },
  { id: 'herb', match: /\b(parsley|mint|basil|dill|thyme|rosemary|oregano|sage|tarragon|cilantro|herb)\b/, chem: {}, rsd: 0, q: 0.3, aroma: { herbal: 0.7 }, solid: true },
  { id: 'spice', match: /\b(cumin|paprika|turmeric|cinnamon|cardamom|clove|allspice|nutmeg|sumac|pepper|peppercorn)\b/, chem: { se: 2, nacl: 0.05, fat: 4 }, rsd: 0.5, q: 0.25, aroma: { spice: 0.85, earthy: 0.3 }, solid: true, not: /\b(bell|sweet|chili|chilli|red|green|yellow|hot|roasted|stuffed|jalapeno)\b/ },
  { id: 'nut', match: /\b(almond|walnut|pistachio|hazelnut|cashew|pine nut|peanut)\b/, chem: { se: 4, fat: 55, nacl: 0.01 }, rsd: 0.15, q: 0.35, aroma: { nutty: 0.8 }, solid: true, not: /\b(milk|oil|flour|extract|liqueur|paste)\b/ },
  { id: 'starch', match: /\b(flour|rice|pasta|bread|bulgur|noodle|couscous)\b/, chem: { fat: 1, nacl: 0.05 }, rsd: 0.3, q: 0.3, solid: true },
];

/**
 * Fields a class states to be ABSENT (a real zero): plain gin has no fat, no
 * salt. A field is known for a line only if it is in the class's `chem` or in
 * this list; anything else is unknown, and an unknown field is never read as 0.
 */
const NO_SAVOURY: ReadonlyArray<keyof Chem> = ['fat', 'nacl', 'glu'];
const NO_ALC_SAVOURY: ReadonlyArray<keyof Chem> = ['abv', 'fat', 'nacl', 'glu'];
const PLAIN_FOOD: ReadonlyArray<keyof Chem> = ['abv', 'be'];
const PURE_SWEET: ReadonlyArray<keyof Chem> = [...NO_ALC_SAVOURY, 'ce', 'be'];
const SPIRIT: ReadonlyArray<keyof Chem> = [...NO_SAVOURY, 'se', 'ce'];
export const NONE_BY_CLASS: Record<string, ReadonlyArray<keyof Chem>> = {
  'ice-water': ['abv', 'se', 'ce', 'nacl', 'fat', 'glu', 'nuc', 'be'],
  'honey-agave': PURE_SWEET, 'rich-syrup': PURE_SWEET, 'simple-syrup': PURE_SWEET, sugar: PURE_SWEET,
  'lemon-lime': NO_ALC_SAVOURY, 'orange-juice': NO_ALC_SAVOURY, 'grapefruit-juice': NO_ALC_SAVOURY,
  'pineapple-juice': NO_ALC_SAVOURY, 'cranberry-juice': NO_ALC_SAVOURY,
  vinegar: NO_ALC_SAVOURY, 'tonic-cola': NO_ALC_SAVOURY, balsamic: ['abv', 'fat', 'glu', 'be'],
  'sweet-vermouth': NO_SAVOURY, 'dry-vermouth': NO_SAVOURY, 'bitter-liqueur': NO_SAVOURY, aperol: NO_SAVOURY, fernet: NO_SAVOURY,
  'orange-liqueur': NO_SAVOURY, 'coffee-liqueur': NO_SAVOURY, bitters: NO_SAVOURY,
  wine: NO_SAVOURY, 'red-wine': NO_SAVOURY, 'white-wine': NO_SAVOURY, 'sparkling-wine': NO_SAVOURY, 'fortified-wine': NO_SAVOURY,
  beer: NO_SAVOURY, ipa: NO_SAVOURY, stout: NO_SAVOURY,
  'dark-spirit': SPIRIT, 'clear-spirit': SPIRIT, gin: SPIRIT, 'agave-spirit': SPIRIT, 'anise-spirit': SPIRIT, brandy: SPIRIT,
  // Plain foods hold no ethanol; dairy, egg, meat, fish and starch are not bitter either.
  butter: PLAIN_FOOD, cream: PLAIN_FOOD, yogurt: PLAIN_FOOD, milk: PLAIN_FOOD, cheese: PLAIN_FOOD, 'hard-cheese': PLAIN_FOOD, feta: PLAIN_FOOD,
  'cheddar-type': PLAIN_FOOD, egg: PLAIN_FOOD, 'meat-lamb': PLAIN_FOOD, 'meat-beef': PLAIN_FOOD, pork: PLAIN_FOOD,
  bacon: PLAIN_FOOD, poultry: PLAIN_FOOD, fish: PLAIN_FOOD, anchovy: PLAIN_FOOD, starch: PLAIN_FOOD, oil: [...PLAIN_FOOD, 'se', 'nacl', 'glu'],
  soy: ['abv', 'be'], 'fish-sauce': ['abv', 'be', 'se', 'fat'], mayonnaise: ['abv', 'be', 'se', 'glu'], stock: ['abv', 'be'],
  onion: ['abv'], garlic: ['abv'], carrot: ['abv'], 'bell-pepper': ['abv'], 'leafy-greens': ['abv'],
  mushroom: ['abv'], potato: ['abv', 'be'], tomato: ['abv'], spice: ['abv'], nut: ['abv', 'nacl'], herb: ['abv', 'se', 'nacl', 'fat'],
};

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

/**
 * Saturating curves (R3 step 4): value = 10 * (1 - exp(-x / k)).
 * salty k 0.9 -> 1.4 (r92): at 0.9 a dish seasoned to the usual 1.2 % read 6.6
 * "pronounced" and a grilled kofta at 1.8 % read 7.1, so well-seasoned food read
 * as loudly salty. At 1.4 a solid at 1.2 % reads 5.0 (medium, "noticeably
 * salty"), 2 % reads 6.8, and 3 % (over-salted) still reaches "dominant".
 * bitter k 25 checked, kept: a 20 IBU lager reads 5.5 (medium), a 50 IBU IPA 8.6.
 */
export const K = { sweet: 12, sour: 8, salty: 1.4, bitter: 25, umami: 0.5, fat: 12, aromaRef: 28 } as const;
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
