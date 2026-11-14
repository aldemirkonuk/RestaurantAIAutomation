/**
 * Two of the house's goods a menu line fits, told apart in words (r37 walk w1
 * M-F1).
 *
 * The walker's house had two goods named "House White". The plan offered two
 * buttons, both "It is House White (wine)", both named "Link House White to
 * House White" for a screen reader: the manager linking a price to one of them
 * could not say which. That choice is the whole point of the offer.
 *
 * Each good is named with its kind, then with only what DIFFERS between the
 * goods offered for that line, in this order: vintage, producer, bottle size,
 * bottle price, glass price, where the good came from. Saying what every good
 * shares would only lengthen the button. A good that does not state a
 * differing detail says so ("no bottle price"), never a blank that reads like
 * the other's value. When nothing the page holds tells two apart, each says
 * its place in the list ("1 of 2 alike"), so the buttons still differ and the
 * person knows the page could not tell them apart either.
 */
import type { HouseCandidate } from '../../../services/api/menus';

/** Formats one price in the house's money. */
export type SayPrice = (n: number) => string;

const SOURCE_WORDS: Record<string, string> = {
  wine_library: 'from the wine library',
  beverage_catalogue: 'from the drinks catalogue',
  house_declared: 'added by hand',
  backfill: 'kept from before',
};

type Detail = (g: HouseCandidate, say: SayPrice) => string;

/** Each detail, said for one good; a missing one is said as missing. */
const DETAILS: Array<[keyof HouseCandidate, Detail]> = [
  ['vintage', (g) => (g.vintage ? String(g.vintage) : 'no vintage')],
  ['producer', (g) => (g.producer ? g.producer : 'no producer')],
  ['bottleSizeMl', (g) => (g.bottleSizeMl ? `${g.bottleSizeMl} ml` : 'no size')],
  ['bottlePrice', (g, say) => (g.bottlePrice == null ? 'no bottle price' : `${say(g.bottlePrice)} a bottle`)],
  ['glassPrice', (g, say) => (g.glassPrice == null ? 'no glass price' : `${say(g.glassPrice)} a glass`)],
  ['source', (g) => (g.source ? SOURCE_WORDS[g.source] ?? `kept as ${g.source}` : 'source not recorded')],
];

/**
 * The words for each good, in the order given: "House White (wine, 750 ml,
 * ₺30,00 a bottle)". One good alone is named by its kind only.
 */
export function houseCandidateWords(goods: HouseCandidate[], say: SayPrice): string[] {
  const kindOf = (g: HouseCandidate) => (g.kind ? [g.kind] : []);
  if (goods.length < 2) return goods.map((g) => `${g.name}${g.kind ? ` (${g.kind})` : ''}`);
  const differing = DETAILS.filter(([, words]) => new Set(goods.map((g) => words(g, say))).size > 1);
  const parts = goods.map((g) => [...kindOf(g), ...differing.map(([, words]) => words(g, say))]);
  const said = goods.map((g, i) => `${g.name}${parts[i].length ? ` (${parts[i].join(', ')})` : ''}`);
  // Still alike: say each one's place, so no two buttons share a name.
  const count = new Map<string, number>();
  for (const w of said) count.set(w, (count.get(w) ?? 0) + 1);
  const seen = new Map<string, number>();
  return goods.map((g, i) => {
    const n = count.get(said[i]) ?? 1;
    if (n < 2) return said[i];
    const at = (seen.get(said[i]) ?? 0) + 1;
    seen.set(said[i], at);
    return `${g.name} (${[...parts[i], `${at} of ${n} alike`].join(', ')})`;
  });
}
