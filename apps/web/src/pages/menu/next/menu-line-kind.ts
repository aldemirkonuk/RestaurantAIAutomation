/**
 * A menu line named by its kind, for the plan and its result.
 *
 * Onboarding walk 2026-11-12 (r13): a typed Negroni in the Cocktail section
 * was counted as "add 2 wines new to the house" beside a Soave. The plan line
 * carries the line's section (`PlanLine.category`); these words come from it.
 */
import type { PlanLine } from '../../../services/api/menus';

export type KindNoun = readonly [one: string, many: string];

const WINE: KindNoun = ['wine', 'wines'];
const DRINK: KindNoun = ['drink', 'drinks'];

// The drink sections the menu reader and the typed entry use (lib/firstProof
// VOCABULARY), grouped into the noun an owner would say.
const BY_SECTION: Record<string, KindNoun> = {
  wine: WINE,
  red: WINE,
  white: WINE,
  rose: WINE,
  'rosé': WINE,
  sparkling: WINE,
  orange: WINE,
  dessert: WINE,
  fortified: WINE,
  champagne: WINE,
  beer: ['beer', 'beers'],
  cider: ['cider', 'ciders'],
  sake: ['sake', 'sakes'],
  cocktail: ['cocktail', 'cocktails'],
  spirit: ['spirit', 'spirits'],
  whiskey: ['spirit', 'spirits'],
  whisky: ['spirit', 'spirits'],
  'soft drink': ['soft drink', 'soft drinks'],
  'non-alcoholic': ['soft drink', 'soft drinks'],
};

/** Display order: wine first, as the menu reads; a drink with no known kind last. */
const ORDER = ['wine', 'sparkling', 'beer', 'cider', 'sake', 'spirit', 'cocktail', 'soft drink', 'drink'];

/**
 * The noun for one line. A line from a gateway that does not send `category`
 * (the field is absent, not null) was only ever a wine there, and keeps that
 * word; a line whose section is blank or unknown is a "drink", never a wine.
 */
export function kindNoun(line: Pick<PlanLine, 'category'>): KindNoun {
  if (line.category === undefined) return WINE;
  const c = (line.category ?? '').toLowerCase().trim();
  if (!c || c === 'unknown') return DRINK;
  if (BY_SECTION[c]) return BY_SECTION[c];
  if (c.includes('wine')) return WINE;
  return DRINK;
}

function plural(n: number, [one, many]: KindNoun): string {
  return `${n} ${n === 1 ? one : many}`;
}

/** "1 wine and 1 cocktail": these lines counted by kind. Empty for no lines. */
export function countByKind(lines: Array<Pick<PlanLine, 'category'>>): string {
  const groups = new Map<string, { noun: KindNoun; n: number }>();
  for (const line of lines) {
    const noun = kindNoun(line);
    const g = groups.get(noun[0]) ?? { noun, n: 0 };
    g.n += 1;
    groups.set(noun[0], g);
  }
  const parts = [...groups.values()]
    .sort((a, b) => ORDER.indexOf(a.noun[0]) - ORDER.indexOf(b.noun[0]))
    .map((g) => plural(g.n, g.noun));
  return parts.length < 2 ? parts.join('') : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

/**
 * One noun for every line of a menu, for the result sentence, which the
 * gateway counts without kinds: the shared kind when every line has one, else
 * "drink". With no lines to look at, "line" -- the unit the gateway counts.
 */
export function oneNounFor(lines: Array<Pick<PlanLine, 'category'>> | undefined): KindNoun {
  if (!lines || lines.length === 0) return ['line', 'lines'];
  const nouns = new Set(lines.map((l) => kindNoun(l)[0]));
  return nouns.size === 1 ? kindNoun(lines[0]) : DRINK;
}
