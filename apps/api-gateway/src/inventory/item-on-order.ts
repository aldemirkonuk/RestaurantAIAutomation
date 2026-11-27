import type { SupabaseClient } from "@supabase/supabase-js";
import { readShelfReceived } from "../procurement/shelf-received";

/**
 * What of one good is already on order and not yet received (r109 g1).
 *
 * An order names a good in one of two places: its header (`procurement_orders.
 * inventory_id`, one good per order, the older shape) or its lines
 * (`procurement_order_items.inventory_id`, many goods per order). When an
 * order has lines, its lines win and its header is not counted, so one order
 * is never counted twice (a header copies its first line's good).
 *
 * What a part-delivered order has received is the stock ledger's count for
 * (the order, this good, live stock), from `shelf-received.ts` (ADR 0192): the
 * retired `quantity_received` / `accepted_quantity` / `quantity_accepted`
 * columns are not read (`scripts/check_no_quantity_received_column.py`).
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
/** The supplier has it: confirmed, on its way, or part delivered (an APPROVED order whose letter went out joins them, see `letterSent`). */
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
  /**
   * An APPROVED order whose letter to the vendor went out (a SENT outbound
   * conversation): approved means "we accepted the deal and are emailing the
   * vendor", and the order waits there until the vendor confirms. It counts as
   * sent. Absent for every other status.
   */
  letterSent?: boolean;
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

/**
 * What one order row asks for, in the book's own count (bottles, or each), or
 * null when that is not known exactly: a bottle line is its bottles, an each
 * line its count, a case line only when its bottle total is stated.
 */
function orderedCount(unit: string | null, qty: unknown, total: unknown, per: unknown): number | null {
  const q = n(qty);
  if (unit === "each") return q;
  if (unit === "bottle") return n(total) ?? (q === null ? null : q * (n(per) ?? 1));
  const t = n(total);
  return t !== null && t > 0 ? t : null;
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

  const HEAD = "id, order_number, restaurant_id, inventory_id, status, quantity, unit_type, bottles_total, expected_delivery_date";
  const LINE = "id, order_id, restaurant_id, inventory_id, quantity, unit_type, bottles_per_unit, total_bottles";

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

  // What a part-delivered order has taken in is the ledger's count for this good
  // (ADR 0192), read once for those orders. A failed read fails the card closed.
  const partial = open.filter(
    (o) =>
      up(o.status) === "PARTIALLY_RECEIVED" &&
      (withLines.has(String(o.id)) ? (byOrder.get(String(o.id)) ?? []).length > 0 : true),
  );
  const shelf = partial.length
    ? await readShelfReceived(
        client,
        restaurantId,
        partial.map((o) => ({
          id: String(o.id),
          inventory_id: itemId,
          unit_type: o.unit_type,
          quantity: o.quantity,
          bottles_total: o.bottles_total,
        })),
      )
    : new Map();
  for (const s of shelf.values()) if (!s.readable) return unread(s.why);
  const bookIsCount = (bookUom ?? "bottle") === "bottle" || bookUom === "each";

  const result: OpenOrder[] = [];
  for (const o of open) {
    const status = up(o.status);
    const id = String(o.id);
    const base = { id, orderNumber: o.order_number ?? null, status, expected: o.expected_delivery_date ?? null };
    const hasLines = withLines.has(id);
    const mine = byOrder.get(id) ?? [];
    if (hasLines && mine.length === 0) continue; // its lines are other goods'

    if (status === "PARTIALLY_RECEIVED") {
      // One order, one ledger count for this good: it is taken off the order's
      // exact bottles. If those are not known exactly, nothing is subtracted
      // and nothing is summed (the order stays listed, its figure unknown).
      const got = shelf.get(id);
      const received = got && got.readable ? got.quantityInStockUom : 0;
      const parts = hasLines ? mine.map((l) => orderedCount(unitOf(l.unit_type), l.quantity, l.total_bottles, l.bottles_per_unit)) : [orderedCount(unitOf(o.unit_type), o.quantity, o.bottles_total, null)];
      const exact = bookIsCount && parts.every((x) => x !== null);
      const ordered = exact ? (parts as number[]).reduce((a, x) => a + x, 0) : null;
      if (ordered !== null) {
        const left = Math.max(0, ordered - received);
        if (left > 0) result.push({ ...base, openQty: left, unit: bookUom === "each" ? "each" : "bottle", inBookUnit: left });
      } else {
        const qty = hasLines ? mine.reduce((a, l) => a + Number(l.quantity ?? 0), 0) : Number(o.quantity ?? 0);
        const unit = unitOf((hasLines ? mine[0] : o).unit_type);
        if (qty > 0) result.push({ ...base, openQty: qty, unit, inBookUnit: null });
      }
      continue;
    }

    if (hasLines) {
      // Its lines win. Lines of one order in different units stay apart.
      const units = new Map<string | null, { qty: number; book: number | null; bookKnown: boolean }>();
      for (const l of mine) {
        const unit = unitOf(l.unit_type);
        const qty = Number(l.quantity ?? 0);
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
      const qty = Number(o.quantity ?? 0);
      if (qty <= 0) continue;
      const total = n(o.bottles_total);
      result.push({ ...base, openQty: qty, unit, inBookUnit: inBook(unit, bookUom, qty, total) });
    }
  }

  // An APPROVED order is not "not yet sent" once its letter has gone out.
  const approvedIds = [...new Set(result.filter((r) => r.status === "APPROVED").map((r) => r.id))];
  if (approvedIds.length) {
    const letters = await readByIds(approvedIds, (chunk) =>
      client
        .from("procurement_conversations")
        .select("id, order_id")
        .eq("restaurant_id", restaurantId)
        .eq("direction", "outbound")
        .eq("status", "SENT")
        .in("order_id", chunk),
    );
    if (letters.error) return unread(letters.error);
    const lettered = new Set(letters.rows.map((l) => String(l.order_id)));
    for (const r of result) if (r.status === "APPROVED" && lettered.has(r.id)) r.letterSent = true;
  }

  const isSent = (r: OpenOrder) => SENT.has(r.status) || r.letterSent === true;
  const sent = result.filter(isSent);
  const unsent = result.filter((r) => !isSent(r));
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
