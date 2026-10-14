import { BadRequestException } from "@nestjs/common";
import { VendorSpendService } from "./vendor-spend.service";

/**
 * F-1608 (sim 52, owner-year-and-accountant finding 5): there was no spend by
 * vendor for any period. Every case below failed on a build without
 * `vendor-spend.service.ts`.
 */

type Op = { m: string; a: unknown[] };
type Answer = { data: unknown; error: unknown; count?: number | null };

/** A supabase-js stand-in: records each chain and answers it by table. */
function fakeDb(tables: Record<string, unknown[] | Record<string, unknown>>) {
  const calls: Array<{ table: string; ops: Op[] }> = [];
  const from = (table: string) => {
    const ops: Op[] = [];
    calls.push({ table, ops });
    const answer = (): Promise<Answer> => {
      const rows = tables[table];
      if (!Array.isArray(rows))
        return Promise.resolve({ data: rows ?? null, error: null });
      // Paged reads (`readWholeWindow`) come back on page 2 with nothing left.
      const paged = ops.some((o) => o.m === "gt");
      const data = paged ? [] : rows;
      return Promise.resolve({ data, error: null, count: data.length });
    };
    const chain: any = new Proxy(
      {},
      {
        get(_t, m: string) {
          if (m === "then")
            return (res: any, rej: any) => answer().then(res, rej);
          if (m === "maybeSingle" || m === "single")
            return () => {
              ops.push({ m, a: [] });
              return answer();
            };
          return (...a: unknown[]) => {
            ops.push({ m, a });
            return chain;
          };
        },
      },
    );
    return chain;
  };
  return { db: { from }, calls };
}

const HOUSE = "11111111-1111-4111-8111-111111111111";
const ROSSI = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const KAYA = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

const house = {
  name: "Meyhouse",
  currency: "TRY",
  timezone: "Europe/Istanbul",
  country: "TR",
};

function service(tables: Record<string, unknown[] | Record<string, unknown>>) {
  const { db, calls } = fakeDb({
    restaurants: house,
    providers: [],
    ...tables,
  });
  return { svc: new VendorSpendService({ supabase: db } as any), calls };
}

