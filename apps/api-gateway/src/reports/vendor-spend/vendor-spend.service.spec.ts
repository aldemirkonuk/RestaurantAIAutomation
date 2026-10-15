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
      const raw = tables[table];
      if (!Array.isArray(raw))
        return Promise.resolve({ data: raw ?? null, error: null });
      // The paper's `effective_*` columns, as the database generates them
      // (F-1690): the corrected value a fixture names, else the one as read.
      const rows =
        table === "procurement_documents"
          ? raw.map((row: any) => ({
              ...row,
              effective_total: row.effective_total ?? row.total ?? null,
              effective_doc_date:
                row.effective_doc_date ?? row.doc_date ?? null,
              effective_doc_number:
                row.effective_doc_number ?? row.doc_number ?? null,
              effective_currency:
                row.effective_currency ?? row.currency ?? null,
            }))
          : raw;
      // Paged reads (`readWholeWindow`) come back on page 2 with nothing left.
      const paged = ops.some((o) => o.m === "gt");
      // `eq` and `is` filter a row only on a key the row carries.
      // `gte` / `lte` / `lt` cut a dated row the same way (F-1643: a period
      // read must not see an invoice dated outside it).
      const kept = rows.filter((row: any) =>
        ops.every((o) => {
          const k = String(o.a[0]);
          if (!(k in row)) return true;
          const v = row[k] ?? null;
          if (o.m === "eq" || o.m === "is") return v === o.a[1];
          if (v === null || typeof v !== "string") return true;
          if (o.m === "gte") return v >= String(o.a[1]);
          if (o.m === "lte") return v <= String(o.a[1]);
          if (o.m === "lt") return v < String(o.a[1]);
          return true;
        }),
      );
      // A select's `name:column` hands the column back under the name.
      const select = ops.find((o) => o.m === "select");
      const renames = String(select?.a[0] ?? "")
        .split(",")
        .map((p) => p.trim().split(":"))
        .filter((p) => p.length === 2);
      const shown = kept.map((row: any) => {
        const out = { ...row };
        for (const [name, column] of renames)
          if (column in row) out[name] = row[column];
        return out;
      });
      const data = paged ? [] : shown;
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
    procurement_invoice_payments: [],
    procurement_credit_taken_on_invoice: [],
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
    expect(paper).toContainEqual({
      m: "gte",
      a: ["effective_doc_date", "2026-01-01"],
    });
    expect(paper).toContainEqual({
      m: "lte",
      a: ["effective_doc_date", "2026-12-31"],
    });
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

/**
 * F-1672 / F-1673 / F-1674 (sim 55, buying-week findings 1-3). Every
 * [REVERT-FAILS] case failed on a build that ignored the payments kept on an
 * invoice (a used credit note came off Owed again; a part payment left the
 * whole bill owed, or none of it; a back-dated marking moved owedSince) or
 * that added every vendor's Owed together, credits of one against another.
 */
