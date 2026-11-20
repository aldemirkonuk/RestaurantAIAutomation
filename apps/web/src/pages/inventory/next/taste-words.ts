/**
 * Taste, in words (TasteCard.tsx, TasteForm.tsx).
 *
 * The rule of this file: a number on the 0..10 scale never reaches a screen. A
 * fused 6.36 would read as a measurement; nobody measured it. The card says a
 * band word, draws a bar, and says where the figure came from. No axis key,
 * provenance kind or source code reaches a screen either: each has a sentence
 * here, and an unknown one has a generic sentence, never the raw code.
 */
import { AXIS_KEYS, BAND_ONLY_BELOW, PROV_KINDS, type AxisKey, type ProvKind, type TasteAxis, type TasteData, type TasteEffective } from '../../../services/api/taste';

export const AXIS_LABEL: Record<AxisKey, string> = {
  sweet: 'Sweet',
  sour: 'Sour',
  salty: 'Salty',
  bitter: 'Bitter',
  umami: 'Umami',
  fat: 'Richness',
  heat: 'Heat (chilli, pepper)',
  alcohol: 'Alcohol warmth',
  astringency: 'Drying (astringency)',
  body: 'Body',
  carbonation: 'Fizz',
  aroma_intensity: 'Aroma strength',
  fruit: 'Fruit',
  citrus: 'Citrus',
  floral: 'Floral',
  herbal: 'Herbal',
  spice: 'Spice',
  nutty: 'Nutty',
  roasted: 'Roasted',
  smoky: 'Smoky',
  savoury: 'Savoury',
  earthy: 'Earthy',
  dairy: 'Dairy',
  woody: 'Woody',
  funky: 'Funky',
};

/** An axis named inside a sentence: "Sources disagree on richness." */
export const axisName = (k: AxisKey): string => AXIS_LABEL[k].split(' (')[0].toLowerCase();

/** The word an axis takes in a sentence ("mainly salty and rich"). */
export const AXIS_ADJECTIVE: Record<AxisKey, string> = {
  sweet: 'sweet', sour: 'sour', salty: 'salty', bitter: 'bitter', umami: 'umami', fat: 'rich', heat: 'hot', alcohol: 'warming with alcohol',
  astringency: 'drying', body: 'full-bodied', carbonation: 'fizzy', aroma_intensity: 'aromatic', fruit: 'fruity', citrus: 'citrusy',
  floral: 'floral', herbal: 'herbal', spice: 'spiced', nutty: 'nutty', roasted: 'roasted', smoky: 'smoky', savoury: 'savoury',
  earthy: 'earthy', dairy: 'creamy', woody: 'woody', funky: 'funky',
};

export const BAND_WORDS = ['none', 'hint', 'light', 'medium', 'pronounced', 'dominant'] as const;
export type Band = (typeof BAND_WORDS)[number];

/**
 * Where each band begins on the 0..10 scale: 0.5, 2, 4, 6, 8. Each step the
 * form offers (ORDINAL_STEPS) lands inside its own band, so a person who says
 * "medium" reads back as "medium".
 */
export const BAND_EDGES = [0.5, 2, 4, 6, 8] as const;

export function bandOf(v: number): Band {
  let i = 0;
  while (i < BAND_EDGES.length && v >= BAND_EDGES[i]) i += 1;
  return BAND_WORDS[i];
}

/** The five-step level a person picks, as the value it is stored as. */
export const ORDINAL_STEPS: ReadonlyArray<{ word: Band; v: number }> = [
  { word: 'none', v: 0 },
  { word: 'hint', v: 1.5 },
  { word: 'light', v: 3 },
  { word: 'medium', v: 5 },
  { word: 'pronounced', v: 7 },
  { word: 'dominant', v: 9 },
];

export type MarkShape = 'solid' | 'tick' | 'hatched' | 'bubble';

/** The mark on a row: solid measured; tick worked out or looked up; hatched a typical value; bubble a person's word. */
export const PROV_MARK: Record<ProvKind, { shape: MarkShape; words: string }> = {
  measured: { shape: 'solid', words: 'measured' },
  recipe: { shape: 'tick', words: 'worked out from the recipe' },
  dataset: { shape: 'tick', words: 'looked up in a reference' },
  standard: { shape: 'tick', words: 'from a published standard' },
  class_default: { shape: 'hatched', words: 'a typical value for this kind of good, not tasted here' },
  ai_draft: { shape: 'hatched', words: 'a draft, not checked by anyone' },
  staff_note: { shape: 'bubble', words: 'a staff note' },
  staff_line: { shape: 'bubble', words: 'what staff said' },
};

