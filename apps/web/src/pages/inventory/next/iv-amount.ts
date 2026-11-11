/**
 * What a person types for one good, in that good's own unit (ADR 0070: the
 * book keeps whole g, ml or a count).
 *
 * A kitchen weighs in kilograms and a bar measures in litres, so a good kept in
 * g or ml takes a decimal in kg or l ("2.25" or "2,25" is 2,250 g), or a whole
 * figure with its own small unit ("250 g", "330 ml", "70 cl"). Anything that
 * does not land on a whole g or ml is refused, never rounded: half a gram the
 * book cannot hold would be a quiet change to what was counted. A good kept in
 * bottles, cases, kegs, packs or items takes a whole number, as before.
 */
import { fmtQty } from './ItemCards';
import { fmtCount } from './useInventoryNextData';

export interface AmountUnit {
  /** The book's unit: 'g', 'ml', or a counted unit ('bottle' when none is recorded). */
  base: string;
  /** True when the field takes whole numbers only (a count of things). */
  whole: boolean;
  /** "bottles", "items", "kg", "l": what the field is in, for its label. */
  fieldUnit: string;
  /** Under the field: what may be typed. */
  hint: string;
  /** The typed text as a whole amount in the book's unit, or null when it is not one. */
  parse: (typed: string) => number | null;
  /** An amount in the book's unit, in words: "2.25 kg", "3 bottles". */
  words: (n: number) => string;
}

/** Most a single count or write-off may say: 10 tonnes, 10,000 l, or 100,000 of a counted unit. */
const MAX_BASE = 10_000_000;
const MAX_COUNT = 100_000;

const COUNTED: Record<string, string> = {
  bottle: 'bottles',
  case: 'cases',
  keg: 'kegs',
  pack: 'packs',
  glass: 'glasses',
  shot: 'shots',
  each: 'items',
};

/**
 * A weighed or poured amount said exactly: 11,750 g is "11.75 kg", never the
 * one-place "11.8 kg" the list rounds to, since this is what is about to be booked.
 */
function exactMeasure(n: number, small: string, large: string): string {
  const exact = (v: number) => v.toLocaleString('en-GB', { maximumFractionDigits: 3 });
  return Math.abs(n) >= 1000 ? `${exact(n / 1000)} ${large}` : `${exact(n)} ${small}`;
}

/** "2.25" with factor 1000 → 2250; null when the result is not a whole number. */
function scaled(intPart: string, frac: string, factor: number): number | null {
  const d = frac.length;
  const pow = 10 ** d;
  const num = Number(intPart) * pow + (d > 0 ? Number(frac) : 0);
  const total = num * factor;
  if (total % pow !== 0) return null;
  const n = total / pow;
  return Number.isSafeInteger(n) ? n : null;
}

const MEASURED = /^(\d{1,9})(?:[.,](\d{1,3}))?\s*([a-zA-Z]*)$/;

function measuredParser(factors: Record<string, number>) {
  return (typed: string): number | null => {
    const m = MEASURED.exec(typed.trim());
    if (!m) return null;
    const factor = factors[m[3].toLowerCase()];
    if (factor === undefined) return null;
    const n = scaled(m[1], m[2] ?? '', factor);
    return n === null || n > MAX_BASE ? null : n;
  };
}

function wholeParser(typed: string): number | null {
  const t = typed.trim();
  if (!/^\d{1,6}$/.test(t)) return null;
  const n = Number(t);
  return n > MAX_COUNT ? null : n;
}

/** The unit a good's amounts are typed and said in. A good with no unit recorded is in bottles. */
export function amountUnit(uom: string | null | undefined): AmountUnit {
  if (uom === 'g') {
    return {
      base: 'g',
      whole: false,
      fieldUnit: 'kg',
      hint: 'In kilograms: 2.25 is 2.25 kg. Or type grams, as 250 g.',
      parse: measuredParser({ '': 1000, kg: 1000, g: 1 }),
      words: (n) => exactMeasure(n, 'g', 'kg'),
    };
  }
  if (uom === 'ml') {
    return {
      base: 'ml',
      whole: false,
      fieldUnit: 'l',
      hint: 'In litres: 1.5 is 1.5 l. Or type 70 cl or 330 ml.',
      parse: measuredParser({ '': 1000, l: 1000, cl: 10, ml: 1 }),
      words: (n) => exactMeasure(n, 'ml', 'l'),
    };
  }
  const base = uom ?? 'bottle';
  const plural = COUNTED[base] ?? base;
  return {
    base,
    whole: true,
    fieldUnit: plural,
    hint: `A whole number of ${plural}.`,
    parse: wholeParser,
    words: (n) => (base === 'each' ? `${fmtCount(n)} ${n === 1 ? 'item' : 'items'}` : fmtQty(n, base)),
  };
}

/** A good that is poured by the glass: only these are offered "Record a pour". */
export function isPoured(uom: string | null | undefined, kind: string | null | undefined): boolean {
  if (kind === 'food' || kind === 'supply') return false;
  return uom === null || uom === undefined || uom === 'bottle' || uom === 'keg';
}

/**
 * The unit an order for this good is placed in (procurement ORDER_UNIT_TYPES),
 * or null when no order unit fits one-to-one with the book: an order has no
 * weight unit, and a case or pack order needs a pack size this sheet does not
 * ask, so such a good is not ordered from here rather than ordered in bottles.
 */
export function orderUnitOf(uom: string | null | undefined): 'bottle' | 'keg' | 'each' | null {
  if (uom === null || uom === undefined || uom === 'bottle') return 'bottle';
  if (uom === 'keg' || uom === 'each') return uom;
  return null;
}
