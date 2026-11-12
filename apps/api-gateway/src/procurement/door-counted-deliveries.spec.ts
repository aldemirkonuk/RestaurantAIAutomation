import {
  OPEN_DELIVERY_CAP,
  readDoorCountedWithoutPaper,
} from "./door-counted-deliveries";

/**
 * R10 (receipts walk, 2026-11-11): a door count made with `createDelivery`
 * writes a delivery and a `door_count` document, never a receipt event, so the
 * "Counted at the door, no paperwork yet" strip stayed empty. These prove the
 * reader finds it, keeps the paper rule, keeps units apart, and never turns a
 * failed or capped read into an empty one.
 */

type Row = Record<string, any>;
type Tables = Record<string, Row[]>;

const HOUSE = "h1";
const NOW = Date.parse("2026-11-11T12:00:00Z");
const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

function fakeClient(tables: Tables, failOn: string | null = null) {
  const reads: Array<{ table: string; filters: Array<[string, string, any]> }> = [];
  return {
    reads,
    from(table: string) {
      const filters: Array<[string, string, any]> = [];
      reads.push({ table, filters });
      let cap = Infinity;
      const q: any = {
        select: () => q,
        eq: (c: string, v: any) => (filters.push(["eq", c, v]), q),
        in: (c: string, v: any[]) => (filters.push(["in", c, v]), q),
        order: () => q,
        limit: (n: number) => ((cap = n), q),
        then: (ok: (r: any) => unknown, bad?: (e: unknown) => unknown) => {
          if (failOn === table)
            return Promise.resolve({ data: null, error: { message: "connection reset" } }).then(ok, bad);
          const rows = (tables[table] ?? []).filter((r) =>
            filters.every(([op, c, v]) =>
              op === "eq" ? r[c] === v : (v as any[]).includes(r[c]),
            ),
          );
          return Promise.resolve({ data: rows.slice(0, cap), error: null }).then(ok, bad);
        },
      };
      return q;
    },
  };
}

const base = (): Tables => ({
  deliveries: [
    // Counted at the door against an order, nothing on paper: waiting.
    { id: "d1", restaurant_id: HOUSE, state: "DELIVERED", order_id: "o1", delivered_at: hoursAgo(3) },
    // Unordered, counted 60 h ago: waiting, overdue.
    { id: "d2", restaurant_id: HOUSE, state: "DELIVERED", order_id: null, provider_id: "p1", delivered_at: hoursAgo(60) },
    // Has its invoice: in the review queue, not here.
    { id: "d3", restaurant_id: HOUSE, state: "RECONCILING", order_id: null, delivered_at: hoursAgo(5) },
    // Verified: settled.
    { id: "d4", restaurant_id: HOUSE, state: "VERIFIED", order_id: null, delivered_at: hoursAgo(5) },
    // No door count at all (an e-irsaliye only): not "counted at the door".
    { id: "d5", restaurant_id: HOUSE, state: "DELIVERED", order_id: null, delivered_at: hoursAgo(5) },
    // Another house's delivery.
    { id: "dX", restaurant_id: "h2", state: "DELIVERED", order_id: null, delivered_at: hoursAgo(5) },
  ],
  document_deliveries: [
    { delivery_id: "d1", document_id: "c1", role: "door_count" },
    { delivery_id: "d1", document_id: "po1", role: "purchase_order" },
    { delivery_id: "d2", document_id: "c2", role: "door_count" },
    { delivery_id: "d3", document_id: "c3", role: "door_count" },
    { delivery_id: "d3", document_id: "inv3", role: "invoice" },
    { delivery_id: "d4", document_id: "c4", role: "door_count" },
    { delivery_id: "d5", document_id: "n5", role: "despatch_advice" },
    { delivery_id: "dX", document_id: "cX", role: "door_count" },
  ],
  procurement_document_lines: [
    { document_id: "c1", qty_bottles: 10, uom: "bottle" },
    // A keg line's qty_bottles is its kegs (toBottles passes them through): named apart, never added.
    { document_id: "c1", qty_bottles: 2, uom: "keg" },
    { document_id: "c1", qty_bottles: "12" },
    // A weight line: no bottle figure, never added to bottles.
    { document_id: "c2", qty_bottles: 6 },
    { document_id: "c2", qty_bottles: null },
  ],
  procurement_orders: [{ id: "o1", restaurant_id: HOUSE, order_number: "PO-7" }],
  providers: [
    { id: "p1", restaurant_id: HOUSE, name: "Ege Şarap", company_name: null },
    { id: "pX", restaurant_id: "h2", name: "Another house's vendor", company_name: null },
  ],
});

