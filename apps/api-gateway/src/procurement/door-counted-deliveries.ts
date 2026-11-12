/**
 * Deliveries counted at the door that have no vendor paper yet (R10,
 * mail-receipts lane 2026-11-11).
 *
 * WHY THIS EXISTS. The door has two ways in. The order door
 * (`ReceivingService.recordDoorReceipt`) writes `procurement_receipt_events`,
 * and `listUnverified` has always read those. The document door
 * (`POST /procurement/documents/door-count` with `createDelivery`, ADR 0103 /
 * ADR 0104 D11) writes a `receiving_advice` document, a `deliveries` row with a
 * `door_count` role, and books provisional lots — and writes no receipt event.
 * So every delivery counted that way was invisible to "Counted at the door, no
 * paperwork yet": the receipts walk counted at the door, booked 10, and the
 * strip read `items: []`.
 *
 * WHAT COUNTS. A delivery of this house that
 *   - is still open: `state` DELIVERED, RECONCILING or AGREED (ADR 0103 D1;
 *     VERIFIED, INVOICE_FILED, LAPSED*, CANCELLED and REJECTED are settled one
 *     way or another), and
 *   - carries a `door_count` document, and
 *   - carries no vendor paper: no `invoice`, `despatch_advice`, `credit_memo`,
 *     `statement` or `other` document. A purchase order is the house's own
 *     paper, so it does not end the wait. Once an invoice is on the delivery
 *     it is in the review queue, and listing it here too would count it twice.
 *
 * WHAT IT SAYS. `countedQtyBottles` is the door count's own `qty_bottles`, summed
 * over the lines that state one. A line in a unit with no bottle figure (a keg,
 * a liter, a weight; its `qty_bottles` is the column's default 0) is not added
 * in, never grams to bottles; `linesWithoutBottles` says how many.
 *
 * READS ARE BOUNDED AND SAY SO (ADR 0051). Open deliveries are read newest
 * first, at most `OPEN_DELIVERY_CAP`; the line read is chunked under PostgREST's
 * 1000-row `max_rows`. A read that lands on a cap returns `capped: true`, and a
 * failed read throws — an empty strip must only ever mean nothing is waiting.
 */

/** Open states: arrived, and not yet settled (ADR 0103 D1). */
export const OPEN_DELIVERY_STATES = ["DELIVERED", "RECONCILING", "AGREED"] as const;

/** Roles that are vendor paper. `purchase_order` is ours; `door_count` is the count. */
export const PAPER_ROLES: ReadonlySet<string> = new Set([
  "invoice",
  "despatch_advice",
  "credit_memo",
  "statement",
  "other",
]);

/** How many open deliveries one read looks at, newest first. */
export const OPEN_DELIVERY_CAP = 200;
/** Ids per `.in()` filter, so a request URL stays short. */
const IN_CHUNK = 100;
/** PostgREST `max_rows` (`supabase/config.toml`). */
const MAX_ROWS = 1000;

/**
 * Units with no bottle figure (`document-types.ts` `comparableUnits` keeps
 * keg and liter opaque; `kg` is listed ahead of the weight unit, R8). Their
 * `qty_bottles` is the column default 0, not a count, so the line is named
 * apart instead of being added in as nothing.
 */
const NO_BOTTLE_FIGURE: ReadonlySet<string> = new Set(["keg", "liter", "kg"]);

const STALE_AFTER_HOURS = 12;
const OVERDUE_AFTER_HOURS = 48;

export interface DoorCountedDelivery {
  deliveryId: string;
  /** The order it was counted against, when the door named one. */
  orderId: string | null;
  orderNumber: string | null;
  /** Bottles the door counted, from the lines that state a bottle figure. */
  countedQtyBottles: number;
  /** Lines counted in a unit with no bottle figure (a weight, a keg), not added in. */
  linesWithoutBottles: number;
  countedAt: string;
  ageHours: number;
  severity: "fresh" | "stale" | "overdue";
}

interface ReadClient {
  from: (table: string) => any;
}

function chunks<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

function fail(what: string, error: { message?: string }): never {
  throw new Error(`${what} could not be read: ${error.message ?? String(error)}`);
}

