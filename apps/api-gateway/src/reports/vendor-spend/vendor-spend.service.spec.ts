import { BadRequestException } from "@nestjs/common";
import { VendorSpendService, spendDoc } from "./vendor-spend.service";

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
      // `eq` and `is` filter a row only on a key the row carries.
      const kept = rows.filter((row: any) =>
        ops.every(
          (o) =>
            (o.m !== "eq" && o.m !== "is") ||
            !(String(o.a[0]) in row) ||
            (row[String(o.a[0])] ?? null) === o.a[1],
        ),
      );
      const data = paged ? [] : kept;
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
    // The month close's statuses, plus the still-open deliveries said
    // beside them (F-1632), as the enum writes them.
    expect(orders).toContainEqual({
      m: "in",
      a: ["status", ["DELIVERED", "PARTIALLY_RECEIVED", "COMPLETED"]],
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

  it("[REVERT-FAILS] says a delivery still open beside Received, never silently (F-1632)", async () => {
    const { svc } = service({
      procurement_orders: [
        {
          id: "o1",
          provider_id: ROSSI,
          status: "COMPLETED",
          total_cost: 1000,
          currency: "TRY",
        },
        // 12 ordered, 10 accepted, 2 backordered: delivered, still open.
        {
          id: "o2",
          provider_id: ROSSI,
          status: "PARTIALLY_RECEIVED",
          total_cost: 28800,
          currency: "TRY",
        },
      ],
      procurement_documents: [],
      providers: [{ id: ROSSI, name: "Rossi Wines" }],
    });
    const out = await svc.read(HOUSE, "2026-03-01", "2026-03-31");
    const rossi = out.vendors[0];
    expect(rossi.received).toEqual([{ currency: "TRY", total: 1000 }]);
    expect(rossi.receivedOrders).toBe(1);
    expect(rossi.awaitingOrders).toBe(1);
    expect(rossi.awaiting).toEqual([{ currency: "TRY", total: 28800 }]);
    expect(out.totals.awaiting).toEqual([{ currency: "TRY", total: 28800 }]);
    const csv = (await svc.csv(HOUSE, "2026-03-01", "2026-03-31")).body;
    expect(csv).toContain(
      "1 order was delivered in this period but is still open",
    );
    expect(csv).toContain("Still open, at order total: 28800 TRY");
  });

  it("[REVERT-FAILS] the basis says a checked order's total is without tax (F-1634)", async () => {
    const { svc } = service({
      procurement_orders: [],
      procurement_documents: [],
    });
    const out = await svc.read(HOUSE, "2026-03-01", "2026-03-31");
    const basis = out.basis.join(" ");
    expect(basis).not.toContain("the order's total is the invoiced total");
    expect(basis).toContain("without tax");
    expect(basis).toContain("Received does not include tax, and Invoiced does");
  });

  it("[REVERT-FAILS] totals each vendor's invoices not marked paid, any date, per currency (F-1635)", async () => {
    const { svc, calls } = service({
      procurement_orders: [],
      procurement_documents: [
        {
          id: "d1",
          provider_id: ROSSI,
          doc_type: "invoice",
          doc_number: "A-1",
          status: "verified",
          total: 12000,
          currency: "TRY",
          paid_at: null,
        },
        {
          id: "d2",
          provider_id: ROSSI,
          doc_type: "invoice",
          doc_number: "A-2",
          status: "verified",
          total: 744,
          currency: "EUR",
          paid_at: null,
        },
        {
          id: "d3",
          provider_id: ROSSI,
          doc_type: "invoice",
          doc_number: "A-3",
          status: "verified",
          total: 500,
          currency: "TRY",
          paid_at: "2026-03-10T09:00:00Z",
        },
        {
          id: "d4",
          provider_id: ROSSI,
          doc_type: "credit_memo",
          doc_number: "C-1",
          status: "verified",
          total: -80,
          currency: "TRY",
          paid_at: null,
        },
        {
          id: "d5",
          provider_id: ROSSI,
          doc_type: "invoice",
          doc_number: "A-4",
          status: "rejected",
          total: 999,
          currency: "TRY",
          paid_at: null,
        },
      ],
      providers: [{ id: ROSSI, name: "Rossi Wines" }],
    });
    const out = await svc.read(HOUSE, "2026-03-01", "2026-03-31");
    const rossi = out.vendors[0];
    expect(rossi.unpaid).toEqual([
      { currency: "TRY", total: 12000 },
      { currency: "EUR", total: 744 },
    ]);
    expect(rossi.unpaidInvoices).toBe(2);
    expect(out.totals.unpaid).toEqual([
      { currency: "TRY", total: 12000 },
      { currency: "EUR", total: 744 },
    ]);
    // Any date: the unpaid read is not cut to the period. It reads paid and
    // unpaid alike, so a paid copy of a bill marks the bill paid (F-1635 rest).
    const unpaidRead = calls.filter(
      (c) => c.table === "procurement_documents",
    )[1].ops;
    expect(unpaidRead).toContainEqual({ m: "eq", a: ["restaurant_id", HOUSE] });
    expect(unpaidRead.some((o) => o.m === "gte" || o.m === "lte")).toBe(false);
  });
});