/** How a stored layer reads in the list of who stated it. Unknown sources read generically. */
export const SOURCE_WORDS: Record<string, string> = {
  house: 'Described by the house',
  measured: 'Measured',
  recipe: 'Worked out from the recipe',
  dataset: 'Looked up in a reference',
  standard: 'From a published standard',
  class_default: 'A typical value for this kind of good',
  class: 'A typical value for this kind of good',
  ai_draft: 'A draft, not checked',
};
export const sourceWords = (source: string): string => SOURCE_WORDS[source] ?? 'Another source';

export interface DescriptorGroup {
  title: string;
  /** What is stored is `id`; what is shown is `label`. */
  items: ReadonlyArray<{ id: string; label: string }>;
}
/** A stored id shows as words: "citrus-fruit" reads "citrus fruit"; the older food ids keep their hyphens. */
const chips = (...ids: string[]) => ids.map((id) => ({ id, label: id }));
const spaced = (...ids: string[]) => ids.map((id) => ({ id, label: id.replace(/-/g, ' ') }));

const FOOD_FLAVOUR = chips('savoury', 'rich', 'fresh', 'bright', 'balanced', 'sharp', 'mellow', 'sweet-and-sour', 'spicy', 'smoky', 'herby', 'tangy');
const FOOD_TEXTURE = chips('crisp', 'creamy', 'chewy', 'flaky', 'juicy', 'silky', 'crunchy', 'tender', 'grainy', 'sticky');

/** Which word list a good is tasted with. The gateway holds the same lists (taste-descriptors.ts) and refuses a word outside the item's own. */
export type DescriptorFamily = 'food' | 'wine' | 'spirit' | 'beer' | 'coffee' | 'cocktail';
const FAMILY_BY_KIND: Record<string, DescriptorFamily> = {
  wine: 'wine', sake: 'wine', cider: 'wine',
  spirit: 'spirit', whiskey: 'spirit', liqueur: 'spirit',
  beer: 'beer', non_alcoholic: 'coffee', soft_drink: 'coffee', cocktail: 'cocktail',
};
/** Anything unlisted (food, other, no kind) is tasted with the food words, never with none. */
export const descriptorFamily = (kind: string | null | undefined): DescriptorFamily => FAMILY_BY_KIND[kind ?? ''] ?? 'food';

const FINISH = spaced('short-finish', 'medium-finish', 'long-finish');
const DRINK_TEXTURE = chips('crisp', 'creamy', 'silky');

const GROUPS_BY_FAMILY: Record<DescriptorFamily, ReadonlyArray<DescriptorGroup>> = {
  food: [{ title: 'Flavour', items: FOOD_FLAVOUR }, { title: 'Texture', items: FOOD_TEXTURE }],
  wine: [
    { title: 'Fruit', items: spaced('citrus-fruit', 'green-fruit', 'stone-fruit', 'tropical-fruit', 'red-fruit', 'black-fruit', 'dried-fruit') },
    { title: 'Other aromas', items: spaced('floral', 'herbal', 'spice', 'oak', 'earthy', 'mineral') },
    { title: 'Finish', items: FINISH },
    { title: 'Texture', items: DRINK_TEXTURE },
  ],
  spirit: [
    { title: 'Fruit', items: spaced('citrus-fruit', 'orchard-fruit', 'stone-fruit', 'tropical-fruit', 'dried-fruit') },
    { title: 'Other aromas', items: spaced('floral', 'herbal', 'juniper', 'spice', 'vanilla', 'caramel', 'oak', 'smoky', 'earthy', 'nutty') },
    { title: 'Finish', items: FINISH },
    { title: 'Texture', items: DRINK_TEXTURE },
  ],
  beer: [
    { title: 'Malt', items: spaced('bready', 'biscuity', 'caramel', 'toasty', 'roasty', 'chocolate') },
    { title: 'Hops', items: spaced('citrus-fruit', 'piney', 'floral', 'herbal') },
    { title: 'Yeast and finish', items: spaced('fruity-yeast', 'spicy-yeast', 'clean', 'tart', 'funky', 'dry-finish') },
    { title: 'Texture', items: DRINK_TEXTURE },
  ],
  coffee: [
    { title: 'Flavour', items: spaced('berry', 'citrus-fruit', 'stone-fruit', 'floral', 'honey', 'caramel', 'nutty', 'cocoa', 'spice', 'roasted', 'smoky', 'vegetal', 'winey', 'clean') },
    { title: 'Texture', items: DRINK_TEXTURE },
  ],
  cocktail: [
    { title: 'Balance', items: spaced('spirit-forward', 'boozy', 'balanced', 'sour-led', 'sweet-led', 'bitter-led', 'refreshing', 'strong', 'long-and-light') },
    { title: 'Aromas', items: spaced('citrus-fruit', 'herbal', 'spice', 'smoky') },
    { title: 'Texture', items: DRINK_TEXTURE },
  ],
};

