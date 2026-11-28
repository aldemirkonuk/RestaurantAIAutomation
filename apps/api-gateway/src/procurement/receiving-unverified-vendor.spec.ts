import { ReceivingService } from "./receiving.service";

/**
 * r110 g2: "Counted at the door, no paperwork yet" names the vendor, and
 * every hop of the read names the house.
 */
function fake(t: { events: any[]; orders: any[]; providers?: any[]; providersError?: boolean }) {
  const calls: Array<{ table: string; eq: Record<string, unknown>; or: string | null }> = [];
  const client = {
    from(table: string) {
      const c = { table, eq: {} as Record<string, unknown>, or: null as string | null };
      calls.push(c);
      const rows = () =>
        table === "procurement_receipt_events"
          ? t.events
          : table === "procurement_orders"
            ? t.orders.filter((o) => o.restaurant_id === c.eq.restaurant_id)
            : (t.providers ?? []).filter(
                (p) => p.restaurant_id === null || `restaurant_id.eq.${p.restaurant_id},restaurant_id.is.null` === c.or,
              );
      const q: any = {
        select: () => q,
        eq: (k: string, v: unknown) => ((c.eq[k] = v), q),
        or: (f: string) => ((c.or = f), q),
        in: () => q,
        order: () => q,
        limit: () => q,
        then: (res: any, rej: any) =>
          Promise.resolve(
            table === "providers" && t.providersError
              ? { data: null, error: { message: "down" } }
              : { data: rows(), error: null },
          ).then(res, rej),
      };
      return q;
    },
  };
  return { db: { getClient: () => client } as any, calls };
}
const ev = (order_id: string, h: number) => ({
  order_id,
  stage: "case_count",
  counted_qty_bottles: 12,
  occurred_at: new Date(Date.now() - h * 3_600_000).toISOString(),
});

describe("listUnverified names the vendor, for this house only", () => {
  it("reads the vendor of each order and filters orders and vendors by the house", async () => {
    const { db, calls } = fake({
      events: [ev("o1", 2), ev("o2", 30)],
      orders: [
        { id: "o1", order_number: "PO-1", status: "PARTIALLY_RECEIVED", provider_id: "p1", restaurant_id: "house-a" },
        { id: "o2", order_number: "PO-2", status: "PARTIALLY_RECEIVED", provider_id: "p2", restaurant_id: "house-a" },
      ],
      providers: [
        { id: "p1", name: "acme", company_name: "Acme Wines", restaurant_id: "house-a" },
        { id: "p2", name: "Shared Spirits", company_name: null, restaurant_id: null },
      ],
    });
    const items = await new ReceivingService(db).listUnverified("house-a");
    expect(items.map((i) => [i.orderNumber, i.providerId, i.providerName])).toEqual([
      ["PO-2", "p2", "Shared Spirits"],
      ["PO-1", "p1", "Acme Wines"],
    ]);
    const byTable = Object.fromEntries(calls.map((c) => [c.table, c]));
    expect(byTable.procurement_receipt_events.eq.restaurant_id).toBe("house-a");
    expect(byTable.procurement_orders.eq.restaurant_id).toBe("house-a");
    expect(byTable.providers.or).toBe("restaurant_id.eq.house-a,restaurant_id.is.null");
  });

  it("another house's order gives no number and no vendor", async () => {
    const { db } = fake({
      events: [ev("o9", 2)],
      orders: [{ id: "o9", order_number: "PO-9", status: "PARTIALLY_RECEIVED", provider_id: "p9", restaurant_id: "house-b" }],
      providers: [{ id: "p9", name: "Theirs", company_name: null, restaurant_id: "house-b" }],
    });
    const [row] = await new ReceivingService(db).listUnverified("house-a");
    expect(row).toMatchObject({ orderNumber: null, providerId: null, providerName: null });
  });

  it("a failed vendor read names no vendor and still lists the delivery", async () => {
    const { db } = fake({
      events: [ev("o1", 2)],
      orders: [{ id: "o1", order_number: "PO-1", status: "PARTIALLY_RECEIVED", provider_id: "p1", restaurant_id: "house-a" }],
      providersError: true,
    });
    const [row] = await new ReceivingService(db).listUnverified("house-a");
    expect(row).toMatchObject({ orderNumber: "PO-1", providerId: "p1", providerName: null });
  });
});