describe("VendorSpendService — each payment, and credit kept to its vendor (F-1672..F-1674)", () => {
  const inv = (over: Record<string, unknown>) => ({
    provider_id: ROSSI,
    doc_type: "invoice",
    status: "verified",
    currency: "TRY",
    paid_at: null,
    paid_by: null,
    ...over,
  });
  let payId = 0;
  const pay = (over: Record<string, unknown>) => ({
    id: `pay-${++payId}`,
    credit_note_id: null,
    recorded_at: "2026-03-10T09:00:00Z",
    ...over,
  });

  it("[REVERT-FAILS] a credit note that paid an invoice is not taken off what the vendor is still owed (F-1672)", async () => {
    const { svc } = service({
      procurement_orders: [],
      procurement_documents: [
        // INV-905, 10.000, paid with CN-88's 1.200 and 8.800 by the house.
        inv({
          id: "i905",
          doc_number: "INV-905",
          doc_date: "2026-03-08",
          total: 10000,
          paid_at: "2026-03-10T09:00:00Z",
          paid_by: "restaurant",
        }),
        inv({
          id: "cn88",
          doc_type: "credit_memo",
          doc_number: "CN-88",
          doc_date: "2026-03-11",
          total: -1200,
        }),
        inv({
          id: "i906",
          doc_number: "INV-906",
          doc_date: "2026-03-12",
          total: 5000,
        }),
      ],
      procurement_invoice_payments: [
        pay({ invoice_id: "i905", amount: 1200, credit_note_id: "cn88" }),
        pay({ invoice_id: "i905", amount: 8800 }),
      ],
      providers: [{ id: ROSSI, name: "Rossi Wines" }],
    });
    const out = await svc.read(HOUSE, "2026-03-01", "2026-03-31");
    expect(out.owedSince).toBe("2026-03-10");
    const rossi = out.owing.find((o) => o.providerId === ROSSI)!;
    expect(rossi.owed).toEqual([{ currency: "TRY", total: 5000 }]);
    expect(rossi.owedCreditNotes).toBe(0);
    expect(out.basis.join(" ")).not.toContain(
      "A credit already used to pay an invoice is not taken off again",
    );
    expect(out.basis.join(" ")).toContain(
      "A credit note comes off only by what it has not paid yet",
    );
  });

  it("[REVERT-FAILS] a part payment leaves what is left owed; a back-dated one does not move owedSince (F-1674)", async () => {
    const { svc } = service({
      procurement_orders: [],
      procurement_documents: [
        // Paid in full, recorded 10 March, back-dated to 1 March.
        inv({
          id: "p1",
          doc_number: "A-1",
          doc_date: "2026-02-25",
          total: 500,
          paid_at: "2026-03-01T09:00:00Z",
          paid_by: "restaurant",
        }),
        // Dated before the first recorded marking: not marked, never owed.
        inv({
          id: "o1",
          doc_number: "A-0",
          doc_date: "2026-03-05",
          total: 900,
        }),
        // Paid 4.000 of 10.000 in a first instalment.
        inv({
          id: "v1",
          doc_number: "A-2",
          doc_date: "2026-03-12",
          total: 10000,
        }),
      ],
      procurement_invoice_payments: [
        pay({ invoice_id: "p1", amount: 500 }),
        pay({
          invoice_id: "v1",
          amount: 4000,
          recorded_at: "2026-03-14T09:00:00Z",
        }),
      ],
      providers: [{ id: ROSSI, name: "Rossi Wines" }],
    });
    const out = await svc.read(HOUSE, "2026-03-01", "2026-03-31");
    expect(out.owedSince).toBe("2026-03-10");
    const rossi = out.owing.find((o) => o.providerId === ROSSI)!;
    expect(rossi.owed).toEqual([{ currency: "TRY", total: 6000 }]);
    expect(rossi.owedInvoices).toBe(1);
    expect(rossi.unpaid).toEqual([{ currency: "TRY", total: 900 }]);
  });

  it("[REVERT-FAILS] a corrected total, date, number and currency are what Invoiced and Owed read (F-1690)", async () => {
    const { svc, calls } = service({
      procurement_orders: [],
      procurement_documents: [
        // Marked paid in March: Owed counts from then.
        inv({
          id: "p1",
          doc_number: "A-1",
          doc_date: "2026-03-01",
          total: 100,
          paid_at: "2026-03-01T09:00:00Z",
          paid_by: "restaurant",
        }),
        // 1.234,56 read as 123.456 and 31 Mar read as 3 Apr, both corrected;
        // 500 was paid against it before the correction.
        inv({
          id: "m1",
          doc_number: "A-2O",
          doc_date: "2026-04-03",
          total: 123456,
          effective_doc_number: "A-20",
          effective_doc_date: "2026-03-31",
          effective_total: 1234.56,
        }),
        // Read as TRY, corrected to EUR: its money stays in its own code.
        inv({
          id: "e1",
          doc_number: "A-21",
          doc_date: "2026-03-20",
          total: 80,
          effective_currency: "EUR",
        }),
      ],
      procurement_invoice_payments: [
        pay({ invoice_id: "p1", amount: 100 }),
        pay({ invoice_id: "m1", amount: 500 }),
      ],
      providers: [{ id: ROSSI, name: "Rossi Wines" }],
    });
    const march = await svc.read(HOUSE, "2026-03-01", "2026-03-31");
    const rossi = march.vendors.find((v) => v.providerId === ROSSI)!;
    expect(rossi.invoiced).toEqual([
      { currency: "TRY", total: 1334.56 },
      { currency: "EUR", total: 80 },
    ]);
    const owing = march.owing.find((o) => o.providerId === ROSSI)!;
    expect(owing.owed).toEqual([
      { currency: "TRY", total: 734.56 },
      { currency: "EUR", total: 80 },
    ]);
    // The period is cut on the corrected day, in the database.
    const period = calls.find(
      (c) =>
        c.table === "procurement_documents" && c.ops.some((o) => o.m === "gte"),
    )!;
    expect(period.ops).toContainEqual({
      m: "gte",
      a: ["effective_doc_date", "2026-03-01"],
    });
    const april = await svc.read(HOUSE, "2026-04-01", "2026-04-30");
    expect(april.vendors.find((v) => v.providerId === ROSSI)).toBeUndefined();
  });

  it("[REVERT-FAILS] one vendor's credit is never taken off another vendor's bills, and is said apart (F-1673)", async () => {
    const { svc } = service({
      procurement_orders: [],
      procurement_documents: [
        inv({
          id: "p1",
          doc_number: "A-1",
          doc_date: "2026-03-01",
          total: 500,
          paid_at: "2026-03-10T09:00:00Z",
          paid_by: "restaurant",
        }),
        inv({
          id: "a2",
          doc_number: "A-2",
          doc_date: "2026-03-12",
          total: 10000,
        }),
        inv({
          id: "k1",
          provider_id: KAYA,
          doc_type: "credit_memo",
          doc_number: "K-C1",
          doc_date: "2026-03-13",
          total: -3000,
        }),
      ],
      providers: [
        { id: ROSSI, name: "Rossi Wines" },
        { id: KAYA, name: "Kaya Gida" },
      ],
    });
    const out = await svc.read(HOUSE, "2026-03-01", "2026-03-31");
    expect(out.owing.find((o) => o.providerId === KAYA)!.owed).toEqual([
      { currency: "TRY", total: -3000 },
    ]);
    expect(out.totals.owed).toEqual([{ currency: "TRY", total: 10000 }]);
    expect(out.totals.inFavour).toEqual([{ currency: "TRY", total: 3000 }]);
    const figures = spendDoc(out).figures;
    expect(figures.find((f) => f.label === "Owed, all vendors")!.value).toBe(
      10000,
    );
    expect(
      figures.find((f) => f.label === "Credit in your favour, all vendors")!
        .value,
    ).toBe(3000);
  });

  it("[REVERT-FAILS] a no-total invoice marked paid on a back-dated day dates Owed from when it was recorded (F-1706)", async () => {
    const { svc } = service({
      procurement_orders: [],
      procurement_documents: [
        // No total; marked paid on 10 March, back-dated to 1 December.
        inv({
          id: "nt",
          doc_number: "N-1",
          doc_date: "2025-11-20",
          total: null,
          paid_at: "2025-12-01T09:00:00Z",
          paid_marked_at: "2026-03-10T09:00:00Z",
          paid_by: "restaurant",
        }),
        // January paper nobody marked: from before any marking was recorded.
        inv({
          id: "jan",
          doc_number: "N-2",
          doc_date: "2026-01-15",
          total: 700,
        }),
      ],
      providers: [{ id: ROSSI, name: "Rossi Wines" }],
    });
    const out = await svc.read(HOUSE, "2026-03-01", "2026-03-31");
    expect(out.owedSince).toBe("2026-03-10");
    const rossi = out.owing.find((o) => o.providerId === ROSSI)!;
    expect(rossi.owed).toEqual([]);
    expect(rossi.unpaid).toEqual([{ currency: "TRY", total: 700 }]);
  });

  it("[REVERT-FAILS] payments on two copies of one invoice cover the one bill, never past it (F-1720)", async () => {
    const { svc } = service({
      procurement_orders: [],
      procurement_documents: [
        inv({
          id: "c1",
          doc_number: "B-7",
          doc_date: "2026-03-12",
          total: 1000,
          created_at: "2026-03-12T09:00:00Z",
        }),
        inv({
          id: "c2",
          doc_number: "b-7 ",
          doc_date: "2026-03-12",
          status: "received",
          total: 1000,
          created_at: "2026-03-13T09:00:00Z",
        }),
        inv({
          id: "d1",
          doc_number: "B-8",
          doc_date: "2026-03-14",
          total: 400,
        }),
      ],
      // Paid per copy before the bill was one bill: 1.200 on a 1.000 bill.
      procurement_invoice_payments: [
        pay({ invoice_id: "c1", amount: 600 }),
        pay({ invoice_id: "c2", amount: 600 }),
      ],
      providers: [{ id: ROSSI, name: "Rossi Wines" }],
    });
    const out = await svc.read(HOUSE, "2026-03-01", "2026-03-31");
    const rossi = out.owing.find((o) => o.providerId === ROSSI)!;
    expect(rossi.owed).toEqual([{ currency: "TRY", total: 400 }]);
    expect(rossi.owedInvoices).toBe(1);
  });
});

