/**
 * F-160, the founder's ruling RECEIPTS-W53 ("Count paper owed (Recommended)"):
 * the checked deliveries with no invoice filed, under the rule the price
 * provenance already uses (an invoice LINKED to the order, rejected and
 * superseded left out).
 *
 * Real: ReceivingService.paperOwed and `readPaperOwed`. The store is an
 * in-memory fake that APPLIES every filter it is given (eq, in, not, range,
 * limit), so a read that forgot its house returns rows it should not, and a
 * read that forgot a filter counts rows it should not.
 */
import { ReceivingService } from "./receiving.service";
import {
  PAPER_OWED_LIST_MAX,
  PAPER_OWED_ORDER_CEILING,
  ordersOwingPaper,
} from "./paper-owed";

type Row = Record<string, any>;
const REST = "rest-1";
const OTHER = "rest-2";

function fakeDb(tables: Record<string, Row[]>, errors: Record<string, string> = {}) {
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let lim = Infinity;
    let from_ = 0;
    let to_ = Infinity;
    const q: any = {
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push((r) => r[c] === v), q),
      in: (c: string, vs: unknown[]) => (filters.push((r) => vs.includes(r[c])), q),
      not: (c: string, op: string, v: unknown) => (
        filters.push((r) => (op === "is" ? (r[c] ?? null) !== v : r[c] !== v)), q
      ),
      order: () => q,
      limit: (n: number) => ((lim = n), q),
      range: (a: number, b: number) => ((from_ = a), (to_ = b), q),
      then: (resolve: (v: any) => void) => {
        if (errors[table]) return resolve({ data: null, error: { message: errors[table] } });
        const rows = (tables[table] ?? []).filter((r) => filters.every((f) => f(r)));
        return resolve({ data: rows.slice(from_, Math.min(to_ + 1, from_ + lim)), error: null });
      },
    };
    return q;
  };
  return { getClient: () => ({ from }) } as any;
}

const order = (id: string, over: Row = {}): Row => ({
  id,
  restaurant_id: REST,
  order_number: `ORD-${id}`,
  provider_id: "prov-1",
  status: "COMPLETED",
  delivered_at: "2026-07-06T09:00:00.000Z",
  match_verified_at: "2026-07-07T10:00:00.000Z",
  ...over,
});
const link = (orderId: string, documentId: string, restaurant_id = REST): Row => ({
  order_id: orderId,
  document_id: documentId,
  restaurant_id,
});
const document = (id: string, doc_type: string, status: string | null, restaurant_id = REST): Row => ({
  id,
  doc_type,
  status,
  restaurant_id,
});

const svc = (tables: Record<string, Row[]>, errors: Record<string, string> = {}) =>
  new ReceivingService(fakeDb({ providers: [{ id: "prov-1", name: "Bodega Álvaro" }], ...tables }, errors));