/** The chips offered for a good of this kind. */
export const descriptorGroupsFor = (kind: string | null | undefined): ReadonlyArray<DescriptorGroup> => GROUPS_BY_FAMILY[descriptorFamily(kind)];

/** The food chips (the original list). */
export const DESCRIPTOR_GROUPS: ReadonlyArray<DescriptorGroup> = GROUPS_BY_FAMILY.food;
const DESCRIPTOR_LABEL: ReadonlyMap<string, string> = new Map(
  Object.values(GROUPS_BY_FAMILY).flatMap((gs) => gs.flatMap((g) => g.items.map((i) => [i.id, i.label] as const))),
);
/** The words a server-sent descriptor may show as: only ones some form offers, never a raw code. */
export const descriptorWord = (id: string): string | null => DESCRIPTOR_LABEL.get(id) ?? null;
export const TEXTURE_IDS: ReadonlySet<string> = new Set(FOOD_TEXTURE.map((i) => i.id));

/** Axes the card shows, strongest first. A conflicted axis is withheld: it has no value to show. */
export function knownAxes(e: TasteEffective): Array<[AxisKey, TasteAxis]> {
  const withheld = new Set(e.conflicts.map((c) => c.axis));
  return AXIS_KEYS.filter((k) => e.axes[k] && !withheld.has(k))
    .map((k) => [k, e.axes[k] as TasteAxis] as [AxisKey, TasteAxis])
    .sort((a, b) => b[1].v - a[1].v || AXIS_KEYS.indexOf(a[0]) - AXIS_KEYS.indexOf(b[0]));
}

const join = (w: string[]) => (w.length <= 1 ? w.join('') : `${w.slice(0, -1).join(', ')} and ${w[w.length - 1]}`);

/** The sentence, and the axes it was built from, taken from axes with conf >= 0.4 only (a band-only axis is never a headline). */
function summaryParts(e: TasteEffective): { text: string; axes: AxisKey[] } | null {
  const firm = knownAxes(e).filter(([, a]) => !a.bandOnly && a.conf >= BAND_ONLY_BELOW);
  const lead = firm.filter(([, a]) => ['pronounced', 'dominant'].includes(bandOf(a.v))).slice(0, 3);
  const mid = firm.filter(([, a]) => bandOf(a.v) === 'medium').slice(0, 2);
  const light = firm.filter(([, a]) => ['light', 'hint'].includes(bandOf(a.v))).slice(0, 2);
  const w = (xs: typeof firm) => xs.map(([k]) => AXIS_ADJECTIVE[k]);
  const keys = (xs: typeof firm) => xs.map(([k]) => k);
  if (lead.length) return { text: `Mainly ${join(w(lead))}${mid.length ? `, with some ${join(w(mid))}` : ''}`, axes: [...keys(lead), ...keys(mid)] };
  if (mid.length) return { text: `Moderately ${join(w(mid))}`, axes: keys(mid) };
  if (light.length) return { text: `Gently ${join(w(light))}`, axes: keys(light) };
  return null;
}

/** What a cook calls each key of a roll-up's lead: fat is "rich", umami is "savoury". An unknown key has no word and is dropped. */
export const LEAD_WORD: Record<string, string> = { sweet: 'sweet', sour: 'sour', salty: 'salty', bitter: 'bitter', umami: 'savoury', fat: 'rich', savoury: 'savoury' };

/**
 * The lead of a worked-out recipe layer: the words it names, and the axes
 * they stand on. Null when no layer carries a lead, or it names nothing (a
 * stale layer, or no taste reached medium): the caller then reads the axes.
 */
function leadOf(d: TasteData): { words: string[]; axes: AxisKey[] } | null {
  const lead = d.layers.find((l) => l.basis?.lead)?.basis?.lead ?? null;
  if (!lead) return null;
  const known = lead.filter((k) => k in LEAD_WORD);
  const words = [...new Set(known.map((k) => LEAD_WORD[k]))];
  return words.length ? { words, axes: known.filter((k): k is AxisKey => (AXIS_KEYS as readonly string[]).includes(k)) } : null;
}

