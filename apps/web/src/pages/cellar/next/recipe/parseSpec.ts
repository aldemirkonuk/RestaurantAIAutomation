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
 * sees both before anything is kept. A measure that is not on the menu (a shot,
 * a jigger, a cup, a pint) is never turned into a count: the row keeps the
 * amount, gets no unit, and Save names the line until a unit is picked.
 *
 * What it does not guess (round 17, D3): a numbered-list prefix ("1)", "2.") is
 * dropped before the amount is read; a minus sign is not a bullet, so "-30 ml"
 * stays as text; "1e3", "1.000,5" and a number run into a word ("30mlgin") are
 * kept as text, not read as a count; "1,000" and "1.000" could be a thousand
 * or one, so they are kept as text too. A garnish or ice line with no amount is
 * proposed as 1 each, not counted, so it can be saved as written.
 *
 * A word after the amount that looks like a mistyped unit ("30 mll gin",
 * "1 dasher bitters", "30 mlgin") is not read as a count either (round 19):
 * the row keeps the amount, gets no unit, and carries a flag naming the word,
 * shown before the rows are used. "Looks like" is one edit away from a unit
 * word of two letters or more, or a word that starts with ml, oz, tsp, tbsp,
 * kg or bsp. Every other word is the start of the label, as "2 limes" is. A
 * measure off the menu ("1 shot gin") is flagged the same way.
 */

import { readsAsThousandAmbiguous, type RecipeUnit } from './units';

export type LineRole = 'stocked' | 'untracked';

export interface ProposedLine {
  qty: number | null;
  unit: RecipeUnit | null;
  label: string;
  role: LineRole;
  confirmed: false;
  /** Why the row has an amount but no unit, said before it is used; null when nothing was doubted. */
  flag: string | null;
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
  // Plain misspellings of menu units.
  mls: 'ml', mils: 'ml', cls: 'cl', ozs: 'oz', tbs: 'tbsp', tbl: 'tbsp', tbls: 'tbsp', gm: 'g', gms: 'g',
};

/** Measures a bar uses that are not on the menu: the amount is kept, the unit is left to pick. */
const OFF_MENU = /^(shots?|jiggers?|cups?|pints?|pt|parts?|splash(?:es)?|drops?|pinch(?:es)?|scoops?|glass(?:es)?)\b\.?\s*/i;
/** A word run on from a unit no ingredient starts with: "mlgin", "ozrum". */
const GLUED_UNIT = /^(?:ml|oz|tsp|tbsp|kg|bsp)[a-z]/i;
/** Unit words a typo is measured against: two letters or more, and not the count words. */
const TYPO_TARGETS = Object.keys(UNIT_WORDS).filter((k) => k.length >= 2 && k !== 'each');

/** True when a and b are at most one insert, delete, change or swap of neighbours apart. */
function oneEditApart(a: string, b: string): boolean {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  if (i === a.length && i === b.length) return true;
  const ra = a.slice(i + 1), rb = b.slice(i + 1);
  return ra === rb || a.slice(i) === rb || ra === b.slice(i)
    || (a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2));
}

/** "mll", "dasher", "mlgin": a word that reads as a unit typed wrong. */
export function unitTypo(word: string): boolean {
  const w = word.toLowerCase();
  if (w.length < 2 || UNIT_WORDS[w]) return false;
  if (GLUED_UNIT.test(w)) return true;
  return TYPO_TARGETS.some((k) => oneEditApart(w, k));
}
/** "1)" or "2." at the start of a numbered list, before the amount. */
const NUMBERED = /^\d{1,2}[.)]\s+(?=\S)/;

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

const NUM_TOKEN = String.raw`(?:\d+\s+\d+\/\d+|\d+\s*[½¼¾⅓⅔⅛⅜⅝⅞]|\d+\/\d+|\d+(?:[.,]\d+)?|\.\d+|[½¼¾⅓⅔⅛⅜⅝⅞])`;
const UNIT_ALT = Object.keys(UNIT_WORDS).sort((a, b) => b.length - a.length).join('|');
// The amount may not run on into more digits, a separator or an exponent.
const LEAD = new RegExp(String.raw`^(${NUM_TOKEN})(?![\d.,])(\s*)(?:(${UNIT_ALT})\b\.?)?\s*(.*)$`, 'i');
/** A " / " or "/" that starts another amount splits; "Sweet / dry vermouth" and "1 1/2" do not. */
const SPLIT = new RegExp(String.raw`\r?\n|(?<=[^\d\s])\s*\/\s*(?=${NUM_TOKEN}(?![\d.,]))`);

