import { DashboardService } from "./dashboard.service";
import { paperRowsOf, readPaperSpend, withPaperSpend, PAPER_SPEND_STATES } from "./paper-spend";
import { bucketSpend, HOUSE_NOT_NEEDED } from "./uncosted-spend";

/**
 * r36 invoices R3: a house that buys by scanning the paper (scan, count,
 * agree, verify) has deliveries with no order, and "Paid to vendors" read 0
 * for them. A verified delivery with no order is now spend, by its papers.
 * SYNTHETIC data.
 */
const TRY = { code: "TRY", unread: false };
const d = (id: string, delivered_at: string | null, verified_at: string | null = null) => ({ id, delivered_at, verified_at });
const inv = (document_id: string, delivery_id: string) => ({ document_id, delivery_id, role: "invoice" });
const cr = (document_id: string, delivery_id: string) => ({ document_id, delivery_id, role: "credit_memo" });
const doc = (id: string, total: number | string | null, currency: string | null = "TRY", status = "verified") => ({ id, total, currency, status });

describe("paperRowsOf", () => {
  it("one verified delivery, one invoice: its total, in its money, on the day it came in", () => {
    expect(paperRowsOf([d("d1", "2026-11-03T09:00:00Z", "2026-11-04T09:00:00Z")], [inv("p1", "d1")], [doc("p1", "1250.50")])).toEqual([
      { deliveryId: "d1", delivered_at: "2026-11-03T09:00:00Z", total_cost: 1250.5, final_price: null, currency: "TRY", givenBack: false },
    ]);
  });

  it("with no door date, the day it was verified", () => {
    expect(paperRowsOf([d("d1", null, "2026-11-04T09:00:00Z")], [inv("p1", "d1")], [doc("p1", 10)])[0].delivered_at).toBe("2026-11-04T09:00:00Z");
  });

  it("a credit memo comes off its delivery's invoices", () => {
    const rows = paperRowsOf([d("d1", "2026-11-03T09:00:00Z")], [inv("p1", "d1"), cr("c1", "d1")], [doc("p1", 1000), doc("c1", -150)]);
    expect(rows[0].total_cost).toBe(850);
  });

  it("credits that meet the invoices add nothing, and the delivery is not 'uncosted'", () => {
    const rows = paperRowsOf([d("d1", "2026-11-03T09:00:00Z")], [inv("p1", "d1"), cr("c1", "d1")], [doc("p1", 100), doc("c1", 100)]);
    expect(rows[0]).toMatchObject({ total_cost: null, givenBack: true });
  });

  it("a delivery with no invoice, or an invoice with no total, has no recorded cost", () => {
    const rows = paperRowsOf(
      [d("d1", "2026-11-03T09:00:00Z"), d("d2", "2026-11-03T09:00:00Z")],
      [inv("p2", "d2")],
      [doc("p2", null)],
    );
    expect(rows.map((r) => [r.deliveryId, r.total_cost, r.givenBack])).toEqual([
      ["d1", null, false],
      ["d2", null, false],
    ]);
  });

  it("papers in two monies on one delivery are not added", () => {
    const rows = paperRowsOf([d("d1", "2026-11-03T09:00:00Z")], [inv("p1", "d1"), inv("p2", "d1")], [doc("p1", 100, "TRY"), doc("p2", 50, "EUR")]);
    expect(rows[0]).toMatchObject({ total_cost: null, currency: null });
  });

  it("a rejected or superseded paper is not read", () => {
    const rows = paperRowsOf(
      [d("d1", "2026-11-03T09:00:00Z")],
      [inv("p1", "d1"), inv("p2", "d1"), inv("p3", "d1")],
      [doc("p1", 100), doc("p2", 999, "TRY", "rejected"), doc("p3", 999, "TRY", "superseded")],
    );
    expect(rows[0].total_cost).toBe(100);
  });

  it("a consolidated invoice is counted once, on its earliest delivery, and its sibling is not left 'uncosted'", () => {
    const rows = paperRowsOf(
      [d("late", "2026-11-05T09:00:00Z"), d("early", "2026-11-02T09:00:00Z")],
      [inv("p1", "late"), inv("p1", "early")],
      [doc("p1", 600)],
    );
    expect(rows).toEqual([
      { deliveryId: "early", delivered_at: "2026-11-02T09:00:00Z", total_cost: 600, final_price: null, currency: "TRY", givenBack: false },
    ]);
  });

  it("a door-count paper is not spend", () => {
    const rows = paperRowsOf([d("d1", "2026-11-03T09:00:00Z")], [{ document_id: "p1", delivery_id: "d1", role: "door_count" }], [doc("p1", 100)]);
    expect(rows[0].total_cost).toBeNull();
  });
});

