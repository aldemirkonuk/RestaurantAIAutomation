/**
 * What a good's last two settled deliveries cost, for the list's "Price
 * signals" chip (r104 g3).
 *
 * Source: `inventory_lot_revaluations`, the one table that outlives a lot (a
 * lot is deleted once used up; this row's `lot_id` is SET NULL, so the price
 * stays). Only SETTLED prices count -- `invoice` (finalise_delivery_cost) and
 * `manual` (a manager's stated cost) -- never `estimated` or `sample`.
 *
 * Also from `inventory_lots`: a lot booked `final` with invoice or manual
 * provenance WITHOUT a delivery to finalise (apply_stock_movement: a manual
 * receipt, a bulk receive, add-to-inventory) never gets a revaluation row, so
 * the lot is its only record. A lot's own point is dated when the delivery
 * ARRIVED (`received_at`), so a late invoice moves the price, not the order.
 * A revaluation of a lot that still exists is that same point, so it is not
 * counted twice; one for a lot already spent (lot_id null or unread) is the
 * only record left, and is dated when its price was settled.
 *
 * One delivery is one point, as the drawer's Cost card draws it: rows are
 * grouped by the order they came from (lots of one order settled in one
 * call share a `created_at`, so an order-less group is keyed by that), the
 * point carries the delivery's NEWEST settled cost and is dated when its
 * price was FIRST settled, so a later correction moves the price, not the
 * date.
 */
export const SETTLED_PRICES = ["invoice", "manual"] as const;

export interface SettledLot {
  id: string;
  inventory_id: string;
  source_order_id: string | null;
  delivery_id: string | null;
  unit_cost: number | string | null;
  cost_provenance: string;
  received_at: string;
}

export interface SettledRow {
  inventory_id: string;
  lot_id?: string | null;
  source_order_id: string | null;
  new_unit_cost: number | string | null;
  new_cost_provenance: string;
  created_at: string;
}

export interface SettledMove {
  /** The newest delivery's settled unit cost. */
  last: number;
  /** The delivery before it. */
  previous: number;
}

export function settledMovesFrom(rows: SettledRow[], lots: SettledLot[] = []): Map<string, SettledMove> {
  const goods = new Map<
    string,
    Map<string, { first: string; newest: string; unitCost: number }>
  >();
  const liveLots = new Set<string>();
  const lotKeys = new Set<string>();
  for (const l of lots) {
    liveLots.add(l.id);
    if (!(SETTLED_PRICES as readonly string[]).includes(l.cost_provenance)) continue;
    const cost = l.unit_cost === null ? NaN : Number(l.unit_cost);
    if (!Number.isFinite(cost) || cost < 0) continue;
    const key = l.source_order_id
      ? `order:${l.source_order_id}`
      : l.delivery_id
        ? `delivery:${l.delivery_id}`
        : `lot:${l.id}`;
    lotKeys.add(`${l.inventory_id}|${key}`);
    const deliveries = goods.get(l.inventory_id) ?? new Map();
    const seen = deliveries.get(key);
    if (!seen) {
      deliveries.set(key, { first: l.received_at, newest: l.received_at, unitCost: cost });
    } else {
      if (l.received_at < seen.first) seen.first = l.received_at;
      if (l.received_at > seen.newest) {
        seen.newest = l.received_at;
        seen.unitCost = cost;
      }
    }
    goods.set(l.inventory_id, deliveries);
  }
  for (const r of rows) {
    if (r.lot_id && liveLots.has(r.lot_id)) continue;
    if (!(SETTLED_PRICES as readonly string[]).includes(r.new_cost_provenance)) continue;
    const cost = r.new_unit_cost === null ? NaN : Number(r.new_unit_cost);
    if (!Number.isFinite(cost) || cost < 0) continue;
    const key = r.source_order_id ? `order:${r.source_order_id}` : `at:${r.created_at}`;
    const deliveries = goods.get(r.inventory_id) ?? new Map();
    // The lot's own point, dated by arrival, stands for its delivery.
    if (lotKeys.has(`${r.inventory_id}|${key}`)) continue;
    const seen = deliveries.get(key);
    if (!seen) {
      deliveries.set(key, { first: r.created_at, newest: r.created_at, unitCost: cost });
    } else {
      if (r.created_at < seen.first) seen.first = r.created_at;
      if (r.created_at > seen.newest) {
        seen.newest = r.created_at;
        seen.unitCost = cost;
      }
    }
    goods.set(r.inventory_id, deliveries);
  }
  const out = new Map<string, SettledMove>();
  for (const [id, deliveries] of goods) {
    const byDate = [...deliveries.values()].sort((a, b) => (a.first < b.first ? 1 : a.first > b.first ? -1 : 0));
    if (byDate.length >= 2) out.set(id, { last: byDate[0].unitCost, previous: byDate[1].unitCost });
  }
  return out;
}
