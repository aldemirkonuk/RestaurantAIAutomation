import type { BaseUnit } from "./recipe-cost";

/**
 * Used in, through a house-made component (r110 inventory g1). A good in a
 * component (simple syrup takes sugar) is in every current recipe that draws
 * that component, at `drawn / yield * good` a batch, then a serve. A chain
 * (sugar -> syrup -> batch mix -> drink) multiplies the ratio at each level,
 * at most THROUGH_DEPTH levels up, and a cycle never recurses.
 *
 * Quantities only, never money: every role reads it. No serves-from-stock
 * figure is given for an indirect use (the session's call: a batch already
 * made sits between the shelf and the serve, and it is not counted here).
 */
export const THROUGH_DEPTH = 3;
export const THROUGH_UNREAD = "Which recipes draw this good through something the house makes could not be read just now.";

/** Why a serve's amount is not known: a drawn line in another unit than the batch is made in, no yield, no serves, or a loop. */
export type ThroughWhy = "unit_mismatch" | "no_yield" | "no_serves" | "cycle";

export interface ThroughOwner {
  kind: "dish" | "cocktail";
  id: string;
  name: string;
  /** This good in one serve, through the component, in `baseUnit` (mg, ml10, each_milli); null with `why`. */
  perServeQtyBase: number | null;
  baseUnit: BaseUnit | null;
  why: ThroughWhy | null;
}

export interface ThroughComponent {
  componentId: string;
  componentName: string;
  /** 1 for a component that takes the good itself; 2 and 3 for a component made from one. */
  level: number;
  owners: ThroughOwner[];
}

/** A recipe line as the graph needs it. */
export interface GraphLine {
  version_id: string;
  qty_base: number | string | null;
  base_unit: string | null;
  component_dish_id?: string | null;
}

export interface ThroughGraph {
  /** Each component's current version (component dish id -> version id). */
  nodeVersion: Map<string, string>;
  /** The good's own lines, by version. */
  goodLines: Map<string, GraphLine[]>;
  /** Current lines that draw a component, by version. */
  madeLines: Map<string, GraphLine[]>;
  /** Who owns each current drawing version now. */
  ownerOf: Map<string, { kind: "dish" | "cocktail"; id: string }>;
  /** The level each component was reached at. */
  levelOf: Map<string, number>;
  /** This house's live components: name and what one batch makes. */
  dishes: Map<string, { name: string; yieldQtyBase: number | null; yieldBaseUnit: string | null }>;
  /** This house's live drinks, by id. */
  drinks: Map<string, string>;
  /** Serves a drawing version makes, by version id. */
  serves: Map<string, number | null>;
}

type Amount = { qty: number; unit: BaseUnit } | { why: ThroughWhy };

const round2 = (n: number) => Math.round(n * 100) / 100;

/** The amounts, from a graph already read. Pure: the reads live in DishesService.componentUsesOfItem. */
export function throughOf(g: ThroughGraph): ThroughComponent[] {
  const memo = new Map<string, Amount | null>();
  const busy = new Set<string>();

  /** The good this much of component `c` holds, drawn by line `l`: `drawn / yield * good in a batch`. */
  const drawnBy = (l: GraphLine, c: string): Amount | null => {
    const info = g.dishes.get(c);
    if (!info || info.yieldQtyBase === null || !(info.yieldQtyBase > 0) || !info.yieldBaseUnit) return { why: "no_yield" };
    if (l.base_unit !== info.yieldBaseUnit) return { why: "unit_mismatch" };
    const inBatch = goodIn(c);
    if (inBatch === null || "why" in inBatch) return inBatch;
    return { qty: (Number(l.qty_base) / info.yieldQtyBase) * inBatch.qty, unit: inBatch.unit };
  };

  /** The good one whole batch of component `c` holds: its own lines, plus what its own components bring. */
  function goodIn(c: string): Amount | null {
    if (memo.has(c)) return memo.get(c)!;
    if (busy.has(c)) return { why: "cycle" };
    busy.add(c);
    const v = g.nodeVersion.get(c);
    const parts: Array<Amount | null> = [];
    if (v) {
      for (const l of g.goodLines.get(v) ?? []) parts.push({ qty: Number(l.qty_base), unit: l.base_unit as BaseUnit });
      for (const l of g.madeLines.get(v) ?? []) {
        if (l.component_dish_id && g.nodeVersion.has(l.component_dish_id)) parts.push(drawnBy(l, l.component_dish_id));
      }
    }
    busy.delete(c);
    const out = sum(parts);
    memo.set(c, out);
    return out;
  }

  const out: ThroughComponent[] = [];
  for (const [c, level] of g.levelOf) {
    const info = g.dishes.get(c);
    if (!info) continue; // another house's, or taken off the list
    const byOwner = new Map<string, { kind: "dish" | "cocktail"; id: string; version: string; lines: GraphLine[] }>();
    for (const [version, lines] of g.madeLines) {
      const o = g.ownerOf.get(version);
      if (!o) continue;
      for (const l of lines) {
        if (l.component_dish_id !== c) continue;
        const k = `${o.kind}:${o.id}`;
        const cur = byOwner.get(k) ?? { ...o, version, lines: [] };
        cur.lines.push(l);
        byOwner.set(k, cur);
      }
    }
    const owners: ThroughOwner[] = [];
    for (const o of byOwner.values()) {
      const name = o.kind === "dish" ? g.dishes.get(o.id)?.name : g.drinks.get(o.id);
      if (!name) continue;
      const batch = sum(o.lines.map((l) => drawnBy(l, c)));
      const serves = g.serves.get(o.version) ?? null;
      let amount: Amount | null = batch;
      if (batch && !("why" in batch)) {
        amount = serves !== null && Number.isInteger(serves) && serves > 0 ? { qty: batch.qty / serves, unit: batch.unit } : { why: "no_serves" };
      }
      if (amount === null) continue; // draws none of the good after all
      owners.push({
        kind: o.kind,
        id: o.id,
        name,
        perServeQtyBase: "why" in amount ? null : round2(amount.qty),
        baseUnit: "why" in amount ? null : amount.unit,
        why: "why" in amount ? amount.why : null,
      });
    }
    if (owners.length === 0) continue;
    owners.sort((a, b) => a.name.localeCompare(b.name));
    out.push({ componentId: c, componentName: info.name, level, owners });
  }
  return out.sort((a, b) => a.level - b.level || a.componentName.localeCompare(b.componentName));
}

/** Parts in one base unit add up; a part in another unit, or one not known, makes the whole not known. */
function sum(parts: Array<Amount | null>): Amount | null {
  let qty = 0;
  let unit: BaseUnit | null = null;
  for (const p of parts) {
    if (p === null) continue;
    if ("why" in p) return p;
    if (unit !== null && p.unit !== unit) return { why: "unit_mismatch" };
    unit = p.unit;
    qty += p.qty;
  }
  return unit === null ? null : { qty, unit };
}