describe("checked deliveries with no invoice filed (F-160, RECEIPTS-W53)", () => {
  it("counts the checked orders with no live invoice linked, and names them oldest first", async () => {
    const out = await svc({
      procurement_orders: [
        order("a", { delivered_at: "2026-07-20T09:00:00.000Z", match_verified_at: "2026-07-21T09:00:00.000Z" }),
        order("b", { delivered_at: "2026-07-06T09:00:00.000Z" }),
        // Has its invoice: not owed.
        order("c"),
        // Checked and left open awaiting the invoice: owed.
        order("d", { status: "PARTIALLY_RECEIVED", delivered_at: null, match_verified_at: "2026-07-10T09:00:00.000Z" }),
      ],
      procurement_document_links: [link("c", "inv-c")],
      procurement_documents: [document("inv-c", "invoice", "verified")],
    }).paperOwed(REST);

    expect(out.count).toBe(3);
    expect(out.complete).toBe(true);
    expect(out.checkedRead).toBe(4);
    expect(out.oldestAt).toBe("2026-07-06T09:00:00.000Z");
    expect(out.items.map((i) => i.orderId)).toEqual(["b", "d", "a"]);
    expect(out.items[0]).toEqual({
      orderId: "b",
      orderNumber: "ORD-b",
      vendorName: "Bodega Álvaro",
      deliveredAt: "2026-07-06T09:00:00.000Z",
      checkedAt: "2026-07-07T10:00:00.000Z",
    });
    expect(out.vendorNamesUnavailable).toBe(false);
  });

  it("does not count an order that was never checked: a door count alone, or an order still open", async () => {
    const out = await svc({
      procurement_orders: [
        // The door leaves PARTIALLY_RECEIVED with no match_verified_at.
        order("door", { status: "PARTIALLY_RECEIVED", match_verified_at: null }),
        order("open", { status: "CONFIRMED", match_verified_at: null }),
        // A later truck moved it back to DELIVERED: out until checked again.
        order("again", { status: "DELIVERED" }),
        order("cancelled", { status: "CANCELLED" }),
      ],
    }).paperOwed(REST);
    expect(out.count).toBe(0);
    expect(out.checkedRead).toBe(0);
    expect(out.oldestAt).toBeNull();
    expect(out.items).toEqual([]);
  });

  it("counts only invoices as paper: a packing slip or a credit memo linked to the order leaves it owed", async () => {
    const out = await svc({
      procurement_orders: [order("slip"), order("memo"), order("inv")],
      procurement_document_links: [link("slip", "d-slip"), link("memo", "d-memo"), link("inv", "d-inv")],
      procurement_documents: [
        document("d-slip", "packing_slip", "verified"),
        document("d-memo", "credit_memo", "verified"),
        document("d-inv", "invoice", "needs_review"),
      ],
    }).paperOwed(REST);
    expect(out.items.map((i) => i.orderId).sort()).toEqual(["memo", "slip"]);
    expect(out.count).toBe(2);
  });

  it("leaves a rejected or superseded invoice out, so its order still owes paper", async () => {
    const out = await svc({
      procurement_orders: [order("rej"), order("sup"), order("live")],
      procurement_document_links: [link("rej", "d-rej"), link("sup", "d-sup"), link("live", "d-live")],
      procurement_documents: [
        document("d-rej", "invoice", "rejected"),
        document("d-sup", "invoice", "superseded"),
        document("d-live", "invoice", "received"),
      ],
    }).paperOwed(REST);
    expect(out.items.map((i) => i.orderId).sort()).toEqual(["rej", "sup"]);
  });

  it("reads this house only: another house's orders, links and invoices count for nothing here", async () => {
    const out = await svc({
      procurement_orders: [
        order("mine"),
        // Another house's checked order with no invoice: not ours to count.
        order("theirs", { restaurant_id: OTHER }),
      ],
      // Another house's link and invoice naming OUR order are not our paper.
      procurement_document_links: [link("mine", "d-x", OTHER)],
      procurement_documents: [document("d-x", "invoice", "verified", OTHER)],
    }).paperOwed(REST);
    expect(out.count).toBe(1);
    expect(out.items.map((i) => i.orderId)).toEqual(["mine"]);
  });

  // Each house filter alone, so neither read's filter can hide the other's loss.
  it("does not take another house's link as this order's paper, even to a live invoice of ours", async () => {
    const out = await svc({
      procurement_orders: [order("mine")],
      procurement_document_links: [link("mine", "d-ours", OTHER)],
      procurement_documents: [document("d-ours", "invoice", "verified")],
    }).paperOwed(REST);
    expect(out.items.map((i) => i.orderId)).toEqual(["mine"]);
  });

  it("does not take another house's invoice as this order's paper, even through a link of ours", async () => {
    const out = await svc({
      procurement_orders: [order("mine")],
      procurement_document_links: [link("mine", "d-theirs")],
      procurement_documents: [document("d-theirs", "invoice", "verified", OTHER)],
    }).paperOwed(REST);
    expect(out.items.map((i) => i.orderId)).toEqual(["mine"]);
  });

  it("says the count is a floor when the checked orders reach the ceiling", async () => {
    const many = Array.from({ length: PAPER_OWED_ORDER_CEILING + 5 }, (_, n) =>
      order(`o${String(n).padStart(5, "0")}`),
    );
    const out = await svc({ procurement_orders: many }).paperOwed(REST);
    expect(out.complete).toBe(false);
    expect(out.checkedRead).toBe(PAPER_OWED_ORDER_CEILING);
    expect(out.count).toBe(PAPER_OWED_ORDER_CEILING);
    // The list is cut; the count is not.
    expect(out.items).toHaveLength(PAPER_OWED_LIST_MAX);
  });

  it("is complete below the ceiling, however long the list it cuts", async () => {
    const some = Array.from({ length: PAPER_OWED_LIST_MAX + 7 }, (_, n) => order(`p${n}`));
    const out = await svc({ procurement_orders: some }).paperOwed(REST);
    expect(out.complete).toBe(true);
    expect(out.count).toBe(PAPER_OWED_LIST_MAX + 7);
    expect(out.items).toHaveLength(PAPER_OWED_LIST_MAX);
  });

  it.each([
    ["procurement_orders", /checked deliveries could not be read/],
    ["procurement_document_links", /documents linked to the checked deliveries could not be read/],
    ["procurement_documents", /checked deliveries' documents could not be read/],
  ])("a failed read of %s is a failure, never a zero", async (table, message) => {
    await expect(
      svc(
        {
          procurement_orders: [order("x")],
          procurement_document_links: [link("x", "d-x")],
          procurement_documents: [document("d-x", "invoice", "verified")],
        },
        { [table]: "boom" },
      ).paperOwed(REST),
    ).rejects.toThrow(message);
  });

  it("refuses a page of links that came back full rather than count orders it may have papered", async () => {
    const links = Array.from({ length: 1000 }, (_, n) => link("x", `d${n}`));
    await expect(
      svc({ procurement_orders: [order("x")], procurement_document_links: links }).paperOwed(REST),
    ).rejects.toThrow(/could not be read whole/);
  });

  it("names a failed vendor read instead of failing the count", async () => {
    const out = await svc({ procurement_orders: [order("x")] }, { providers: "boom" }).paperOwed(REST);
    expect(out.count).toBe(1);
    expect(out.vendorNamesUnavailable).toBe(true);
    expect(out.items[0].vendorName).toBeNull();
  });
});

describe("ordersOwingPaper (pure)", () => {
  it("sorts an unreadable date last, never as the oldest debt", () => {
    const rows = ordersOwingPaper({
      orders: [
        { id: "bad", order_number: null, provider_id: null, delivered_at: "not a date", match_verified_at: "x" },
        { id: "ok", order_number: null, provider_id: null, delivered_at: null, match_verified_at: "2026-07-06T00:00:00.000Z" },
      ],
      links: [],
      documents: [],
    });
    expect(rows.map((r) => r.id)).toEqual(["ok", "bad"]);
  });
});
