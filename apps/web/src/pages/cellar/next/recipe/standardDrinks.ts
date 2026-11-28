/**
 * A serve's pure alcohol as the house's country counts it, and the drink's
 * strength before ice and water (r110 drinks-g1). Pure: the figures are the
 * gateway's (`whatIsIn.figures.alcoholMl`, recipe-nutrition.ts); nothing here
 * reads a store.
 *
 * Standard drinks: grams of ethanol a serve over the country's own standard
 * drink (US 14 g, the UK unit 8 g, Australia, New Zealand and Ireland 10 g,
 * Canada 13.45 g). A country not in the table gets the grams only: the WHO's
 * 10 g is a research convention, not the drink the house's guests are told to
 * count, so it is never used as a default (decision r110 drinks-g1).
 *
 * Only a complete figure is turned into standard drinks. "At least 20 ml"
 * would read as fewer drinks than the serve holds, so a partial figure says
 * which line states no strength instead (ADR 0051: unknown is a word).
 *
 * Strength: pure alcohol over the serve's poured volume, the lines measured by
 * volume (ml10). It is the spec's strength before ice melt and any top-up of
 * water, and is said so. A counted line weighed or counted in pieces (sugar in
 * g, an egg white each) has no volume here, so the strength is not worked out
 * rather than divided by a volume that leaves it out.
 */
import type { RecipeLine, ServeFigure } from '../../../../services/api/recipes';
import { ETHANOL_G_PER_ML, names } from './WhatIsInAServe';
import { formatHouseNumber, formatHousePercent } from '../../../../lib/house-number';
import { countryByName } from '../../../../lib/countries';

/** Grams of ethanol in one standard drink, by ISO country code. */
export const STD_G = { US: 14, GB: 8, AU: 10, NZ: 10, IE: 10, CA: 13.45 } as const;
export type StdCountry = keyof typeof STD_G;

/** How each country names its measure: [one, many]. */
const STD_WORDS: Record<StdCountry, [string, string]> = {
  US: ['US standard drink', 'US standard drinks'],
  GB: ['UK unit', 'UK units'],
  AU: ['Australian standard drink', 'Australian standard drinks'],
  NZ: ['NZ standard drink', 'NZ standard drinks'],
  IE: ['Irish standard drink', 'Irish standard drinks'],
  CA: ['Canadian standard drink', 'Canadian standard drinks'],
};

/**
 * The house's country as one of the table's ISO keys, or null. The column holds
 * what Google Places wrote ('United States', 'United Kingdom', 'Türkiye'), not a
 * code, so the name goes through the one country table first (lib/countries.ts).
 */
const stdCountryOf = (c: string | null | undefined): StdCountry | null => {
  const code = countryByName(c)?.code;
  return code !== undefined && Object.prototype.hasOwnProperty.call(STD_G, code) ? (code as StdCountry) : null;
};

export type StandardDrinks =
  | { kind: 'not_worked_out'; missing: string[] }
  | { kind: 'grams'; grams: number }
  | { kind: 'drinks'; drinks: number; grams: number; country: StdCountry };

const round1 = (n: number) => Math.round(n * 10) / 10;

/** The serve's standard drinks for `country`, or grams only, or why not worked out. */
export function standardDrinks(alcohol: ServeFigure, country: string | null | undefined): StandardDrinks {
  if (alcohol.value === null || alcohol.atLeast || alcohol.missing.length > 0) {
    return { kind: 'not_worked_out', missing: alcohol.missing };
  }
  const grams = alcohol.value * ETHANOL_G_PER_ML;
  const c = stdCountryOf(country);
  if (c === null) return { kind: 'grams', grams };
  return { kind: 'drinks', drinks: round1(grams / STD_G[c]), grams, country: c };
}

export type Strength =
  | { kind: 'pct'; pct: number }
  | { kind: 'not_by_volume'; lines: string[] }
  | { kind: 'none' };

/**
 * Pure alcohol over the poured volume a serve, in percent points. Only a
 * complete alcohol figure, and only when every counted line is measured by
 * volume; the volume is the ml-family lines (qtyBase is tenths of a ml).
 */
export function strengthBeforeWater(alcohol: ServeFigure, lines: RecipeLine[], yieldServes: number): Strength {
  if (alcohol.value === null || alcohol.atLeast || alcohol.missing.length > 0) return { kind: 'none' };
  const notByVolume = lines.filter((l) => l.role !== 'untracked' && l.baseUnit !== 'ml10');
  if (notByVolume.length > 0) return { kind: 'not_by_volume', lines: notByVolume.map((l) => l.itemName ?? l.label) };
  const serves = Number.isInteger(yieldServes) && yieldServes > 0 ? yieldServes : 1;
  const ml = lines.filter((l) => l.baseUnit === 'ml10').reduce((a, l) => a + Number(l.qtyBase) / 10, 0) / serves;
  if (!(ml > 0)) return { kind: 'none' };
  return { kind: 'pct', pct: (alcohol.value / ml) * 100 };
}

/**
 * The pure-alcohol card's two lines, in the house's number form (`currency`
 * picks it, as every house figure does):
 * - `std`: "1.4 US standard drinks (14 g each)". `country` undefined means not
 *   read yet: it is empty, and the card holds its room (2lh) so nothing moves.
 * - `strength`: "27% before ice and water". It needs no country, so it is
 *   there from the card's first paint.
 */
export function alcoholLines(
  alcohol: ServeFigure,
  lines: RecipeLine[],
  yieldServes: number,
  country: string | null | undefined,
  currency: string | null,
): { std: string; strength: string } {
  let std = '';
  const d = standardDrinks(alcohol, country);
  if (d.kind === 'not_worked_out') {
    std =
      d.missing.length > 0
        ? `Standard drinks not worked out: ${names(d.missing)} ${d.missing.length === 1 ? 'states' : 'state'} no strength.`
        : 'Standard drinks not worked out: no ingredient states its strength.';
  } else if (d.kind === 'drinks') {
    const [one, many] = STD_WORDS[d.country];
    std = `${formatHouseNumber(d.drinks, currency, { digits: 1 })} ${d.drinks === 1 ? one : many} (${formatHouseNumber(STD_G[d.country], currency, { max: 2 })} g each)`;
  } else if (country !== undefined) {
    const g = formatHouseNumber(round1(d.grams), currency, { digits: 1 });
    std = country === null ? `${g} g; the house's country is not set` : `${g} g; no standard drink for this country`;
  }
  const s = strengthBeforeWater(alcohol, lines, yieldServes);
  const strength =
    s.kind === 'pct'
      ? `${formatHousePercent(s.pct, currency, { digits: 0 })} before ice and water`
      : s.kind === 'not_by_volume'
        ? `Strength not worked out: ${names(s.lines)} ${s.lines.length === 1 ? 'is' : 'are'} not measured by volume.`
        : '';
  return { std, strength };
}
