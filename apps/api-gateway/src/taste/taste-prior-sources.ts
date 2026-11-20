/**
 * Where each class prior's numbers come from (r92). A code names a published
 * table, a label, or a stated estimate; EST means no published composition was
 * found for the class and the value is set from its rank among peers, to be
 * fitted by the blind panel. Nothing here is a measurement of a house's own
 * bottle, which is why a class prior's belief never passes 0.6.
 */
export const PRIOR_SOURCES: Record<string, string> = {
  USDA: 'USDA FoodData Central, SR Legacy (fdc.nal.usda.gov); NaCl g = sodium mg x 2.54 / 1000; sugars as sucrose-equivalent per R3 section 2',
  N98: 'Ninomiya K (1998) Natural occurrence of umami. Food Reviews International 14:177-211 (free glutamate, mg/100 g)',
  YN00: 'Yamaguchi S, Ninomiya K (2000) Umami and food palatability. J Nutr 130:921S-926S (free glutamate and 5\'-nucleotides)',
  PEN08: 'Penniston KL et al (2008) Quantitative assessment of citric acid in lemon juice, lime juice and commercial juices. J Endourol 22:567-570',
  BJCP: 'BJCP 2021 Beer Style Guidelines (ABV and IBU ranges by style)',
  LBL: 'Bottle label / legal bottling strength of the usual product',
  R3: 'R3-DERIVE.md (2026-11-19) sections 2-5: starting value, not fitted',
  SALT: 'Salt norms: Campbell\'s regular tomato soup is about 0.8 % NaCl (US patent 5,260,091, salt taste enhancers); Jeon et al 2014 Food Qual Prefer 35 on optimum soup salt by tasting protocol; solid-food 1.0-1.5 % and over-salted above about 2 % are culinary norms, not a cited table (see BUILD-priors-r92.md)',
  UNV: 'UNVERIFIED ESTIMATE: at least one figure in this class could not be checked against a source in r93 (recalled, cut-dependent, or sources disagree); VERIFY-priors-r93.md says which. The confidence model reads only the class q, so this is a record, not a discount',
  EST: 'No published composition found; set from rank among peers, to be fitted against the blind panel',
};

