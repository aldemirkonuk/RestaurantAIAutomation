/**
 * Paste a spec: pasted text in, proposed rows out (proposal §4 F17).
 *
 * A bartender pastes "1½ oz gin / 2 dashes Angostura / 1 egg white" and gets
 * rows to look at and confirm. Parsing never saves anything, and every row it
 * returns is marked `confirmed: false`: a misread the person did not look at
 * must never become a recipe line. An unlinked counted row stays visibly in
 * --warn on the sheet, so nothing takes stock until it is linked.
 *
 * Units are the closed menu (F3). A number with no unit word from the menu is
 * read as a count (`each`), and the rest of the line is the label; the person
 * sees both before anything is kept.
 */

import type { RecipeUnit } from './units';

export type LineRole = 'stocked' | 'untracked';

export interface ProposedLine {
  qty: number | null;
  unit: RecipeUnit | null;
  label: string;
  role: LineRole;
  confirmed: false;
}

const VULGAR: Record<string, number> = {
  '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3,
  '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875,
};

/** Unit words (lower case) onto the closed menu. Longest words first in the regex. */
const UNIT_WORDS: Record<string, RecipeUnit> = {
  ml: 'ml', milliliter: 'ml', milliliters: 'ml', millilitre: 'ml', millilitres: 'ml',
  cl: 'cl', centiliter: 'cl', centiliters: 'cl', centilitre: 'cl', centilitres: 'cl',
  l: 'l', liter: 'l', liters: 'l', litre: 'l', litres: 'l', lt: 'l',
  oz: 'oz', ounce: 'oz', ounces: 'oz',
  tsp: 'tsp', teaspoon: 'tsp', teaspoons: 'tsp',
  tbsp: 'tbsp', tablespoon: 'tbsp', tablespoons: 'tbsp',
  dash: 'dash', dashes: 'dash',
  barspoon: 'barspoon', barspoons: 'barspoon', bsp: 'barspoon',
  g: 'g', gr: 'g', gram: 'g', grams: 'g', gramme: 'g', grammes: 'g',
  kg: 'kg', kilo: 'kg', kilos: 'kg', kilogram: 'kg', kilograms: 'kg',
  each: 'each', x: 'each',
};

/** Things a bar never counts from the shelf: they carry text and cost nothing. */
const GARNISH = /\b(garnish(?:ed)?|twist|peel|zest|wedge|wheel|sprig|rim(?:med)?)\b/i;
/** Ice and plain water, but not "tonic water" or "soda water", which a bar buys. */
const ICE_OR_WATER = /^(?:(?:crushed|cubed|cracked|block|large)\s+)?ice(?:\s+cubes?)?$|^(?:(?:still|plain|hot|cold|filtered|tap)\s+)?water$/i;
const TOPPED = /\b(?:top(?:ped)?|fill(?:ed)?)\b/i;

/** Plural forms a count noun should lose when the unit is `each`. */
const SINGULAR: [RegExp, string][] = [
  [/\begg whites\b/i, 'egg white'],
  [/\begg yolks\b/i, 'egg yolk'],
  [/\beggs\b/i, 'egg'],
];

const NUM_TOKEN = String.raw`(?:\d+\s+\d+\/\d+|\d+\s*[½¼¾⅓⅔⅛⅜⅝⅞]|\d+\/\d+|\d+(?:[.,]\d+)?|[½¼¾⅓⅔⅛⅜⅝⅞])`;
const UNIT_ALT = Object.keys(UNIT_WORDS).sort((a, b) => b.length - a.length).join('|');
const LEAD = new RegExp(String.raw`^(${NUM_TOKEN})\s*(?:(${UNIT_ALT})\b\.?)?\s*(.*)$`, 'i');

/** "1 1/2", "1½", "½", "22,5", "3/4" → a number; anything else → null. */
export function readAmount(raw: string): number | null {
  const s = raw.trim();
  let m = /^(\d+)\s+(\d+)\/(\d+)$/.exec(s);
  if (m) return Number(m[3]) === 0 ? null : Number(m[1]) + Number(m[2]) / Number(m[3]);
  m = /^(\d+)\s*([½¼¾⅓⅔⅛⅜⅝⅞])$/.exec(s);
  if (m) return Number(m[1]) + VULGAR[m[2]];
  if (VULGAR[s] !== undefined) return VULGAR[s];
  m = /^(\d+)\/(\d+)$/.exec(s);
  if (m) return Number(m[2]) === 0 ? null : Number(m[1]) / Number(m[2]);
  if (/^\d+(?:[.,]\d+)?$/.test(s)) return Number(s.replace(',', '.'));
  return null;
}

function tidy(label: string): string {
  return label.replace(/^\s*(?:of\s+)/i, '').replace(/\s+/g, ' ').trim();
}

function roleOf(text: string, label: string, qty: number | null): LineRole {
  if (qty === null) return 'untracked';
  if (GARNISH.test(text) || ICE_OR_WATER.test(label)) return 'untracked';
  // "60 ml soda to top": a top-up is poured to the glass, not measured.
  if (TOPPED.test(text) && /\bsoda\b/i.test(text)) return 'untracked';
  return 'stocked';
}

/** One pasted line → one proposed row, or null for a blank line. */
export function parseLine(line: string): ProposedLine | null {
  const text = line.replace(/^[\s\-•*·]+/, '').trim();
  if (!text) return null;
  const m = LEAD.exec(text);
  if (!m) {
    return { qty: null, unit: null, label: tidy(text), role: 'untracked', confirmed: false };
  }
  const qty = readAmount(m[1]);
  const unitWord = m[2]?.toLowerCase();
  let unit: RecipeUnit | null = unitWord ? UNIT_WORDS[unitWord] ?? null : null;
  let label = tidy(m[3] ?? '');
  if (!label) {
    // "2 dashes" with nothing after: the amount names nothing, keep the text.
    return { qty: null, unit: null, label: tidy(text), role: 'untracked', confirmed: false };
  }
  if (unit === null && qty !== null) {
    // A count with no unit word ("2 egg whites", "1 lime") is a count.
    unit = 'each';
    for (const [re, to] of SINGULAR) label = label.replace(re, to);
  }
  return { qty, unit, label, role: roleOf(text, label, qty), confirmed: false };
}

/** Pasted text → proposed rows, one per line or per " / ". Nothing is saved. */
export function parseSpec(pasted: string): ProposedLine[] {
  return pasted
    .split(/\r?\n|\s\/\s/)
    .map(parseLine)
    .filter((l): l is ProposedLine => l !== null);
}