export async function readDoorCountedWithoutPaper(
  client: ReadClient,
  restaurantId: string,
  now: number = Date.now(),
): Promise<{ rows: DoorCountedDelivery[]; capped: boolean }> {
  const open = await client
    .from("deliveries")
    .select("id, order_id, delivered_at, created_at")
    .eq("restaurant_id", restaurantId)
    .in("state", [...OPEN_DELIVERY_STATES])
    .order("delivered_at", { ascending: false, nullsFirst: false })
    .limit(OPEN_DELIVERY_CAP);
  if (open.error) fail("The open deliveries", open.error);
  const deliveries = (open.data ?? []) as Array<{
    id: string;
    order_id: string | null;
    delivered_at: string | null;
    created_at: string | null;
  }>;
  let capped = deliveries.length === OPEN_DELIVERY_CAP;
  if (!deliveries.length) return { rows: [], capped };

  // Which documents sit on each delivery, and in what role.
  const doorDocs = new Map<string, string[]>();
  const hasPaper = new Set<string>();
  for (const ids of chunks(deliveries.map((d) => d.id), IN_CHUNK)) {
    const members = await client
      .from("document_deliveries")
      .select("delivery_id, document_id, role")
      .in("delivery_id", ids)
      .limit(MAX_ROWS);
    if (members.error) fail("The documents on the open deliveries", members.error);
    const rows = (members.data ?? []) as Array<{
      delivery_id: string;
      document_id: string;
      role: string;
    }>;
    if (rows.length === MAX_ROWS) capped = true;
    for (const m of rows) {
      if (m.role === "door_count")
        doorDocs.set(m.delivery_id, [...(doorDocs.get(m.delivery_id) ?? []), m.document_id]);
      else if (PAPER_ROLES.has(m.role)) hasPaper.add(m.delivery_id);
    }
  }

  const waiting = deliveries.filter((d) => doorDocs.has(d.id) && !hasPaper.has(d.id));
  if (!waiting.length) return { rows: [], capped };

  // The door count's lines. Chunked by document so one read stays under
  // max_rows for any count a door actually makes.
  const bottles = new Map<string, number>();
  const unbottled = new Map<string, number>();
  const docIds = waiting.flatMap((d) => doorDocs.get(d.id) ?? []);
  for (const ids of chunks(docIds, 20)) {
    const lines = await client
      .from("procurement_document_lines")
      .select("document_id, qty_bottles, uom")
      .in("document_id", ids)
      .limit(MAX_ROWS);
    if (lines.error) fail("The door counts' lines", lines.error);
    const rows = (lines.data ?? []) as Array<{
      document_id: string;
      qty_bottles: number | string | null;
      uom?: string | null;
    }>;
    if (rows.length === MAX_ROWS) capped = true;
    for (const l of rows) {
      const n = l.qty_bottles == null || l.qty_bottles === "" ? null : Number(l.qty_bottles);
      const opaque = NO_BOTTLE_FIGURE.has(String(l.uom ?? "").toLowerCase());
      if (opaque || n == null || !Number.isFinite(n))
        unbottled.set(l.document_id, (unbottled.get(l.document_id) ?? 0) + 1);
      else bottles.set(l.document_id, (bottles.get(l.document_id) ?? 0) + n);
    }
  }

  // Order numbers, for the deliveries counted against an order.
  const orderIds = [...new Set(waiting.map((d) => d.order_id).filter((x): x is string => !!x))];
  const numbers = new Map<string, string | null>();
  for (const ids of chunks(orderIds, IN_CHUNK)) {
    const orders = await client
      .from("procurement_orders")
      .select("id, order_number")
      .eq("restaurant_id", restaurantId)
      .in("id", ids);
    if (orders.error) fail("The order numbers", orders.error);
    for (const o of (orders.data ?? []) as Array<{ id: string; order_number: string | null }>)
      numbers.set(o.id, o.order_number ?? null);
  }

  const rows = waiting
    .map((d): DoorCountedDelivery => {
      const at = d.delivered_at ?? d.created_at ?? new Date(now).toISOString();
      const ageHours = Math.max(0, (now - new Date(at).getTime()) / 3_600_000);
      const docs = doorDocs.get(d.id) ?? [];
      return {
        deliveryId: d.id,
        orderId: d.order_id,
        orderNumber: d.order_id ? (numbers.get(d.order_id) ?? null) : null,
        countedQtyBottles: docs.reduce((n, id) => n + (bottles.get(id) ?? 0), 0),
        linesWithoutBottles: docs.reduce((n, id) => n + (unbottled.get(id) ?? 0), 0),
        countedAt: at,
        ageHours: Math.round(ageHours),
        severity:
          ageHours >= OVERDUE_AFTER_HOURS
            ? "overdue"
            : ageHours >= STALE_AFTER_HOURS
              ? "stale"
              : "fresh",
      };
    })
    .sort((a, b) => b.ageHours - a.ageHours);
  return { rows, capped };
}