/** "1 1/2", "1½", "½", "22,5", "3/4" → a number; anything else → null. */
export function readAmount(raw: string, unit?: RecipeUnit | null): number | null {
  const s = raw.trim();
  let m = /^(\d+)\s+(\d+)\/(\d+)$/.exec(s);
  if (m) return Number(m[3]) === 0 ? null : Number(m[1]) + Number(m[2]) / Number(m[3]);
  m = /^(\d+)\s*([½¼¾⅓⅔⅛⅜⅝⅞])$/.exec(s);
  if (m) return Number(m[1]) + VULGAR[m[2]];
  if (VULGAR[s] !== undefined) return VULGAR[s];
  m = /^(\d+)\/(\d+)$/.exec(s);
  if (m) return Number(m[2]) === 0 ? null : Number(m[1]) / Number(m[2]);
  if (readsAsThousandAmbiguous(s, unit)) return null;
  if (/^\d+(?:[.,]\d+)?$/.test(s)) return Number(s.replace(',', '.'));
  if (/^\.\d+$/.test(s)) return Number(s);
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
  // A bullet is a mark followed by a space, or a dot-like mark; "-30" keeps its sign.
  const text = line.replace(/^\s*(?:[-–•*·]+\s+|[•*·]+)/, '').trim().replace(NUMBERED, '');
  if (!text) return null;
  const asText = (): ProposedLine => {
    const label = tidy(text);
    // A garnish or ice with no amount is written as one, not counted, so it saves as written.
    if (GARNISH.test(text) || ICE_OR_WATER.test(label)) {
      return { qty: 1, unit: 'each', label, role: 'untracked', confirmed: false, flag: null };
    }
    return { qty: null, unit: null, label, role: 'untracked', confirmed: false, flag: null };
  };
  const m = LEAD.exec(text);
  if (!m) return asText();
  const unitWord = m[3]?.toLowerCase();
  let unit: RecipeUnit | null = unitWord ? UNIT_WORDS[unitWord] ?? null : null;
  // The unit settles "1.125": a decimal for oz, still a refusal for ml or no unit.
  const qty = readAmount(m[1], unit);
  if (qty === null) return asText();
  const gap = m[2];
  const rest = m[4] ?? '';
  // "1e3 ml", "30mlgin", "1:1 syrup": the number runs on into something that is not a unit.
  if (unit === null && gap === '' && rest !== '') return asText();
  // "1 . 2 oz gin": what follows the amount is not a word, so the amount is not one.
  if (unit === null && rest !== '' && !/^[\p{L}"'(]/u.test(rest)) return asText();
  let label = tidy(rest);
  if (!label) {
    // "2 dashes" with nothing after: the amount names nothing, keep the text.
    return { qty: null, unit: null, label: tidy(text), role: 'untracked', confirmed: false, flag: null };
  }
  const offMenu = unit === null ? OFF_MENU.exec(label) : null;
  if (offMenu) {
    // "1 shot gin": a measure the menu does not have. Keep it in the label, pick the unit.
    const flag = `"${offMenu[1]}" is not on the unit menu. Pick the unit.`;
    return { qty, unit: null, label, role: roleOf(text, label, qty), confirmed: false, flag };
  }
  const word = unit === null ? /^[a-z]+/i.exec(label)?.[0] : undefined;
  if (word && unitTypo(word)) {
    // "30 mll gin": a unit typed wrong is never guessed, and never read as a count.
    const flag = `"${word}" is not a unit I know. Pick the unit.`;
    return { qty, unit: null, label, role: roleOf(text, label, qty), confirmed: false, flag };
  }
  if (unit === null) {
    // A count with no unit word ("2 egg whites", "1 lime") is a count.
    unit = 'each';
    for (const [re, to] of SINGULAR) label = label.replace(re, to);
  }
  return { qty, unit, label, role: roleOf(text, label, qty), confirmed: false, flag: null };
}

/**
 * A line whose ingredient already appeared earlier in the paste is flagged,
 * not merged (round 17): a spec pasted twice and a pour split in two read the
 * same, and adding them up would double the first. The person leaves one out
 * or keeps both, having seen it.
 */
function flagRepeats(lines: ProposedLine[]): ProposedLine[] {
  // No line number in the words: a row left out above would make it wrong.
  const seen = new Set<string>();
  return lines.map((l) => {
    const key = l.label.toLowerCase().replace(/\s+/g, ' ').trim();
    const again = key !== '' && seen.has(key);
    if (key) seen.add(key);
    if (!again || l.flag) return l;
    return { ...l, flag: `"${l.label}" is pasted above too. Leave one out if it was pasted twice.` };
  });
}

/** Pasted text → proposed rows, one per line or per slash before an amount. Nothing is saved. */
export function parseSpec(pasted: string): ProposedLine[] {
  return flagRepeats(
    pasted
      .split(SPLIT)
      .map(parseLine)
      .filter((l): l is ProposedLine => l !== null),
  );
}