describe("withPaperSpend", () => {
  const orders = bucketSpend([{ total_cost: 400, currency: "TRY" }], TRY);

  it("adds the papers to the orders", () => {
    const rows = paperRowsOf([d("d1", "2026-11-03T09:00:00Z")], [inv("p1", "d1")], [doc("p1", "250.25")]);
    const r = withPaperSpend(orders, rows, TRY, null);
    expect(r.read.spend).toBe(650.25);
    expect(r.papers).toEqual({ counted: 1, uncosted: 0, notInHouseCurrency: {} });
  });

  it("a house with no orders and a verified paper is not 0", () => {
    const none = bucketSpend([], TRY);
    const rows = paperRowsOf([d("d1", "2026-11-03T09:00:00Z")], [inv("p1", "d1")], [doc("p1", 90)]);
    expect(withPaperSpend(none, rows, TRY, null).read.spend).toBe(90);
  });

  it("a paper with no total withholds the window, and says so about deliveries, not orders", () => {
    const rows = paperRowsOf([d("d1", "2026-11-03T09:00:00Z")], [inv("p1", "d1")], [doc("p1", null)]);
    const r = withPaperSpend(orders, rows, TRY, null);
    expect(r.read.spend).toBeNull();
    expect(r.read.unread).toBe("1 scanned delivery with no order has no invoice total on its papers yet.");
    expect(r.papers.uncosted).toBe(1);
    // the order counts stay orders only
    expect(r.read.uncosted).toBe(0);
  });

  it("a paper in another money withholds the window and is counted by its code", () => {
    const rows = paperRowsOf([d("d1", "2026-11-03T09:00:00Z")], [inv("p1", "d1")], [doc("p1", 80, "EUR")]);
    const r = withPaperSpend(orders, rows, TRY, null);
    expect(r.read.spend).toBeNull();
    expect(r.papers.notInHouseCurrency).toEqual({ EUR: 1 });
    expect(r.read.unread).toContain("1 scanned delivery with no order is not in house currency (1 in EUR)");
  });

  it("a delivery given back adds nothing and withholds nothing", () => {
    const rows = paperRowsOf([d("d1", "2026-11-03T09:00:00Z")], [inv("p1", "d1"), cr("c1", "d1")], [doc("p1", 100), doc("c1", 100)]);
    const r = withPaperSpend(orders, rows, TRY, null);
    expect(r.read.spend).toBe(400);
    expect(r.papers.counted).toBe(1);
  });

  it("papers that could not be read withhold the figure with the reason, never read as none", () => {
    const r = withPaperSpend(orders, [], TRY, "The scanned papers could not be read.");
    expect(r.read.spend).toBeNull();
    expect(r.read.unread).toBe("The scanned papers could not be read.");
  });

  it("an order's own reason is kept beside the papers'", () => {
    const uncostedOrder = bucketSpend([{ total_cost: null }], HOUSE_NOT_NEEDED);
    const rows = paperRowsOf([d("d1", "2026-11-03T09:00:00Z")], [inv("p1", "d1")], [doc("p1", null, null)]);
    const r = withPaperSpend(uncostedOrder, rows, HOUSE_NOT_NEEDED, null);
    expect(r.read.unread).toContain(uncostedOrder.unread as string);
    expect(r.read.unread).toContain("1 scanned delivery with no order has no invoice total");
  });
});