/**
 * Wave 109 (sim-ledger S236/S237, owed after F-1672): a credit the vendor
 * already took off an invoice's printed total, and a credit note older than
 * `owedSince`. [REVERT-FAILS] on the vendor-credit lane's head (d1bdc6d21).
 */
describe("VendorSpendService — credit already taken, and older credit (wave 109)", () => {
  const doc = (over: Record<string, unknown>) => ({
    provider_id: ROSSI,
    doc_type: "invoice",
    status: "verified",
    currency: "TRY",
    paid_at: null,
    paid_by: null,
    ...over,
  });
  const marked = doc({
    id: "p1",
    doc_number: "A-1",
    doc_date: "2026-03-01",
    total: 500,
    paid_at: "2026-03-10T09:00:00Z",
    paid_by: "restaurant",
  });

  it("[REVERT-FAILS] a credit note the vendor already took off INV-905's printed total stops coming off Owed", async () => {
    const tables = {
      procurement_orders: [],
      procurement_documents: [
        marked,
        // Printed at 8.800: CN-88's 1.200 already taken off 10.000.
        doc({
          id: "i905",
          doc_number: "INV-905",
          doc_date: "2026-03-12",
          total: 8800,
        }),
        doc({
          id: "cn88",
          doc_type: "credit_memo",
          doc_number: "CN-88",
          doc_date: "2026-03-11",
          total: -1200,
        }),
      ],
      providers: [{ id: ROSSI, name: "Rossi Wines" }],
    };
    const before = await service(tables).svc.read(
      HOUSE,
      "2026-03-01",
      "2026-03-31",
    );
    // Not said: the credit comes off the 8.800 that already has it off.
    expect(before.owing[0].owed).toEqual([{ currency: "TRY", total: 7600 }]);
    const { svc, calls } = service({
      ...tables,
      procurement_credit_taken_on_invoice: [
        { id: "t1", credit_note_id: "cn88", invoice_id: "i905", amount: 1200 },
      ],
    });
    const out = await svc.read(HOUSE, "2026-03-01", "2026-03-31");
    const rossi = out.owing.find((o) => o.providerId === ROSSI)!;
    expect(rossi.owed).toEqual([{ currency: "TRY", total: 8800 }]);
    expect(rossi.owedCreditNotes).toBe(0);
    const read = calls.find(
      (c) => c.table === "procurement_credit_taken_on_invoice",
    )!;
    expect(read.ops).toContainEqual({ m: "eq", a: ["restaurant_id", HOUSE] });
    expect(out.basis.join(" ")).toContain(
      "credit the vendor already took off an invoice's printed total is used",
    );
  });

  it("[REVERT-FAILS] a credit note dated before owedSince is said beside Owed, never netted", async () => {
    const { svc } = service({
      procurement_orders: [],
      procurement_documents: [
        marked,
        doc({
          id: "a2",
          doc_number: "A-2",
          doc_date: "2026-03-12",
          total: 2000,
        }),
        doc({
          id: "old",
          doc_type: "credit_memo",
          doc_number: "C-OLD",
          doc_date: "2026-02-20",
          total: -300,
        }),
        doc({
          id: "new",
          doc_type: "credit_memo",
          doc_number: "C-NEW",
          doc_date: "2026-03-15",
          total: -100,
        }),
      ],
      providers: [{ id: ROSSI, name: "Rossi Wines" }],
    });
    const out = await svc.read(HOUSE, "2026-03-01", "2026-03-31");
    const rossi = out.owing.find((o) => o.providerId === ROSSI)!;
    expect(rossi.owed).toEqual([{ currency: "TRY", total: 1900 }]);
    expect(rossi.owedCreditNotes).toBe(1);
    expect(rossi.earlyCreditNotes).toBe(1);
    expect(rossi.earlyCredit).toEqual([{ currency: "TRY", total: 300 }]);
    expect(out.basis.join(" ")).toContain(
      "A credit note dated before 2026-03-10 is not taken off Owed",
    );
    expect(spendDoc(out).notes.join(" ")).toContain(
      "Not taken off Owed: Rossi Wines, 1 credit note dated before 2026-03-10 (300 TRY)",
    );
  });

  it("[REVERT-FAILS] a vendor with only an older unused credit note is still listed", async () => {
    const { svc } = service({
      procurement_orders: [],
      procurement_documents: [
        marked,
        doc({
          id: "old",
          provider_id: KAYA,
          doc_type: "credit_memo",
          doc_number: "K-OLD",
          doc_date: "2026-02-20",
          total: -300,
        }),
      ],
      providers: [
        { id: ROSSI, name: "Rossi Wines" },
        { id: KAYA, name: "Kaya Gida" },
      ],
    });
    const out = await svc.read(HOUSE, "2026-04-01", "2026-04-30");
    const kaya = out.owing.find((o) => o.providerId === KAYA)!;
    expect(kaya.earlyCreditNotes).toBe(1);
    expect(kaya.owed).toEqual([]);
  });
});

