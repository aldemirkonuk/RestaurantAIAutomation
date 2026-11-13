import { readWholeWindow, type WholeWindowQuery } from "../common/read-whole-window";
import { ProcurementOrderStatus } from "./dto/procurement.dto";

/**
 * How many open orders each vendor has, counted over the WHOLE book.
 *
 * WHY THIS EXISTS
 * ---------------
 * /vendors printed "open orders" on every vendor card by counting the rows of
 * `GET /procurement/orders`, which answers the newest 50 orders and nothing
 * else (`listOrders`' default limit). One busy Monday of fifty one-line orders
 * pushed every older open order off that page, and a vendor holding three
 * approved, undelivered orders read "0" — a smaller number that is not a
 * smaller truth (ADR 0020; QA round 3b H2 found the same cut on /orders).
 *
 * THE RULE
 * --------
 * Open is the set /vendors already used (`useProvidersNextData.ts`
 * `OPEN_STAGES`, read through `canonicalStatus`): placed, waiting, being
 * negotiated, approved, confirmed, on its way, or partly received. DELIVERED
 * and every closed state are not open. The window is read whole through
 * `readWholeWindow` (ADR 0292) or the read refuses with a 503 — never a count
 * from part of the book. Only `id` and `provider_id` are read: the card needs a
 * number per vendor, not the orders.
 */
export const OPEN_ORDER_STATUSES: readonly ProcurementOrderStatus[] = [
  ProcurementOrderStatus.PENDING,
  ProcurementOrderStatus.APPROVAL_NEEDED,
  ProcurementOrderStatus.NEGOTIATING,
  ProcurementOrderStatus.APPROVED,
  ProcurementOrderStatus.CONFIRMED,
  ProcurementOrderStatus.IN_TRANSIT,
  ProcurementOrderStatus.PARTIALLY_RECEIVED,
];

export interface OpenOrdersByVendor {
  /** Open orders per vendor id. A vendor with none is absent, read as 0. */
  byVendor: Record<string, number>;
  /** Every open order in the house, including any with no vendor on it. */
  total: number;
}

/** The one call this reader makes; the Supabase client satisfies it. */
export interface OpenOrdersClient {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  from(table: string): any;
}

export async function readOpenOrdersByVendor(
  client: OpenOrdersClient,
  restaurantId: string,
): Promise<OpenOrdersByVendor> {
  const rows = await readWholeWindow<{ id: string; provider_id: string | null }>(
    "The house's open orders",
    () =>
      client
        .from("procurement_orders")
        .select("id, provider_id", { count: "exact" })
        .eq("restaurant_id", restaurantId)
        .in("status", OPEN_ORDER_STATUSES) as WholeWindowQuery,
  );
  const byVendor: Record<string, number> = {};
  for (const row of rows) {
    if (!row.provider_id) continue;
    byVendor[row.provider_id] = (byVendor[row.provider_id] ?? 0) + 1;
  }
  return { byVendor, total: rows.length };
}
