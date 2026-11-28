import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * What of one good is already on order and not yet received (r109 g1).
 *
 * An order names a good in one of two places: its header (`procurement_orders.
 * inventory_id`, one good per order, the older shape) or its lines
 * (`procurement_order_items.inventory_id`, many goods per order). When an
 * order has lines, its lines win and its header is not counted, so one order
 * is never counted twice (a header copies its first line's good).
 *
 * No price is read or returned: the card is a quantity, shown to everyone.
 */

/** Open statuses, compared upper-cased (some rows were written lower-case). */
export const OPEN = new Set([
  "PENDING",
  "APPROVAL_NEEDED",
  "NEGOTIATING",
  "APPROVED",
  "CONFIRMED",
  "IN_TRANSIT",
  "PARTIALLY_RECEIVED",
]);
/** The supplier has it: confirmed, on its way, or part delivered. */
export const SENT = new Set(["CONFIRMED", "IN_TRANSIT", "PARTIALLY_RECEIVED"]);

/** Rows per page: PostgREST answers at most 1000, so a long history is read by id, page after page. */
export const ORDER_PAGE = 1000;
const ID_CHUNK = 150;

export interface OpenOrder {
  id: string;
  orderNumber: string | null;
  status: string;
  /** What is still to come, in the order's own unit. */
  openQty: number;
  unit: string | null;
  expected: string | null;
  /** openQty in the book's own unit, or null when the units differ (nothing is guessed). */
  inBookUnit: number | null;
}

export type OnOrder =
  | { readable: true; source: string; sent: OpenOrder[]; unsent: OpenOrder[]; arrivingInBookUnit: number | null }
  | { readable: false; source: string; sent: null; unsent: null; arrivingInBookUnit: null };

const unread = (why: string): OnOrder => ({
  readable: false,
  source: `What is on order could not be read (${why}).`,
  sent: null,
  unsent: null,
  arrivingInBookUnit: null,
});

type Row = Record<string, any>;

/** Every row a query matches, page after page by id, so more than 1000 rows are read whole. */
async function readAll(
  build: () => any,
): Promise<{ rows: Row[]; error: string | null }> {
  const rows: Row[] = [];
  let after: string | null = null;
  for (;;) {
    let q = build().order("id", { ascending: true }).limit(ORDER_PAGE);
    if (after !== null) q = q.gt("id", after);
    const { data, error } = await q;
    if (error) return { rows, error: error.message };
    const page = (data ?? []) as Row[];
    rows.push(...page);
    if (page.length < ORDER_PAGE) return { rows, error: null };
    after = String(page[page.length - 1].id);
  }
}

async function readByIds(
  ids: string[],
  build: (chunk: string[]) => any,
): Promise<{ rows: Row[]; error: string | null }> {
  const rows: Row[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const r = await readAll(() => build(ids.slice(i, i + ID_CHUNK)));
    if (r.error) return r;
    rows.push(...r.rows);
  }
  return { rows, error: null };
}

const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const up = (s: unknown) => String(s ?? "").toUpperCase();
/** 'bottles' was the old default; the CHECK since 20260901150000 says 'bottle'. */
const unitOf = (u: unknown): string | null => {
  if (u === null || u === undefined) return null;
  const s = String(u).toLowerCase();
  return s === "bottles" ? "bottle" : s;
};

/** What is still to come: all of it, or for a part delivery the quantity less what was taken in. */
function openOf(status: string, qty: number, accepted: number | null, received: number | null): number {
  if (status !== "PARTIALLY_RECEIVED") return qty;
  return Math.max(0, qty - (accepted ?? received ?? 0));
}

/**
 * The open quantity in the book's own unit, only when the order is in that
 * unit: a bottle order into a book kept in bottles (its bottles), an each
 * order into a book kept as each. A case into bottles, or a kilo into grams,
 * is null: nothing is guessed.
 */
function inBook(unit: string | null, bookUom: string | null, openQty: number, openBottles: number | null): number | null {
  const book = bookUom ?? "bottle"; // a wine row with no unit on it is in bottles
  if (unit === "bottle" && book === "bottle") return openBottles;
  if (unit === "each" && book === "each") return openQty;
  return null;
}

export async function readOnOrder(
  client: SupabaseClient,
  restaurantId: string,
  itemId: string,
): Promise<OnOrder> {
  const book = await client
    .from("restaurant_inventory")
    .select("uom")
    .eq("id", itemId)
    .eq("restaurant_id", restaurantId)
    .maybeSingle();
  if (book.error) return unread(book.error.message);
  const bookUom: string | null = (book.data as Row | null)?.uom ?? null;

  const HEAD = "id, order_number, restaurant_id, inventory_id, status, quantity, unit_type, bottles_total, accepted_quantity, quantity_received, expected_delivery_date";
  const LINE = "id, order_id, restaurant_id, inventory_id, quantity, unit_type, bottles_per_unit, total_bottles, quantity_accepted, quantity_received";

  const [heads, lines] = await Promise.all([
    readAll(() =>
      client.from("procurement_orders").select(HEAD).eq("restaurant_id", restaurantId).eq("inventory_id", itemId),
    ),
    readAll(() => client.from("procurement_order_items").select(LINE).eq("inventory_id", itemId)),
  ]);
  if (heads.error) return unread(heads.error);
  if (lines.error) return unread(lines.error);

  // A line names its house, or (older rows) none. Another house's line naming
  // this good is a wrong row, not a figure: the whole card fails closed.
  if (lines.rows.some((l) => l.restaurant_id !== null && l.restaurant_id !== undefined && l.restaurant_id !== restaurantId)) {
    return unread("an order line names another house");
  }

  const orders = new Map<string, Row>();
  for (const h of heads.rows) orders.set(String(h.id), h);
  const parentIds = [...new Set(lines.rows.map((l) => String(l.order_id)))].filter((id) => !orders.has(id));
  if (parentIds.length) {
    const parents = await readByIds(parentIds, (chunk) =>
      client.from("procurement_orders").select(HEAD).eq("restaurant_id", restaurantId).in("id", chunk),
    );
    if (parents.error) return unread(parents.error);
    for (const p of parents.rows) orders.set(String(p.id), p);
    // A line whose order is not in this house: fail closed, as above.
    if (parentIds.some((id) => !orders.has(id))) return unread("an order line belongs to another house's order");
  }

  const open = [...orders.values()].filter((o) => OPEN.has(up(o.status)));
  // Which open orders have lines at all (for any good): their header is not counted.
  const headerOnly = open.filter((o) => String(o.inventory_id) === itemId).map((o) => String(o.id));
  const withLines = new Set(lines.rows.map((l) => String(l.order_id)));
  const unknown = headerOnly.filter((id) => !withLines.has(id));
  if (unknown.length) {
    const any = await readByIds(unknown, (chunk) =>
      client.from("procurement_order_items").select("id, order_id, restaurant_id").in("order_id", chunk),
    );
    if (any.error) return unread(any.error);
    if (any.rows.some((l) => l.restaurant_id !== null && l.restaurant_id !== undefined && l.restaurant_id !== restaurantId)) {
      return unread("an order line names another house");
    }
    for (const l of any.rows) withLines.add(String(l.order_id));
  }

  const byOrder = new Map<string, Row[]>();
  for (const l of lines.rows) {
    const k = String(l.order_id);
    byOrder.set(k, [...(byOrder.get(k) ?? []), l]);
  }

  const result: OpenOrder[] = [];
  for (const o of open) {
    const status = up(o.status);
    const id = String(o.id);
    const base = { id, orderNumber: o.order_number ?? null, status, expected: o.expected_delivery_date ?? null };
    if (withLines.has(id)) {
      // Its lines win. Lines of one order in different units stay apart.
      const mine = byOrder.get(id) ?? [];
      const units = new Map<string | null, { qty: number; book: number | null; bookKnown: boolean }>();
      for (const l of mine) {
        const unit = unitOf(l.unit_type);
        const accepted = n(l.quantity_accepted);
        const received = n(l.quantity_received);
        const qty = openOf(status, Number(l.quantity ?? 0), accepted, received);
        const per = n(l.bottles_per_unit) ?? 1;
        const bottles = unit === "bottle" ? qty * per : null;
        const b = inBook(unit, bookUom, qty, bottles);
        const cur = units.get(unit) ?? { qty: 0, book: 0, bookKnown: true };
        cur.qty += qty;
        if (b === null) cur.bookKnown = false;
        else cur.book = (cur.book ?? 0) + b;
        units.set(unit, cur);
      }
      for (const [unit, u] of units) {
        if (u.qty <= 0) continue;
        result.push({ ...base, openQty: u.qty, unit, inBookUnit: u.bookKnown ? u.book : null });
      }
    } else {
      const unit = unitOf(o.unit_type);
      const accepted = n(o.accepted_quantity);
      const received = n(o.quantity_received);
      const qty = openOf(status, Number(o.quantity ?? 0), accepted, received);
      if (qty <= 0) continue;
      const total = n(o.bottles_total);
      const openBottles =
        total === null ? null : status === "PARTIALLY_RECEIVED" ? Math.max(0, total - (accepted ?? received ?? 0)) : total;
      result.push({ ...base, openQty: qty, unit, inBookUnit: inBook(unit, bookUom, qty, openBottles) });
    }
  }

  const sent = result.filter((r) => SENT.has(r.status));
  const unsent = result.filter((r) => !SENT.has(r.status));
  const arrivingInBookUnit = sent.some((r) => r.inBookUnit === null)
    ? null
    : sent.reduce((s, r) => s + (r.inBookUnit as number), 0);

  return {
    readable: true,
    source: "Orders for this good not yet received, from the orders book.",
    sent,
    unsent,
    arrivingInBookUnit,
  };
}