/**
 * F-1635 remainder (S230): what is owed to a vendor, credit notes taken off,
 * and only for invoices dated since the house could mark one paid; older
 * unmarked invoices are "not marked", never owed. Every [REVERT-FAILS] case
 * failed on a build without `owed` / `owedSince`.
 */
describe("VendorSpendService — owed, and not marked (F-1635)", () => {
  const inv = (over: Record<string, unknown>) => ({
    provider_id: ROSSI,
    doc_type: "invoice",
    status: "verified",
    currency: "TRY",
    paid_at: null,
    paid_by: null,
    ...over,
  });

  it("[REVERT-FAILS] calls invoices since the first marking owed, credit notes off, and older ones not marked", async () => {
    const { svc } = service({
      procurement_orders: [],
      procurement_documents: [
        // Marked paid on 10 March (house day): Owed starts then.
        inv({
          id: "p1",
          doc_number: "A-1",
          doc_date: "2026-03-01",
          total: 500,
          paid_at: "2026-03-10T09:00:00Z",
          paid_by: "restaurant",
        }),
        // Before the first marking: not marked, never owed.
        inv({
          id: "o1",
          doc_number: "A-0",
          doc_date: "2026-02-20",
          total: 9000,
        }),
        // Since then, unpaid: owed.
        inv({
          id: "n1",
          doc_number: "A-2",
          doc_date: "2026-03-12",
          total: 1200,
        }),
        inv({
          id: "n2",
          doc_number: "A-3",
          doc_date: "2026-03-20",
          total: 300,
          currency: "EUR",
        }),
        // A credit note since then comes off; one before does not.
        inv({
          id: "c1",
          doc_type: "credit_memo",
          doc_number: "C-1",
          doc_date: "2026-03-15",
          total: -200,
        }),
        inv({
          id: "c0",
          doc_type: "credit_memo",
          doc_number: "C-0",
          doc_date: "2026-02-01",
          total: -50,
        }),
      ],
      providers: [{ id: ROSSI, name: "Rossi Wines" }],
    });
    const out = await svc.read(HOUSE, "2026-03-01", "2026-03-31");
    expect(out.owedSince).toBe("2026-03-10");
    const rossi = out.vendors[0];
    expect(rossi.owed).toEqual([
      { currency: "TRY", total: 1000 },
      { currency: "EUR", total: 300 },
    ]);
    expect(rossi.owedInvoices).toBe(2);
    expect(rossi.owedCreditNotes).toBe(1);
    expect(rossi.unpaid).toEqual([{ currency: "TRY", total: 9000 }]);
    expect(rossi.unpaidInvoices).toBe(1);
    expect(out.totals.owed).toEqual([
      { currency: "TRY", total: 1000 },
      { currency: "EUR", total: 300 },
    ]);
    expect(out.basis.join(" ")).toContain(
      "Owed is every invoice dated from 2026-03-10",
    );
    expect(out.basis.join(" ")).toContain("not what is owed");
  });

  it("[REVERT-FAILS] a house that never marked an invoice paid owes nothing it can name: all are not marked", async () => {
    const { svc } = service({
      procurement_orders: [],
      procurement_documents: [
        inv({
          id: "n1",
          doc_number: "A-2",
          doc_date: "2026-03-12",
          total: 1200,
        }),
      ],
      providers: [{ id: ROSSI, name: "Rossi Wines" }],
    });
    const out = await svc.read(HOUSE, "2026-03-01", "2026-03-31");
    expect(out.owedSince).toBeNull();
    expect(out.vendors[0].owed).toEqual([]);
    expect(out.vendors[0].unpaid).toEqual([{ currency: "TRY", total: 1200 }]);
    expect(out.basis.join(" ")).toContain("Owed is not worked out yet");
    // The file says it is not known, never a zero.
    const doc = spendDoc(out);
    const owedFigure = doc.figures.find(
      (f) => f.label === "Owed, all vendors",
    )!;
    expect(owedFigure.value).not.toBe(0);
  });

  it("[REVERT-FAILS] a bill paid on one copy is paid; a credit spent paying an invoice is not taken off twice", async () => {
    const { svc } = service({
      procurement_orders: [],
      procurement_documents: [
        inv({
          id: "a",
          doc_number: "4411",
          doc_date: "2026-03-11",
          total: 700,
          paid_at: "2026-03-11T09:00:00Z",
          paid_by: "credit_applied",
        }),
        // The emailed copy of 4411, nobody marked it: still the same, paid bill.
        inv({
          id: "b",
          doc_number: "4411",
          doc_date: "2026-03-11",
          total: 700,
          status: "needs_review",
        }),
        inv({
          id: "c",
          doc_type: "credit_memo",
          doc_number: "C-9",
          doc_date: "2026-03-11",
          total: 700,
        }),
        inv({
          id: "d",
          doc_number: "4412",
          doc_date: "2026-03-12",
          total: 250,
        }),
      ],
      providers: [{ id: ROSSI, name: "Rossi Wines" }],
    });
    const out = await svc.read(HOUSE, "2026-03-01", "2026-03-31");
    const rossi = out.vendors[0];
    expect(rossi.owed).toEqual([{ currency: "TRY", total: 250 }]);
    expect(rossi.owedInvoices).toBe(1);
  });
});