describe("readDoorCountedWithoutPaper (R10)", () => {
  it("lists a door-counted delivery with no vendor paper, oldest first, and nothing else", async () => {
    const { rows, capped } = await readDoorCountedWithoutPaper(fakeClient(base()), HOUSE, NOW);
    expect(rows.map((r) => r.deliveryId)).toEqual(["d2", "d1"]);
    expect(capped).toBe(false);
    const [d2, d1] = rows;
    expect(d1).toMatchObject({
      orderId: "o1",
      orderNumber: "PO-7",
      providerId: null,
      vendorName: null,
      countedQtyBottles: 22,
      linesWithoutBottles: 1,
      severity: "fresh",
      ageHours: 3,
    });
    expect(d2).toMatchObject({
      orderId: null,
      orderNumber: null,
      providerId: "p1",
      vendorName: "Ege Şarap",
      countedQtyBottles: 6,
      linesWithoutBottles: 1,
      severity: "overdue",
    });
  });

  it("reads only this house's deliveries, and only open states", async () => {
    const c = fakeClient(base());
    await readDoorCountedWithoutPaper(c, HOUSE, NOW);
    const d = c.reads.find((r) => r.table === "deliveries")!;
    expect(d.filters).toContainEqual(["eq", "restaurant_id", HOUSE]);
    expect(d.filters).toContainEqual(["in", "state", ["DELIVERED", "RECONCILING", "AGREED"]]);
    const o = c.reads.find((r) => r.table === "procurement_orders")!;
    expect(o.filters).toContainEqual(["eq", "restaurant_id", HOUSE]);
  });

  it("a delivery whose paper arrived leaves the list", async () => {
    const t = base();
    t.document_deliveries.push({ delivery_id: "d1", document_id: "inv1", role: "invoice" });
    const { rows } = await readDoorCountedWithoutPaper(fakeClient(t), HOUSE, NOW);
    expect(rows.map((r) => r.deliveryId)).toEqual(["d2"]);
  });

  it.each(["deliveries", "document_deliveries", "procurement_document_lines", "procurement_orders"])(
    "a failed read of %s throws; it is never an empty list",
    async (table) => {
      await expect(
        readDoorCountedWithoutPaper(fakeClient(base(), table), HOUSE, NOW),
      ).rejects.toThrow(/could not be read: connection reset/);
    },
  );

  it("a read that lands on its cap says the list is a floor", async () => {
    const t = base();
    t.deliveries = Array.from({ length: OPEN_DELIVERY_CAP }, (_, i) => ({
      id: `p${i}`,
      restaurant_id: HOUSE,
      state: "DELIVERED",
      order_id: null,
      delivered_at: hoursAgo(1),
    }));
    const { capped } = await readDoorCountedWithoutPaper(fakeClient(t), HOUSE, NOW);
    expect(capped).toBe(true);
  });

  it("names the vendor only from this house's providers (browser walk 2026-11-12)", async () => {
    const t = base();
    // d1 names a provider id that belongs to another house: no name, never a guess.
    t.deliveries[0].provider_id = "pX";
    const c = fakeClient(t);
    const { rows } = await readDoorCountedWithoutPaper(c, HOUSE, NOW);
    expect(rows.find((r) => r.deliveryId === "d1")).toMatchObject({ providerId: "pX", vendorName: null });
    expect(rows.find((r) => r.deliveryId === "d2")).toMatchObject({ vendorName: "Ege Şarap" });
    const p = c.reads.find((r) => r.table === "providers")!;
    expect(p.filters).toContainEqual(["eq", "restaurant_id", HOUSE]);
  });

  it("a failed vendor read fails the list, never an unnamed row", async () => {
    await expect(
      readDoorCountedWithoutPaper(fakeClient(base(), "providers"), HOUSE, NOW),
    ).rejects.toThrow(/vendors on the deliveries could not be read/);
  });

  it("no open delivery reads nothing further", async () => {
    const c = fakeClient({ deliveries: [] });
    const { rows, capped } = await readDoorCountedWithoutPaper(c, HOUSE, NOW);
    expect(rows).toEqual([]);
    expect(capped).toBe(false);
    expect(c.reads.map((r) => r.table)).toEqual(["deliveries"]);
  });
});
