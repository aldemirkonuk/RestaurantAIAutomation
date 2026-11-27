/**
 * What a good's last two settled deliveries cost, for the list's "Price
 * signals" chip (r104 g3).
 *
 * Source: `inventory_lot_revaluations`, the one table that outlives a lot (a
 * lot is deleted once used up; this row's `lot_id` is SET NULL, so the price
 * stays). Only SETTLED prices count -- `invoice` (finalise_delivery_cost) and
 * `manual` (a manager's stated cost) -- never `estimated` or `sample`.
 *
 * One delivery is one point, as the drawer's Cost card draws it: rows are
 * grouped by the order they came from (lots of one order settled in one
 * call share a `created_at`, so an order-less group is keyed by that), the
 * point carries the delivery's NEWEST settled cost and is dated when its
 * price was FIRST settled, so a later correction moves the price, not the
 * date.
 *
 * r108 inventory-1: a point also carries whether its cost holds tax (the
 * newest row's `cost_tax_basis`, stamped from the paper at verify). The move
 * names a basis only when BOTH points state the same one; a mixed or
 * unstated pair has no `basis`, and the list does not compare it.
 */
export const SETTLED_PRICES = ["invoice", "manual"] as const;

export type SettledTaxBasis = "net" | "gross_cost";
const BASES: readonly string[] = ["net", "gross_cost"];

export interface SettledRow {
  inventory_id: string;
  source_order_id: string | null;
  new_unit_cost: number | string | null;
  new_cost_provenance: string;
  created_at: string;
  /** net | gross_cost | null (not stated); absent on a row read before the column. */
  cost_tax_basis?: string | null;
}

export interface SettledMove {
  /** The newest delivery's settled unit cost. */
  last: number;
  /** The delivery before it. */
  previous: number;
  /** Set only when both deliveries' costs state the same tax basis. */
  basis?: SettledTaxBasis;
}

export function settledMovesFrom(rows: SettledRow[]): Map<string, SettledMove> {
  const goods = new Map<
    string,
    Map<string, { first: string; newest: string; unitCost: number; basis: SettledTaxBasis | null }>
  >();
  for (const r of rows) {
    if (!(SETTLED_PRICES as readonly string[]).includes(r.new_cost_provenance)) continue;
    const cost = r.new_unit_cost === null ? NaN : Number(r.new_unit_cost);
    if (!Number.isFinite(cost) || cost < 0) continue;
    const basis = r.cost_tax_basis && BASES.includes(r.cost_tax_basis) ? (r.cost_tax_basis as SettledTaxBasis) : null;
    const key = r.source_order_id ? `order:${r.source_order_id}` : `at:${r.created_at}`;
    const deliveries = goods.get(r.inventory_id) ?? new Map();
    const seen = deliveries.get(key);
    if (!seen) {
      deliveries.set(key, { first: r.created_at, newest: r.created_at, unitCost: cost, basis });
    } else {
      if (r.created_at < seen.first) seen.first = r.created_at;
      if (r.created_at > seen.newest) {
        seen.newest = r.created_at;
        seen.unitCost = cost;
        seen.basis = basis;
      }
    }
    goods.set(r.inventory_id, deliveries);
  }
  const out = new Map<string, SettledMove>();
  for (const [id, deliveries] of goods) {
    const byDate = [...deliveries.values()].sort((a, b) => (a.first < b.first ? 1 : a.first > b.first ? -1 : 0));
    if (byDate.length < 2) continue;
    const [newest, before] = byDate;
    const move: SettledMove = { last: newest.unitCost, previous: before.unitCost };
    if (newest.basis !== null && newest.basis === before.basis) move.basis = newest.basis;
    out.set(id, move);
  }
  return out;
}
