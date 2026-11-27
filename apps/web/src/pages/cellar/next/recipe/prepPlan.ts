/**
 * Plan a shift's prep (r109 drinks-g3), pure. need = qtyBase x serves / yieldServes x 100 / usablePct.
 * Invariant: a good's total is the exact sum of its needs per (good, base unit), never across families,
 * rounded ONCE at the end and up. A stocked line with no good is never summed. Never reads on-hand stock.
 */
import type { CardComponent, DrinkCard } from '../../../../services/api/recipes';

export const SERVES_MAX = 999;
export const SERVES_SAID = `Planned serves are a whole number from 0 to ${SERVES_MAX}.`;

export function readServes(text: string): number | null {
  const s = text.trim();
  if (s === '') return 0;
  if (!/^\d{1,3}$/.test(s)) return null;
  return Number(s);
}

const UNIT: Record<string, { word: string; per: number }> = {
  ml10: { word: 'ml', per: 10 },
  mg: { word: 'g', per: 1000 },
  each_milli: { word: 'each', per: 1000 },
};

/** A base amount as a person pulls it, rounded up once: "112 ml", "3 each". */
export function pullWords(base: number, baseUnit: string): string {
  const u = UNIT[baseUnit];
  return u ? `${Math.ceil(base / u.per - 1e-9)} ${u.word}` : `${base} ${baseUnit}`;
}

export interface PullRow {
  inventoryId: string;
  name: string;
  baseUnit: string;
  base: number;
  drinks: string[];
}
export interface MakeRow {
  componentId: string;
  name: string;
  baseUnit: string;
  base: number;
  batches: number | null;
  yieldBase: number | null;
  drinks: string[];
}
export interface NamedRow {
  label: string;
  drinks: string[];
  firstDrinkId: string;
}
export interface PrepPlan {
  pull: PullRow[];
  make: MakeRow[];
  notLinked: NamedRow[];
  notCounted: NamedRow[];
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
      // No good, no component, or no amount read: named, never summed.
      named(notLinked, l.label || l.name || '', card);
    }
  }
  const byName = <T extends { name?: string; label?: string }>(a: T, b: T) => (a.name ?? a.label ?? '').localeCompare(b.name ?? b.label ?? '');
  return {
    pull: [...pull.values()].sort(byName),
    make: [...make.values()]
      .map((m) => ({ ...m, batches: m.yieldBase ? Math.ceil(m.base / m.yieldBase - 1e-9) : null }))
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

/** Serves kept per house and day in this browser: a convenience. */
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

export function localDay(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}
