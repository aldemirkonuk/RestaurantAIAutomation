/**
 * Plan a shift's prep (r109 drinks-g3): planned serves per drink in, a pull
 * list per good and the batches of each house-made component out. Pure.
 *
 *   need = qtyBase x serves / yieldServes x 100 / usablePct
 *
 * Invariant: a good's total is the exact sum of its per-drink needs, rounded
 * ONCE at the end and up (whole ml, g or piece), so a pull list never
 * under-pulls and never carries one rounding per line. Sums are per (good,
 * base unit): a good poured in ml on one drink and weighed on another stays
 * two rows, never added across families. A stocked line with no good is
 * listed as not linked and is never summed into a good; a line that is not
 * counted is listed by its label. It never reads on-hand stock (DD-r105-31
 * ground): it says what to pull and make, not what can be made.
 */
import type { CardComponent, DrinkCard } from '../../../../services/api/recipes';

export const SERVES_MAX = 999;
export const SERVES_SAID = `Planned serves are a whole number from 0 to ${SERVES_MAX}.`;

/** "12" to 12; empty is 0; anything else is null. */
export function readServes(text: string): number | null {
  const s = text.trim();
  if (s === '') return 0;
  if (!/^\d{1,3}$/.test(s)) return null;
  return Number(s);
}

/** What one base unit is to a person, and how many of it make one. */
const UNIT: Record<string, { word: string; per: number }> = {
  ml10: { word: 'ml', per: 10 },
  mg: { word: 'g', per: 1000 },
  each_milli: { word: 'each', per: 1000 },
};

/** Float slack: an exact whole amount is never pushed up a unit by noise. */
const EPS = 1e-9;

/** A base amount as a person pulls it, rounded up once: "112 ml", "3 each". */
export function pullWords(base: number, baseUnit: string): string {
  const u = UNIT[baseUnit];
  return u ? `${Math.ceil(base / u.per - EPS)} ${u.word}` : `${base} ${baseUnit}`;
}

export interface PullRow {
  inventoryId: string;
  name: string;
  baseUnit: string;
  /** The exact sum in base units, unrounded. */
  base: number;
  drinks: string[];
}
export interface MakeRow {
  componentId: string;
  name: string;
  baseUnit: string;
  base: number;
  /** Whole batches, or null when the component's yield is not set in this family. */
  batches: number | null;
  yieldBase: number | null;
  drinks: string[];
}
export interface NamedRow {
  label: string;
  drinks: string[];
  /** The first drink it is on, so an editor can open that drink and link the line. */
  firstDrinkId: string;
}
export interface PrepPlan {
  pull: PullRow[];
  make: MakeRow[];
  notLinked: NamedRow[];
  notCounted: NamedRow[];
  /** Planned drinks, in serves. */
  planned: number;
}

const fold = (s: string) => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase();
const addDrink = (list: string[], name: string) => (list.includes(name) ? list : [...list, name]);

export function planPrep(cards: DrinkCard[], components: CardComponent[], serves: Record<string, number>): PrepPlan {
  const pull = new Map<string, PullRow>();
  const make = new Map<string, MakeRow>();
  const notLinked = new Map<string, NamedRow>();
  const notCounted = new Map<string, NamedRow>();
  const comp = new Map(components.map((c) => [c.id, c]));
  let planned = 0;

  const named = (to: Map<string, NamedRow>, label: string, card: DrinkCard) => {
    const k = fold(label) || '(no name)';
    const e = to.get(k) ?? { label: label.trim() || 'A line with no name', drinks: [], firstDrinkId: card.cocktailId };
    to.set(k, { ...e, drinks: addDrink(e.drinks, card.name) });
  };

  for (const card of cards) {
    const n = serves[card.cocktailId] ?? 0;
    if (!Number.isInteger(n) || n <= 0) continue;
    planned += n;
    const per = Math.max(1, card.yieldServes);
    for (const l of card.lines) {
      const qb = l.qtyBase;
      const amount = qb != null && Number.isFinite(qb) && qb > 0 && l.baseUnit ? qb : null;
      if (l.role === 'untracked') {
        named(notCounted, l.label, card);
        continue;
      }
      if (l.role === 'stocked' && l.inventoryId && amount != null) {
        const share = l.usablePct != null && l.usablePct > 0 && l.usablePct <= 100 ? 100 / l.usablePct : 1;
        const need = ((amount * n) / per) * share;
        const k = `${l.inventoryId}|${l.baseUnit}`;
        const e = pull.get(k) ?? { inventoryId: l.inventoryId, name: l.name ?? l.label, baseUnit: l.baseUnit as string, base: 0, drinks: [] };
        pull.set(k, { ...e, base: e.base + need, drinks: addDrink(e.drinks, card.name) });
        continue;
      }
      if (l.role === 'made' && l.componentId && amount != null) {
        const need = (amount * n) / per;
        const k = `${l.componentId}|${l.baseUnit}`;
        const c = comp.get(l.componentId);
        const e = make.get(k) ?? {
          componentId: l.componentId, name: c?.name ?? l.name ?? l.label, baseUnit: l.baseUnit as string, base: 0, batches: null,
          yieldBase: c && c.yieldBaseUnit === l.baseUnit && c.yieldQtyBase != null && c.yieldQtyBase > 0 ? c.yieldQtyBase : null, drinks: [],
        };
        make.set(k, { ...e, base: e.base + need, drinks: addDrink(e.drinks, card.name) });
        continue;
      }
      // A stocked line with no good, a made line with no component, or one whose amount was not read: never summed.
      named(notLinked, l.label || l.name || '', card);
    }
  }
  const byName = <T extends { name?: string; label?: string }>(a: T, b: T) => (a.name ?? a.label ?? '').localeCompare(b.name ?? b.label ?? '');
  return {
    pull: [...pull.values()].sort(byName),
    make: [...make.values()]
      .map((m) => ({ ...m, batches: m.yieldBase ? Math.ceil(m.base / m.yieldBase - EPS) : null }))
      .sort(byName),
    notLinked: [...notLinked.values()].sort(byName),
    notCounted: [...notCounted.values()].sort(byName),
    planned,
  };
}

/** "House syrup: 2 batches (360 ml needed, one makes 250 ml)" or "House syrup: yield not set: 360 ml needed". */
export function makeWords(m: MakeRow): string {
  const need = pullWords(m.base, m.baseUnit);
  if (m.batches == null || m.yieldBase == null) return `${m.name}: yield not set: ${need} needed`;
  return `${m.name}: ${m.batches} ${m.batches === 1 ? 'batch' : 'batches'} (${need} needed, one makes ${pullWords(m.yieldBase, m.baseUnit)})`;
}

/** Planned serves are kept in this browser per house and per day: a convenience, never state. */
export const planKey = (houseId: string | null | undefined, day: string) => `mudavym.prepPlan.v1:${houseId ?? '-'}:${day}`;

export function planWas(key: string): Record<string, string> {
  try {
    const v = JSON.parse(window.localStorage.getItem(key) ?? '{}');
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string>) : {};
  } catch {
    return {};
  }
}

export function keepPlan(key: string, texts: Record<string, string>): void {
  try {
    const kept = Object.fromEntries(Object.entries(texts).filter(([, t]) => (readServes(t) ?? 0) > 0));
    if (Object.keys(kept).length) window.localStorage.setItem(key, JSON.stringify(kept));
    else window.localStorage.removeItem(key);
  } catch {
    /* not kept: the plan opens empty next time */
  }
}

/** Today in this browser's own day, "2026-11-27". */
export function localDay(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
