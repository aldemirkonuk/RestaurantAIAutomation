/**
 * Carry many, the reading half (inventory r40): a pasted list read into goods
 * to carry, and the whole result said in words. The sheet is CarryMany.tsx;
 * the WHY is there.
 */
import { fmtCount } from './useInventoryNextData';
import { amountUnit } from './iv-amount';

/** More lines than this is a whole catalogue: carry it in parts. */
export const CARRY_MANY_MAX = 100;
/** Goods in flight at once. */
export const CARRY_MANY_AT_ONCE = 4;
/** The server's limit on a name (house-item.service carry). */
const NAME_MAX = 120;

export type CarryManyKind = 'food' | 'supply' | 'other';
export type CarryManyUom = 'g' | 'ml' | 'each';

/** Said when sending a line again is safe: the house carries a name once. */
export const CARRIED_ONCE = 'Trying again is safe: a name is carried once.';

export interface CarryLine {
  /** 1-based line number in the pasted text, for the person to find it. */
  line: number;
  name: string;
  /** The par in the book's unit, or null when the line states none. */
  par: number | null;
  /** Why the line cannot be sent as written; null when it can. */
  problem: string | null;
  /** Left out before sending: already on the list, or listed twice. */
  skip: 'listed' | 'twice' | null;
}

/** A leading bullet or list number a pasted list carries: "- ", "• ", "3. ", "3) ". */
const BULLET = /^(?:[-*•·]\s+|\d{1,3}[.)]\s+)/;
/**
 * A name, then a par after the first comma or tab that is followed by a figure:
 * "Tomatoes, cherry, 2,5 kg" is "Tomatoes, cherry" with a par of 2,5 kg.
 */
const WITH_PAR = /^(.*?\S)\s*(?:,|\t)\s*(\d.*)$/;

/** The pasted text as lines to carry, each with its par and what stands in its way. */
export function readCarryLines(text: string, uom: CarryManyUom, listed: ReadonlySet<string>): CarryLine[] {
  const unit = amountUnit(uom);
  const seen = new Set<string>();
  const out: CarryLine[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    // Runs of spaces become one; a tab is kept, since it may part a name from its par.
    const cleaned = raw.trim().replace(BULLET, '').replace(/[ \u00a0]+/g, ' ').trim();
    if (cleaned === '') return;
    const m = WITH_PAR.exec(cleaned);
    const name = (m ? m[1] : cleaned).replace(/\s+/g, ' ').trim();
    const typedPar = m ? m[2].trim() : null;
    let par: number | null = null;
    let problem: string | null = null;
    if (name.length > NAME_MAX) {
      problem = `Keep a name to ${fmtCount(NAME_MAX)} characters.`;
    } else if (typedPar !== null) {
      par = unit.parse(typedPar);
      if (par === null) {
        problem = `${unit.why(typedPar) ?? `“${typedPar}” is not a par this good can hold. ${unit.hint}`} A figure after a comma is read as the par.`;
      }
    }
    const key = name.toLowerCase();
    const skip = listed.has(key) ? 'listed' : seen.has(key) ? 'twice' : null;
    seen.add(key);
    out.push({ line: i + 1, name, par, problem, skip });
  });
  return out;
}

export type CarryOutcome =
  | { kind: 'carried' }
  | { kind: 'already' }
  | { kind: 'refused'; text: string }
  | { kind: 'unknown'; text: string };

function listOf(names: string[]): string {
  const shown = names.slice(0, 3);
  const more = names.length - shown.length;
  if (more > 0) return `${shown.join(', ')} and ${fmtCount(more)} more`;
  return shown.length <= 1 ? shown.join('') : `${shown.slice(0, -1).join(', ')} and ${shown[shown.length - 1]}`;
}

/** The whole list in words: what was carried, already there, refused, unknown, and left out. */
export function carryManySummary(
  outcomes: ReadonlyArray<{ name: string; outcome: CarryOutcome }>,
  leftOut: { listed: number; twice: number },
): string {
  const carried = outcomes.filter((o) => o.outcome.kind === 'carried');
  const already = outcomes.filter((o) => o.outcome.kind === 'already');
  const refused = outcomes.filter((o) => o.outcome.kind === 'refused');
  const unknown = outcomes.filter((o) => o.outcome.kind === 'unknown');
  const parts: string[] = [];
  if (carried.length > 0) {
    parts.push(
      `Carried ${fmtCount(carried.length)} ${carried.length === 1 ? 'good' : 'goods'}, with nothing on hand until a delivery or a count.`,
    );
  }
  if (already.length > 0) {
    parts.push(
      `${fmtCount(already.length)} ${already.length === 1 ? 'was' : 'were'} already carried, so nothing was added for ${already.length === 1 ? 'it' : 'them'}.`,
    );
  }
  if (refused.length > 0) parts.push(`Nothing was added for ${listOf(refused.map((o) => o.name))}; each says why below.`);
  if (unknown.length > 0) {
    parts.push(`For ${listOf(unknown.map((o) => o.name))} it is not known whether it was added. ${CARRIED_ONCE}`);
  }
  const out = [
    leftOut.listed > 0 ? `${fmtCount(leftOut.listed)} already on the list` : null,
    leftOut.twice > 0 ? `${fmtCount(leftOut.twice)} listed twice` : null,
  ].filter((s): s is string => s !== null);
  if (out.length > 0) parts.push(`Left out: ${out.join(' and ')}.`);
  return parts.join(' ');
}

/** Run `work` over `items`, at most `limit` at a time; every item gets its turn. */
export async function inTurns<T>(items: T[], limit: number, work: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) {
      const item = items[next];
      next += 1;
      await work(item);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

export function parWords(uom: CarryManyUom, par: number | null): string {
  if (par === null) return 'no par';
  if (par === 0) return 'par 0, no par';
  return `par ${amountUnit(uom).words(par)}`;
}
