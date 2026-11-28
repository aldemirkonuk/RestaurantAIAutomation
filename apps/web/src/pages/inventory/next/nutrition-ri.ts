/**
 * Energy in kJ and kcal, and the share of an adult's reference intake (% RI)
 * per 100 g or 100 ml, for the "What's in it" card (r109 inventory-g5). Pure.
 *
 * - kJ = round(kcal x 4.184), from the stored kcal (not the shown one); a
 *   figure nobody stated stays "not known" in both units, never 0.
 * - % RI is given only for a house whose country labels by EU 1169/2011
 *   Annex XIII Part B: the EU27, the EEA states that apply it (IS, LI, NO),
 *   the UK (retained law) and Turkiye (its labelling regulation copies the
 *   annex). A country the table cannot name, or none, gives no %: a wrong
 *   country is worse than an unknown one. The US %DV is per serving, not per
 *   100 g/ml, so a US house gets no %.
 * - Energy's % is taken from kcal against 2 000 kcal; the kJ figure is
 *   derived from the same kcal, so taking it again from 8 400 kJ would round
 *   twice and disagree (8 400 / 4.184 is 2 007.6, not 2 000).
 * - Whole percent; a positive figure below 0.5 % reads "<1%"; a stated 0
 *   reads "0%". No % for an unknown figure, nor for energy worked out from the
 *   ABV alone (it leaves the sugar out, so its share would be too low).
 */
import type { StoredNutrition } from '../../../services/api/inventory';
import { countryByName } from '../../../lib/countries';
import { figureWords } from './nutrition-words';

export const KJ_PER_KCAL = 4.184;

/** The statement 1169/2011 Annex XIII Part B requires wherever % RI is given per 100 g/ml. */
export const RI_STATEMENT = 'Reference intake of an average adult (8 400 kJ / 2 000 kcal)';

/** Annex XIII Part B, per day, for an average adult. */
export const REFERENCE_INTAKE = {
  energyKcal: 2000,
  fatG: 70,
  saturatesG: 20,
  carbohydrateG: 260,
  sugarsG: 90,
  proteinG: 50,
  saltG: 6,
} as const;
export type RiField = keyof typeof REFERENCE_INTAKE;

/** ISO 3166-1 alpha-2 of the countries that label by 1169/2011 Annex XIII Part B. */
const RI_COUNTRIES: ReadonlySet<string> = new Set([
  // EU27
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE',
  'IT', 'LV', 'LT', 'LU', 'MT', 'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
  // EEA, by the EEA Agreement
  'IS', 'LI', 'NO',
  // retained and copied
  'GB', 'TR',
]);

/** True when the house's written country (restaurants.country) labels by Annex XIII Part B. */
export function usesReferenceIntakes(country: string | null | undefined): boolean {
  const c = countryByName(country);
  return c !== null && RI_COUNTRIES.has(c.code);
}

/** kJ from kcal, whole; null for a figure nobody stated. */
export function kjFromKcal(kcal: number | null): number | null {
  if (kcal === null || !Number.isFinite(kcal)) return null;
  return Math.round(kcal * KJ_PER_KCAL);
}

/** "1,464 kJ / 350 kcal", or "not known" when the kcal is not known. */
export function energyWords(kcal: number | null): string {
  const kj = kjFromKcal(kcal);
  if (kj === null) return 'not known';
  return `${kj.toLocaleString('en-GB')} kJ / ${figureWords(kcal, 'kcal')}`;
}

/** One figure's share of its reference intake, "6%" or "<1%"; null when unknown. */
export function riShare(value: number | null, field: RiField): string | null {
  if (value === null || !Number.isFinite(value) || value < 0) return null;
  const pct = (value * 100) / REFERENCE_INTAKE[field];
  if (value > 0 && pct < 0.5) return '<1%';
  return `${Math.round(pct)}%`;
}

type RiSource = Pick<StoredNutrition, 'energyFromAbv'> & Partial<Record<RiField, number | null>>;

/**
 * The % RI of each figure on one card, or null when the house's country gives
 * no %. A field that is absent, unknown or (for energy) from the ABV alone has
 * no entry.
 */
export function referenceIntakes(f: RiSource, country: string | null | undefined): Partial<Record<RiField, string>> | null {
  if (!usesReferenceIntakes(country)) return null;
  const out: Partial<Record<RiField, string>> = {};
  for (const k of Object.keys(REFERENCE_INTAKE) as RiField[]) {
    if (k === 'energyKcal' && f.energyFromAbv) continue;
    const v = f[k];
    const s = riShare(v === undefined ? null : v, k);
    if (s !== null) out[k] = s;
  }
  return out;
}