/**
 * F-1643 (sim 54): Owed and Not marked paid are any date, so before this every
 * vendor with an old unpaid invoice was a row of every period, and the empty
 * period could never say so. [REVERT-FAILS] on a build that adds the any-date
 * ledger to the period's rows.
 */
describe("VendorSpendService — a period lists its own vendors (F-1643)", () => {
  it("[REVERT-FAILS] keeps a vendor with only old unpaid paper off the period, and says it in owing", async () => {
    const { svc } = service({
      procurement_orders: [
        {
          id: "o1",
          provider_id: KAYA,
          status: "delivered",
          total_cost: 400,
          currency: "TRY",
          delivered_at: "2026-03-05T10:00:00Z",
        },
      ],
      procurement_documents: [
        // Rossi: one invoice from last year, never marked paid.
        {
          id: "old",
          provider_id: ROSSI,
          doc_type: "invoice",
          doc_number: "R-1",
          doc_date: "2025-06-01",
          status: "verified",
          total: 900,
          currency: "TRY",
          paid_at: null,
        },
        // Kaya: an invoice in the period, also unmarked.
        {
          id: "k1",
          provider_id: KAYA,
          doc_type: "invoice",
          doc_number: "K-1",
          doc_date: "2026-03-05",
          status: "verified",
          total: 400,
          currency: "TRY",
          paid_at: null,
        },
      ],
      providers: [
        { id: ROSSI, name: "Rossi Wines" },
        { id: KAYA, name: "Kaya Et" },
      ],
    });
    const out = await svc.read(HOUSE, "2026-03-01", "2026-03-31");
    // The period: Kaya only, still carrying its own unmarked line.
    expect(out.vendors.map((v) => v.providerId)).toEqual([KAYA]);
    expect(out.vendors[0].unpaid).toEqual([{ currency: "TRY", total: 400 }]);
    // Any date: both vendors, named, and the total is not cut to the period.
    expect(out.owing.map((v) => [v.name, v.unpaidInvoices])).toEqual([
      ["Rossi Wines", 1],
      ["Kaya Et", 1],
    ]);
    expect(out.totals.unpaid).toEqual([{ currency: "TRY", total: 1300 }]);
    // The file: the period table has Kaya only; the any-date table has both.
    const doc = spendDoc(out);
    expect(doc.tables[0].rows.map((r) => r[0])).toEqual(["Kaya Et"]);
    expect(doc.tables[1].title).toBe("Owed and not marked paid, any date");
    expect(doc.tables[1].rows.map((r) => r[0])).toEqual([
      "Rossi Wines",
      "Kaya Et",
    ]);
  });

  it("[REVERT-FAILS] an empty period says so even with old unpaid paper on file", async () => {
    const { svc } = service({
      procurement_orders: [],
      procurement_documents: [
        {
          id: "old",
          provider_id: ROSSI,
          doc_type: "invoice",
          doc_number: "R-1",
          doc_date: "2025-06-01",
          status: "verified",
          total: 900,
          currency: "TRY",
          paid_at: null,
        },
      ],
      providers: [{ id: ROSSI, name: "Rossi Wines" }],
    });
    const out = await svc.read(HOUSE, "2026-03-01", "2026-03-31");
    expect(out.vendors).toEqual([]);
    expect(out.owing).toHaveLength(1);
    expect(spendDoc(out).say).toBe(
      "No order was delivered and no invoice is dated in this period.",
    );
  });
});
