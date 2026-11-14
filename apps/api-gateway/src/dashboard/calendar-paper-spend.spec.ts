import { DashboardService } from "./dashboard.service";

/**
 * r36 invoices R3, the month calendar: a verified delivery with no order is
 * spend on the day it came in, by its papers, the same rule as the "Paid to
 * vendors" tiles. Before this a house that buys by scanning the paper read
 * $0 on every day of the month under a tile that said what it paid.
 * SYNTHETIC data.
 */
const d = (id: string, delivered_at: string | null, verified_at: string | null = null) => ({ id, delivered_at, verified_at });
const inv = (document_id: string, delivery_id: string) => ({ document_id, delivery_id, role: "invoice" });
const doc = (id: string, total: number | string | null, currency: string | null = "TRY") => ({ id, total, currency, status: "verified" });

function fakeClient(rows: Record<string, any[]>, errors: Record<string, string> = {}) {
  return {
    from: jest.fn((table: string) => {
      const b: any = {};
      for (const m of ["select", "eq", "neq", "gt", "gte", "lt", "lte", "is", "or", "not", "order", "limit", "in", "range"])
        b[m] = jest.fn(() => b);
      b.maybeSingle = () => Promise.resolve({ data: (rows[table] ?? [])[0] ?? null, error: null });
      b.single = b.maybeSingle;
      b.then = (ok: any, no: any) =>
        Promise.resolve(errors[table] ? { data: null, error: { message: errors[table] } } : { data: rows[table] ?? [], error: null }).then(ok, no);
      return b;
    }),
  };
}

const month = (rows: Record<string, any[]>, errors: Record<string, string> = {}) =>
  new DashboardService(
    { getClient: () => fakeClient({ restaurants: [{ timezone: "UTC", country: "TR", currency: "TRY" }], ...rows }, errors) } as any,
    {} as any,
    {} as any,
  ).getCalendarRevenue("r1", 2026, 3);

const day = (m: any, date: string) => m.daily.find((x: any) => x.date === date);
const none = { counted: 0, uncosted: 0, notInHouseCurrency: {} };

describe("getCalendarRevenue — the month counts the scanned papers", () => {
  it("puts a verified delivery with no order on the day it came in, and in the month", async () => {
    const m: any = await month({
      deliveries: [d("d1", "2026-03-04T10:00:00Z"), d("d2", null, "2026-03-09T08:00:00Z")],
      document_deliveries: [inv("p1", "d1"), inv("p2", "d2")],
      procurement_documents: [doc("p1", 640), doc("p2", "110.50")],
    });
    expect(day(m, "2026-03-04").procurement_spend).toBe(640);
    expect(day(m, "2026-03-04").scanned_deliveries).toEqual({ counted: 1, uncosted: 0, notInHouseCurrency: {} });
    // No delivery time: the day it was verified.
    expect(day(m, "2026-03-09").procurement_spend).toBe(110.5);
    expect(day(m, "2026-03-05").procurement_spend).toBe(0);
    expect(day(m, "2026-03-05").scanned_deliveries).toEqual(none);
    expect(m.monthly_procurement_spend).toBe(750.5);
    expect(m.monthly_scanned_deliveries).toEqual({ counted: 2, uncosted: 0, notInHouseCurrency: {} });
  });

  it("a delivery from another month is not on this one", async () => {
    const m: any = await month({
      deliveries: [d("d1", "2026-02-28T10:00:00Z"), d("d2", "2026-04-01T00:00:00Z")],
      document_deliveries: [inv("p1", "d1"), inv("p2", "d2")],
      procurement_documents: [doc("p1", 640), doc("p2", 50)],
    });
    expect(m.monthly_procurement_spend).toBe(0);
    expect(m.monthly_scanned_deliveries).toEqual(none);
    expect(m.daily.every((x: any) => x.procurement_spend === 0)).toBe(true);
  });

  it("a delivery with no invoice total withholds its day and the month, with why; other days still read", async () => {
    const m: any = await month({
      deliveries: [d("d1", "2026-03-04T10:00:00Z"), d("d2", "2026-03-06T10:00:00Z")],
      document_deliveries: [inv("p1", "d1"), inv("p2", "d2")],
      procurement_documents: [doc("p1", null), doc("p2", 80)],
    });
    expect(day(m, "2026-03-04").procurement_spend).toBeNull();
    expect(day(m, "2026-03-04").procurement_spend_unread).toMatch(/no invoice total/);
    expect(day(m, "2026-03-04").scanned_deliveries).toEqual({ counted: 1, uncosted: 1, notInHouseCurrency: {} });
    expect(day(m, "2026-03-06").procurement_spend).toBe(80);
    expect(m.monthly_procurement_spend).toBeNull();
    expect(m.monthly_procurement_spend_unread).toMatch(/1 scanned delivery with no order has no invoice total/);
    expect(m.monthly_scanned_deliveries.uncosted).toBe(1);
  });

  it("a paper in other money withholds the month and names the code", async () => {
    const m: any = await month({
      deliveries: [d("d1", "2026-03-04T10:00:00Z")],
      document_deliveries: [inv("p1", "d1")],
      procurement_documents: [doc("p1", 90, "EUR")],
    });
    expect(m.monthly_procurement_spend).toBeNull();
    expect(m.monthly_scanned_deliveries.notInHouseCurrency).toEqual({ EUR: 1 });
    expect(m.monthly_procurement_spend_unread).toMatch(/1 in EUR/);
  });

  it("a papers read that fails withholds every day and the month, never reads as no papers", async () => {
    const m: any = await month({ deliveries: [d("d1", "2026-03-04T10:00:00Z")] }, { document_deliveries: "down" });
    expect(m.monthly_procurement_spend).toBeNull();
    expect(m.monthly_procurement_spend_unread).toMatch(/scanned papers .* could not be read/);
    expect(m.daily.every((x: any) => x.procurement_spend === null)).toBe(true);
  });

  it("a delivered order and a scanned delivery on one day add up", async () => {
    const m: any = await month({
      procurement_orders: [{ id: "o1", total_cost: 100, currency: "TRY", delivered_at: "2026-03-04T12:00:00Z", bottles_total: 6 }],
      deliveries: [d("d1", "2026-03-04T10:00:00Z")],
      document_deliveries: [inv("p1", "d1")],
      procurement_documents: [doc("p1", 40)],
    });
    expect(day(m, "2026-03-04").procurement_spend).toBe(140);
    expect(day(m, "2026-03-04").order_count).toBe(1);
    expect(m.monthly_procurement_spend).toBe(140);
  });
});
