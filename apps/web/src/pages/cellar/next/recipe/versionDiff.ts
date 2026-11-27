/**
 * What an earlier version differs by from the current one (r109 drinks-g4).
 * Pure.
 *
 * Lines are paired, in order of preference:
 *   1. by what they draw: a linked stocked line by its good, a made line by
 *      its component, any other line by its folded name (the gateway's
 *      name-fold rule: case, spaces, the dotless ı and accents). Inside one
 *      key, duplicates pair in position order;
 *   2. a line left over pairs with one left over on the other side that has
 *      the same folded label, whatever its role: the label survives a link and
 *      a switch between counted and not counted, so a line that gained a good
 *      (or lost it) reads as changed, never as one removed and one added;
 *   3. a stocked line left over pairs with a stocked line left over on the
 *      other side, in position order: a good swapped for another reads as
 *      changed, never as one removed and one added.
 * Whatever is still alone is added (only in the current) or taken out (only
 * in the earlier one). Serves, glass, garnish and method are said too.
 *
 * A cost difference is said only when both costs are complete, and both are
 * at today's prices (readVersion and getRecipe price alike), so it compares
 * the recipes, never price movement over time.
 */
import type { RecipeCost, RecipeLine, RecipeVersion } from '../../../../services/api/recipes';
import { amountWithUnit } from './units';

type Line = Pick<RecipeLine, 'role' | 'inventoryId' | 'componentId' | 'label' | 'itemName' | 'componentName' | 'qtyEntered' | 'unitCode' | 'position'> & {
  usablePct?: number | null;
};
type Version = Pick<RecipeVersion, 'yieldServes' | 'glass' | 'garnish' | 'method'> & { lines: Line[] };

export type LineDiff =
  | { kind: 'same'; text: string }
  | { kind: 'changed'; text: string }
  | { kind: 'added'; text: string }
  | { kind: 'removed'; text: string };

/** The gateway's name fold (apps/api-gateway/src/recipes/name-fold.ts), so a line pairs by name as it links. */
export function foldName(s: string): string {
  return s
    .normalize('NFC')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .replace(/ı/g, 'i')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .normalize('NFC');
}

function keyOf(l: Line): string {
  if (l.role === 'stocked' && l.inventoryId) return `g:${l.inventoryId}`;
  if (l.role === 'made' && l.componentId) return `c:${l.componentId}`;
  return `n:${foldName(l.label)}`;
}

const nameOf = (l: Line) => (l.role === 'made' ? l.componentName : l.itemName) ?? l.label;
const amountOf = (l: Line) => amountWithUnit(Number(l.qtyEntered), l.unitCode as never);
const usableOf = (l: Line) => (l.role === 'stocked' && l.usablePct != null && l.usablePct < 100 ? l.usablePct : null);
const usableWords = (u: number | null) => (u == null ? 'all of it' : `${u}%`);

/** "Gin 50 ml, now 45 ml"; "Plymouth gin 50 ml, now Tanqueray gin"; null when nothing differs. */
function changeWords(was: Line, now: Line): string | null {
  // A change of role is said as "now counted" or "now not counted"; the name beside it is the line's own, not a swap.
  const swapped = was.role === now.role && (keyOf(was) !== keyOf(now) || foldName(nameOf(was)) !== foldName(nameOf(now)));
  const moved = amountOf(was) !== amountOf(now);
  const parts: string[] = [];
  if (swapped || moved) {
    parts.push(`${nameOf(was)} ${amountOf(was)}, now ${[swapped ? nameOf(now) : null, moved ? amountOf(now) : null].filter(Boolean).join(' ')}`);
  }
  const u0 = usableOf(was);
  const u1 = usableOf(now);
  if (u0 !== u1) parts.push(`${parts.length ? '' : `${nameOf(now)}: `}usable share ${usableWords(u0)}, now ${usableWords(u1)}`);
  if (was.role !== now.role) {
    parts.push(`${parts.length ? '' : `${nameOf(now)}: `}${now.role === 'untracked' ? 'now not counted' : 'now counted'}`);
  }
  return parts.length ? parts.join('; ') : null;
}

/** Each line of the earlier version against the current one, then the current's new lines. */
export function diffLines(was: Line[], now: Line[]): LineDiff[] {
  const a = [...was].sort((x, y) => x.position - y.position);
  const b = [...now].sort((x, y) => x.position - y.position);
  const pairOf = new Map<number, number>();
  const taken = new Set<number>();
  // 1. by what the line draws, in position order inside a key.
  a.forEach((l, i) => {
    const j = b.findIndex((m, k) => !taken.has(k) && keyOf(m) === keyOf(l));
    if (j >= 0) (pairOf.set(i, j), taken.add(j));
  });
  // 2. a line left over meets one left over with the same label, whatever its role: it was linked, or its counted state changed.
  a.forEach((l, i) => {
    if (pairOf.has(i)) return;
    const j = b.findIndex((m, k) => !taken.has(k) && foldName(m.label) === foldName(l.label));
    if (j >= 0) (pairOf.set(i, j), taken.add(j));
  });
  // 3. a stocked line left over meets one left over on the other side: a swap.
  a.forEach((l, i) => {
    if (pairOf.has(i) || l.role !== 'stocked') return;
    const j = b.findIndex((m, k) => !taken.has(k) && m.role === 'stocked');
    if (j >= 0) (pairOf.set(i, j), taken.add(j));
  });
  const out: LineDiff[] = a.map((l, i) => {
    const j = pairOf.get(i);
    if (j === undefined) return { kind: 'removed', text: `Taken out since: ${nameOf(l)} ${amountOf(l)}` };
    const c = changeWords(l, b[j]);
    return c ? { kind: 'changed', text: c } : { kind: 'same', text: `${nameOf(l)} ${amountOf(l)}` };
  });
  b.forEach((m, k) => {
    if (!taken.has(k)) out.push({ kind: 'added', text: `Added since: ${nameOf(m)} ${amountOf(m)}` });
  });
  return out;
}

/** Serves, glass, garnish and method, said where they differ. */
export function diffMeta(was: Version, now: Version, unit: 'serve' | 'plate'): string[] {
  const out: string[] = [];
  if (was.yieldServes !== now.yieldServes) out.push(`Makes ${was.yieldServes} ${unit}s, now ${now.yieldServes}`);
  const field = (name: string, x: string | null, y: string | null) => {
    const p = (x ?? '').trim();
    const q = (y ?? '').trim();
    if (p !== q) out.push(`${name} ${p || 'none'}, now ${q || 'none'}`);
  };
  if (unit === 'serve') field('Glass', was.glass, now.glass);
  field('Garnish', was.garnish, now.garnish);
  if ((was.method ?? '').trim() !== (now.method ?? '').trim()) out.push('The method is worded differently');
  return out;
}

export const NO_COST_DIFFERENCE = 'The cost of one version is not known; no difference is said.';

/** "₺0,12 less a serve than the current, at today's prices", or why none is said. */
export function costDifference(
  was: RecipeCost | null | undefined,
  now: RecipeCost | null | undefined,
  say: (n: number) => string,
  unit: 'serve' | 'plate',
): string {
  const exact = (c: RecipeCost | null | undefined) => (c?.complete ? (c.perServeExact ?? c.perServe) : null);
  const p = exact(was);
  const q = exact(now);
  if (p == null || q == null) return NO_COST_DIFFERENCE;
  const d = Math.round((p - q) * 100) / 100;
  if (d === 0) return `The same a ${unit} as the current, at today's prices.`;
  return `${say(Math.abs(d))} ${d < 0 ? 'less' : 'more'} a ${unit} than the current, at today's prices.`;
}