/** Source codes behind each class id, and a note where a value is not a plain table read. */
export const CLASS_SOURCES: Record<string, { codes: string[]; note?: string }> = {
  'ice-water': { codes: ['R3'] },
  'honey-agave': { codes: ['USDA'], note: 'honey sugars 82.1 g (fructose 40.9 x1.4 + glucose 35.8 x0.75 + other 5.4 x0.4 = 86); r93 corrected 75 -> 85; maple is 67 so maple reads high' },
  'rich-syrup': { codes: ['EST'], note: '2:1 sugar:water by weight' },
  'simple-syrup': { codes: ['R3'], note: '1:1 by volume' },
  sugar: { codes: ['USDA'] }, salt: { codes: ['USDA'] },
  'lemon-lime': { codes: ['R3', 'PEN08'], note: 'R3 6.0 kept; Penniston measured 4.9 (lemon) and 4.7 (lime) g/100 mL, so house titration should replace it' },
  'orange-juice': { codes: ['USDA'] }, 'grapefruit-juice': { codes: ['USDA', 'UNV'] },
  'pineapple-juice': { codes: ['USDA', 'EST'], note: 'sugars from SR; acid is EST' },
  'cranberry-juice': { codes: ['USDA', 'EST'], note: 'the sweetened "cocktail" a bar pours; acid EST' },
  'sweet-vermouth': { codes: ['R3', 'LBL'] }, 'dry-vermouth': { codes: ['R3', 'LBL'] },
  'bitter-liqueur': { codes: ['LBL', 'EST'], note: 'ABV label; bitter-equivalents EST (no published IBU for liqueurs)' },
  aperol: { codes: ['LBL', 'EST'], note: '11 % ABV label; bitter EST, below Campari' },
  fernet: { codes: ['LBL', 'EST'] },
  'orange-liqueur': { codes: ['LBL', 'EST'], note: 'strength 15-40 % by brand; 35 kept' },
  'coffee-liqueur': { codes: ['USDA', 'LBL'], note: 'SR 53 proof: sugars 38.3 g/100 g' },
  bitters: { codes: ['LBL', 'EST'], note: 'Angostura 44.7 %; bitter-equivalents EST' },
  gin: { codes: ['LBL', 'USDA'] }, 'agave-spirit': { codes: ['LBL'] }, 'anise-spirit': { codes: ['LBL'], note: 'raki 45 %, ouzo 40, pastis 45' },
  brandy: { codes: ['LBL', 'EST'] }, 'dark-spirit': { codes: ['LBL', 'USDA'] }, 'clear-spirit': { codes: ['LBL', 'USDA'] },
  'red-wine': { codes: ['USDA', 'EST'], note: 'SR 10.6 g/100 g = 13.4 % vol; acid as citric-eq from TA 6 g/L tartaric' },
  'white-wine': { codes: ['USDA', 'EST'] }, 'sparkling-wine': { codes: ['LBL', 'EST'], note: 'brut dosage up to 12 g/L' },
  'fortified-wine': { codes: ['USDA', 'LBL'], note: 'SR dessert wine sugars 7.8 g' }, wine: { codes: ['R3', 'USDA'] },
  ipa: { codes: ['BJCP'], note: 'American IPA 40-70 IBU, 5.5-7.5 %' }, stout: { codes: ['BJCP'], note: 'Irish stout 25-45 IBU, 4-4.5 %' },
  beer: { codes: ['BJCP', 'USDA', 'UNV'], note: 'pale lagers 8-40 IBU; SR 3.9 g/100 g = 4.9 % vol' },
  'tonic-cola': { codes: ['USDA', 'EST', 'UNV'] },
  vinegar: { codes: ['R3'], note: '5 % acetic x 0.5 = 2.5 citric-eq' }, balsamic: { codes: ['USDA', 'UNV'] },
  oil: { codes: ['USDA'] }, soy: { codes: ['USDA', 'N98'] }, 'fish-sauce': { codes: ['USDA', 'N98'], note: 'glutamate 621-1383 mg/100 g across products; 1.0 g is mid-range' },
  ketchup: { codes: ['USDA', 'EST'] },
  'caesar-dressing': { codes: ['USDA', 'EST', 'UNV'], note: 'r96: bottled caesar dressing is about 45-50 g oil and about 0.8 g sodium per 100 g by recalled label/SR figures (page not re-opened); glutamate 0.25 is a mid figure between mayonnaise (none) and parmesan 1.2 at the anchovy-and-cheese share a caesar carries; every figure UNV' },
  crouton: { codes: ['USDA', 'EST', 'UNV'], note: 'r96: plain croutons about 10 g fat, about 0.75 g sodium per 100 g by recalled SR figures (page not re-opened); seasoned ones run higher; every figure UNV' },
  mayonnaise: { codes: ['USDA', 'EST'] },
  'tomato-paste': { codes: ['USDA', 'N98', 'EST', 'UNV'] }, 'tomato-canned': { codes: ['USDA', 'N98', 'UNV'] },
  stock: { codes: ['USDA', 'YN00', 'EST', 'UNV'], note: 'commercial broth 0.9 %, home stock 0.1-0.3 %; 0.5 is a seasoned house stock' },
  butter: { codes: ['USDA'] }, cream: { codes: ['USDA'] }, yogurt: { codes: ['USDA'] }, milk: { codes: ['USDA'] },
  'hard-cheese': { codes: ['USDA', 'N98', 'UNV'], note: 'parmesan glutamate 1200 mg/100 g' }, feta: { codes: ['USDA', 'EST', 'UNV'] },
  'cheddar-type': { codes: ['USDA', 'N98'] }, cheese: { codes: ['R3'] }, egg: { codes: ['USDA', 'N98'] },
  tomato: { codes: ['R3', 'USDA', 'N98', 'UNV'] }, 'meat-lamb': { codes: ['R3'] }, 'meat-beef': { codes: ['R3', 'UNV'] },
  pork: { codes: ['USDA', 'YN00', 'UNV'], note: 'nucleotide kept at the R3 meat scale, not the published 0.2 g' },
  bacon: { codes: ['USDA', 'EST', 'UNV'] }, poultry: { codes: ['R3', 'UNV'] }, anchovy: { codes: ['USDA', 'EST', 'UNV'], note: 'glutamate 0.5 g/100 g from a commercial Cantabrian anchovy figure (480 mg); no primary source found' }, fish: { codes: ['R3', 'UNV'] },
  onion: { codes: ['USDA', 'R3'] }, garlic: { codes: ['USDA'] }, carrot: { codes: ['USDA'] }, 'bell-pepper': { codes: ['USDA'] },
  'leafy-greens': { codes: ['USDA', 'UNV'] }, mushroom: { codes: ['USDA', 'N98', 'UNV'] }, potato: { codes: ['USDA', 'N98'] },
  herb: { codes: ['R3', 'UNV'] }, spice: { codes: ['USDA', 'EST', 'UNV'] }, nut: { codes: ['USDA', 'UNV'] }, starch: { codes: ['R3', 'UNV'] },
};
