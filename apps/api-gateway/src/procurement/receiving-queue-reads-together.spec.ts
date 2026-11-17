/**
 * The manager's receiving queue reads the shelf, the vendors' names and the
 * goods' names TOGETHER, not one after the other (r41 invoices audit, P10).
 * All three need only the orders, so a slow store paid three round trips in
 * a row for one page.
 *
 * Real: ReceivingService.managerQueue. The store is an in-memory fake that
 * answers each read after a short wait and records which reads were in flight
 * when each one began. A failed read must still say it failed.
 */
import { ReceivingService } from "./receiving.service";

type Row = Record<string, any>;
const REST = "rest-1";

function fakeDb(tables: Record<string, Row[]>, errors: Record<string, string> = {}) {
  const inFlight = new Set<string>();
  const startedWith: Record<string, string[]> = {};
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    const q: any = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      neq: (c: string, v: unknown) => (filters.push((r) => r[c] !== v), q),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
      not: (c: string, op: string, v: unknown) => (
        filters.push((r) => (op === "is" ? (r[c] ?? null) !== v : r[c] !== v)), q
      ),
      order: () => q,
      limit: () => q,
      range: () => q,
      then: (resolve: (v: any) => void) => {
        startedWith[table] ??= [...inFlight];
        inFlight.add(table);
        setTimeout(() => {
          inFlight.delete(table);
          if (errors[table]) return resolve({ data: null, error: { message: errors[table] } });
          resolve({ data: (tables[table] ?? []).filter((r) => filters.every((f) => f(r))), error: null });
        }, 15);
      },
    };
    return q;
  };
  return { db: { getClient: () => ({ from }) } as any, startedWith };
}

const tables = (): Record<string, Row[]> => ({
  procurement_orders: [
    {
      id: "ord-1", restaurant_id: REST, order_number: "ORD-1", match_status: "partial",
      discrepancy_notes: "short", quantity: 5, unit_type: "case", bottles_total: 60,
      inventory_id: "inv-1", match_verified_at: "2026-09-21T10:00:00.000Z", provider_id: "prov-1",
    },
  ],
  procurement_credits: [],
  procurement_receipt_events: [],
  inventory_transactions: [
    { id: "t1", restaurant_id: REST, order_id: "ord-1", inventory_id: "inv-1", stock_type: "live", quantity_change: 58, idempotency_key: "order-delivered-live:ord-1" },
  ],
  restaurant_inventory: [{ id: "inv-1", restaurant_id: REST, uom: "bottle", wine_name: "SYNTHETIC Red", display_name: null }],
  procurement_order_items: [{ id: "l1", restaurant_id: REST, order_id: "ord-1", unit_type: "case", bottles_per_unit: 12 }],
  providers: [{ id: "prov-1", name: "SYNTHETIC Vendor" }],
});

describe("the receiving queue reads its three follow-up lists together", () => {
  it("asks for the vendors' names while the shelf is still being read", async () => {
    const { db, startedWith } = fakeDb(tables());
    const out: any = await new ReceivingService(db).managerQueue(REST);
    expect(startedWith.providers).toContain("inventory_transactions");
    expect(out.items[0]).toMatchObject({ providerName: "SYNTHETIC Vendor", itemName: "SYNTHETIC Red", backorderBottles: 2 });
    expect(out.providerNamesUnavailable).toBe(false);
    expect(out.itemNamesUnavailable).toBe(false);
  });

  it("a failed vendor-name read is still said, and does not hide the goods' names", async () => {
    const { db } = fakeDb(tables(), { providers: "connection reset" });
    const out: any = await new ReceivingService(db).managerQueue(REST);
    expect(out.providerNamesUnavailable).toBe(true);
    expect(out.items[0].providerName).toBeNull();
    expect(out.items[0].itemName).toBe("SYNTHETIC Red");
  });
});