/** The card's header sentence: the roll-up's lead when it has one (no confidence gate: it is the loudest tastes, said), else the axes. */
export function summaryFor(d: TasteData): string | null {
  const lead = leadOf(d);
  if (lead) return `Mainly ${join(lead.words)}.`;
  return d.effective ? summaryLine(d.effective) : null;
}

/** One sentence from the axes with conf >= 0.4 only. Null when there is nothing to say. */
export function summaryLine(e: TasteEffective): string | null {
  const p = summaryParts(e);
  return p === null ? null : `${p.text}.`;
}

/** A stored layer's source, as the mark kind it shows under. An unknown source has no mark. */
const LAYER_KIND: Record<string, ProvKind> = {
  house: 'staff_line', note: 'staff_note', measured: 'measured', recipe: 'recipe', dataset: 'dataset',
  standard: 'standard', class_default: 'class_default', class: 'class_default', ai_draft: 'ai_draft',
};
const kindsOf = (kinds: Iterable<ProvKind>): ProvKind[] => {
  const have = new Set(kinds);
  return PROV_KINDS.filter((k) => have.has(k));
};

/**
 * The one line the drawer's first screen shows: the sentence the card leads
 * with, and the marks of where it came from. A sentence from the axes names
 * the sources of the axes it used; "Described as ..." and "Sources disagree"
 * name the sources of the layers. Null when nothing is known, so the first
 * screen says nothing rather than something empty.
 */
export function leadLine(d: TasteData): { sentence: string; kinds: ProvKind[] } | null {
  const e = d.effective;
  if (!e) return null;
  const fromLayers = kindsOf(d.layers.map((l) => LAYER_KIND[l.source]).filter((k): k is ProvKind => k !== undefined));
  const lead = leadOf(d);
  if (lead) {
    const kinds = kindsOf(lead.axes.flatMap((k) => (e.axes[k]?.prov ?? []).map((p) => p.kind)));
    return { sentence: `Mainly ${join(lead.words)}.`, kinds: kinds.length ? kinds : ['recipe'] };
  }
  const parts = summaryParts(e);
  if (parts) {
    return { sentence: `${parts.text}.`, kinds: kindsOf(parts.axes.flatMap((k) => (e.axes[k] as TasteAxis).prov.map((p) => p.kind))) };
  }
  const words = [...e.descriptors, ...e.texture].map(descriptorWord).filter((x): x is string => x !== null);
  if (words.length) return { sentence: `Described as ${words.join(', ')}.`, kinds: fromLayers };
  if (e.conflicts.length) return { sentence: `Sources disagree on ${join(e.conflicts.map((c) => axisName(c.axis)))}.`, kinds: fromLayers };
  return null;
}

/** The one next step for a row, or null when there is none worth saying. */
export function nextAction(axis: AxisKey, e: TasteEffective): string | null {
  if (e.conflicts.some((c) => c.axis === axis)) return 'Taste it again and describe it, so the sources can settle.';
  const a = e.axes[axis];
  if (!a) return null;
  const kinds = new Set(a.prov.map((p) => p.kind));
  const onlyTypical = [...kinds].every((k) => k === 'class_default' || k === 'ai_draft');
  if (a.bandOnly || onlyTypical) return 'Nobody has tasted this here. Describe the taste to replace the guess.';
  if (kinds.has('recipe') && !kinds.has('staff_note') && !kinds.has('staff_line') && !kinds.has('measured')) return 'Taste it and describe it, to check the recipe’s figure.';
  return null;
}

/** "from a staff note and the recipe" for a row's marks. */
export function provenanceWords(a: TasteAxis): string {
  return join(a.prov.map((p) => PROV_MARK[p.kind].words));
}

/** The range a whisker draws, said in words ("between light and pronounced"); null when there is no range. */
export function rangeWords(a: TasteAxis): string | null {
  if (a.bandOnly || a.lo === null || a.hi === null) return null;
  const lo = bandOf(a.lo);
  const hi = bandOf(a.hi);
  return lo === hi ? `Most likely ${lo}.` : `Between ${lo} and ${hi}.`;
}

export interface FooterWords {
  names: string[];
  latest: string | null;
  sources: number;
}
/** Who stated it, when, and how many layers say so. */
export function footerFacts(d: TasteData): FooterWords {
  // Only a house layer was stated by a person; a recipe layer carries a label in that column.
  const names = [...new Set(d.layers.filter((l) => l.source === 'house').map((l) => l.statedByName).filter((n): n is string => n !== null))];
  const times = d.layers.map((l) => l.statedAt).filter((t): t is string => t !== null);
  const latest = times.sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;
  return { names, latest, sources: d.layers.length };
}