describe("VendorSpendService (F-1608)", () => {
  it("totals what each vendor delivered and invoiced in the period, in the house's money", async () => {
    const { svc, calls } = service({
      procurement_orders: [
        { id: "o1", provider_id: ROSSI, total_cost: 1000, currency: "TRY" },
        { id: "o2", provider_id: ROSSI, total_cost: 500, currency: null },
        { id: "o3", provider_id: KAYA, total_cost: 0, currency: "TRY" },
        { id: "o4", provider_id: KAYA, total_cost: 2400, currency: "TRY" },
      ],
      procurement_documents: [
        {
          id: "d1",
          provider_id: ROSSI,
          doc_type: "invoice",
          doc_number: "A-1",
          status: "verified",
          total: 1180,
          currency: "TRY",
        },
        {
          id: "d2",
          provider_id: ROSSI,
          doc_type: "credit_memo",
          doc_number: "C-1",
          status: "verified",
          total: -80,
          currency: "TRY",
        },
        {
          id: "d3",
          provider_id: KAYA,
          doc_type: "invoice",
          doc_number: "K-9",
          status: "rejected",
          total: 9999,
          currency: "TRY",
        },
      ],
      providers: [
        { id: ROSSI, name: "Rossi Wines" },
        { id: KAYA, name: "Kaya Şarap" },
      ],
    });
    const out = await svc.read(HOUSE, "2026-01-01", "2026-12-31");

    expect(out.currency).toBe("TRY");
    expect(out.vendors.map((v) => v.name)).toEqual([
      "Kaya Şarap",
      "Rossi Wines",
    ]);
    const rossi = out.vendors.find((v) => v.providerId === ROSSI)!;
    // An order naming no money is the house's (F-1052).
    expect(rossi.received).toEqual([{ currency: "TRY", total: 1500 }]);
    expect(rossi.receivedOrders).toBe(2);
    expect(rossi.invoiced).toEqual([{ currency: "TRY", total: 1180 }]);
    // A credit note is its own column, never taken off.
    expect(rossi.credited).toEqual([{ currency: "TRY", total: 80 }]);
    const kaya = out.vendors.find((v) => v.providerId === KAYA)!;
    // An unpriced order is counted, never summed as 0 (F-701).
    expect(kaya.unpricedOrders).toBe(1);
    expect(kaya.received).toEqual([{ currency: "TRY", total: 2400 }]);
    // Rejected paper is not the bill.
    expect(kaya.invoices).toBe(0);
    expect(out.totals.received).toEqual([{ currency: "TRY", total: 3900 }]);

    // Delivered orders on the house's days: Istanbul midnight is 21:00 UTC.
    const orders = calls.find((c) => c.table === "procurement_orders")!.ops;
    expect(orders).toContainEqual({ m: "eq", a: ["restaurant_id", HOUSE] });
    expect(orders).toContainEqual({
      m: "gte",
      a: ["delivered_at", "2025-12-31T21:00:00.000Z"],
    });
    expect(orders).toContainEqual({
      m: "lt",
      a: ["delivered_at", "2026-12-31T21:00:00.000Z"],
    });
    // The month close's statuses, as the enum writes them.
    expect(orders).toContainEqual({
      m: "in",
      a: ["status", ["DELIVERED", "COMPLETED"]],
    });
    const paper = calls.find((c) => c.table === "procurement_documents")!.ops;
    expect(paper).toContainEqual({ m: "eq", a: ["restaurant_id", HOUSE] });
    expect(paper).toContainEqual({ m: "gte", a: ["doc_date", "2026-01-01"] });
    expect(paper).toContainEqual({ m: "lte", a: ["doc_date", "2026-12-31"] });
    const names = calls.find((c) => c.table === "providers")!.ops;
    expect(names).toContainEqual({ m: "eq", a: ["restaurant_id", HOUSE] });
  });

  it("keeps another currency in its own code and never adds it to the house's money", async () => {
    const { svc } = service({
      procurement_orders: [
        { id: "o1", provider_id: ROSSI, total_cost: 1000, currency: "TRY" },
        { id: "o2", provider_id: ROSSI, total_cost: 300, currency: "EUR" },
      ],
      procurement_documents: [],
      providers: [{ id: ROSSI, name: "Rossi Wines" }],
    });
    const out = await svc.read(HOUSE, "2026-03-01", "2026-03-31");
    expect(out.vendors[0].received).toEqual([
      { currency: "TRY", total: 1000 },
      { currency: "EUR", total: 300 },
    ]);
  });

  it("counts the same invoice number from one vendor once, keeping the verified copy", async () => {
    const { svc } = service({
      procurement_orders: [],
      procurement_documents: [
        {
          id: "d1",
          provider_id: ROSSI,
          doc_type: "invoice",
          doc_number: "A-1",
          status: "needs_review",
          total: 1200,
          currency: "EUR",
          created_at: "2026-03-05T10:00:00Z",
        },
        {
          id: "d2",
          provider_id: ROSSI,
          doc_type: "invoice",
          doc_number: "a-1 ",
          status: "verified",
          total: 1180,
          currency: "EUR",
          created_at: "2026-03-04T10:00:00Z",
        },
        {
          id: "d3",
          provider_id: ROSSI,
          doc_type: "invoice",
          doc_number: "A-2",
          status: "extracting",
          total: null,
          currency: "EUR",
        },
      ],
      providers: [{ id: ROSSI, name: "Rossi Wines" }],
    });
    const out = await svc.read(HOUSE, "2026-03-01", "2026-03-31");
    expect(out.duplicatePaper).toBe(1);
    expect(out.vendors[0].invoices).toBe(2);
    expect(out.vendors[0].invoiced).toEqual([{ currency: "EUR", total: 1180 }]);
    // Paper with no total yet is counted and said, not summed as 0.
    expect(out.vendors[0].paperWithoutTotal).toBe(1);
    expect(out.unverifiedPaper).toBe(1);
  });

  it("refuses a period it cannot cut, in plain words", async () => {
    const { svc } = service({
      procurement_orders: [],
      procurement_documents: [],
    });
    await expect(svc.read(HOUSE, "2026-02-30", "2026-03-31")).rejects.toThrow(
      BadRequestException,
    );
    await expect(svc.read(HOUSE, "2026-04-01", "2026-03-31")).rejects.toThrow(
      "starts after it ends",
    );
    await expect(svc.read(HOUSE, "2020-01-01", "2026-03-31")).rejects.toThrow(
      "three years",
    );
    const { svc: zoneless } = service({
      restaurants: { ...house, timezone: null, country: null },
      procurement_orders: [],
      procurement_documents: [],
    });
    await expect(
      zoneless.read(HOUSE, "2026-03-01", "2026-03-31"),
    ).rejects.toThrow("time zone isn't set");
  });

  it("writes the file with the house, the period, the money and the basis", async () => {
    const { svc } = service({
      procurement_orders: [
        { id: "o1", provider_id: ROSSI, total_cost: 1000.5, currency: "TRY" },
        { id: "o2", provider_id: KAYA, total_cost: 300, currency: "EUR" },
        { id: "o3", provider_id: null, total_cost: 0, currency: null },
      ],
      procurement_documents: [],
      providers: [
        { id: ROSSI, name: "Rossi Wines" },
        { id: KAYA, name: "Kaya Şarap" },
      ],
    });
    const file = await svc.csv(HOUSE, "2026-01-01", "2026-12-31");
    // Named for its house (F-1631).
    expect(file.filename).toBe(
      "mudavym-meyhouse-spend-by-vendor-2026-01-01-to-2026-12-31.csv",
    );
    const csv = file.body;
    expect(csv).toContain("Meyhouse");
    expect(csv).toContain("Spend by vendor");
    expect(csv).toContain(
      "2026-01-01 to 2026-12-31, both days included, on the house's own days",
    );
    expect(csv).toContain("TRY, the house's reporting currency");
    // A lira house reads decimals with a comma, so cells part with ";" (F-907).
    expect(csv).toMatch(/Rossi Wines;1000,5;1;0/);
    // The euro vendor is not a bare number under the lira header (F-1145).
    expect(csv).toMatch(/Kaya Şarap;withheld/);
    expect(csv).toContain("300 EUR: not the house's money");
    expect(csv).toMatch(/No vendor named;0;0;1/);
    expect(csv).toContain("1 delivered order carries no price");
    expect(csv).toContain(
      "Received and Invoiced are two views of the same buying",
    );
  });
});