/** A thenable query builder; each table answers its rows, or an error. */
function fakeClient(rows: Record<string, any[]>, errors: Record<string, string> = {}) {
  const asked: Record<string, unknown[][]> = {};
  return {
    asked,
    from: jest.fn((table: string) => {
      const b: any = {};
      const mine: unknown[][] = [];
      (asked[table] ??= []).push(mine);
      for (const m of ["select", "eq", "neq", "gt", "gte", "lt", "lte", "is", "or", "not", "order", "limit", "in"])
        b[m] = jest.fn((...args: unknown[]) => {
          mine.push([m, ...args]);
          return b;
        });
      b.then = (ok: any, no: any) =>
        Promise.resolve(errors[table] ? { data: null, error: { message: errors[table] } } : { data: rows[table] ?? [], error: null }).then(ok, no);
      return b;
    }),
  };
}

describe("readPaperSpend", () => {
  it("reads this house's verified deliveries with no order, their invoice papers, and the papers in this house", async () => {
    const c = fakeClient({
      deliveries: [d("d1", "2026-11-03T09:00:00Z")],
      document_deliveries: [inv("p1", "d1")],
      procurement_documents: [doc("p1", 120)],
    });
    const r = await readPaperSpend(c, "rest-1");
    expect(r.unread).toBeNull();
    expect(r.rows.map((x) => x.total_cost)).toEqual([120]);
    const del = c.asked.deliveries[0];
    expect(del).toEqual(
      expect.arrayContaining([
        ["eq", "restaurant_id", "rest-1"],
        ["is", "order_id", null],
        ["in", "state", [...PAPER_SPEND_STATES]],
      ]),
    );
    expect(c.asked.document_deliveries[0]).toEqual(expect.arrayContaining([["in", "role", ["invoice", "credit_memo"]]]));
    expect(c.asked.procurement_documents[0]).toEqual(expect.arrayContaining([["eq", "restaurant_id", "rest-1"]]));
  });

  it.each(["deliveries", "document_deliveries", "procurement_documents"])("a failed %s read is a reason, never an empty list", async (table) => {
    const c = fakeClient(
      { deliveries: [d("d1", "2026-11-03T09:00:00Z")], document_deliveries: [inv("p1", "d1")], procurement_documents: [doc("p1", 1)] },
      { [table]: "boom" },
    );
    const r = await readPaperSpend(c, "rest-1");
    expect(r.rows).toEqual([]);
    expect(r.unread).toMatch(/could not be read/);
  });

  it("no verified delivery without an order reads no papers at all", async () => {
    const c = fakeClient({});
    const r = await readPaperSpend(c, "rest-1");
    expect(r).toEqual({ rows: [], unread: null });
    expect(c.asked.document_deliveries).toBeUndefined();
  });
});

describe("getStats — Paid to vendors counts the scanned papers", () => {
  const NOW = new Date();
  const today = NOW.toISOString();

  function service(rows: Record<string, any[]>, errors: Record<string, string> = {}) {
    const c = fakeClient({ restaurants: [{ timezone: "UTC", currency: "TRY" }], ...rows }, errors);
    return new DashboardService({ getClient: () => c } as any, {} as any, {} as any);
  }

  it("a house that only scans papers reads what they cost, not 0", async () => {
    const s: any = await service({
      deliveries: [d("d1", today)],
      document_deliveries: [inv("p1", "d1")],
      procurement_documents: [doc("p1", 640)],
    }).getStats("r1");
    expect(s.todayProcurementSpend).toBe(640);
    expect(s.monthProcurementSpend).toBe(640);
    expect(s.scannedDeliveries.month).toEqual({ counted: 1, uncosted: 0, notInHouseCurrency: {} });
  });

  it("a paper read that fails withholds the month, with why", async () => {
    const s: any = await service({ deliveries: [d("d1", today)] }, { document_deliveries: "down" }).getStats("r1");
    expect(s.monthProcurementSpend).toBeNull();
    expect(s.unread.monthProcurementSpend).toMatch(/scanned papers .* could not be read/);
  });
});
