import { ProcurementService } from "./procurement.service";

/**
 * ADR 0081 — the conversation ledger can see its own rows.
 *
 * `/communications` calls itself the one place a manager sees every vendor
 * conversation. MEASURED ON PRODUCTION (`exzueerziesmczwlhomd`, 2026-09-02):
 *
 *     27 conversation rows, 2 restaurants
 *     12 pass the old status allow-list
 *      2 survive `procurement_orders!inner`
 *      2 the old query returned in total
 *
 * The status allow-list was the suspected constraint. It was not the binding
 * one: 25 of 27 rows carry `order_id IS NULL`, so the INNER embed dropped them
 * before the status filter was consulted. Widening the allow-list ALONE moves
 * the count from 2 to 2 — which is why this file models the embed as well as
 * the filters, instead of handing the service a bag of rows and counting what
 * comes back. A fixture that cannot express the join cannot fail on it.
 *
 * The fixture below reproduces the production distribution row for row.
 */

type Row = Record<string, any>;

const REST = "rest-main";
const OTHER = "rest-other";

/** Production's shape: 27 rows, 25 with no order, all inbound bodies in `message_text`. */
function productionShapedRows(): Row[] {
  const rows: Row[] = [];
  const at = (i: number) => new Date(2026, 7, 1 + i).toISOString();

  // 10 inbound vendor replies. `status` is the column DEFAULT 'DRAFT' — the
  // inbound path never sets it — `order_id` is null, and `content` is null on
  // every one of them in production: the body is in `message_text`.
  for (let i = 0; i < 10; i++) {
    rows.push({
      id: `in-${i}`,
      restaurant_id: REST,
      order_id: null,
      provider_id: `prov-${i % 3}`,
      direction: "inbound",
      status: "DRAFT",
      content: null,
      message_text: `Vendor reply number ${i}`,
      created_at: at(i),
      outbound_email_type: null,
      round_count: 0,
    });
  }
  // 10 outbound SENT — 2 of them attached to a purchase order.
  for (let i = 0; i < 10; i++) {
    rows.push({
      id: `sent-${i}`,
      restaurant_id: REST,
      order_id: i < 2 ? `ord-${i}` : null,
      provider_id: "prov-0",
      direction: "outbound",
      status: "SENT",
      content: `Our message ${i}`,
      message_text: `Our message ${i}`,
      created_at: at(10 + i),
      outbound_email_type: "PRICE_INQUIRY",
      round_count: 1,
    });
  }
  for (let i = 0; i < 3; i++) {
    rows.push({
      id: `disc-${i}`,
      restaurant_id: REST,
      order_id: null,
      provider_id: "prov-1",
      direction: "outbound",
      status: "DISCARDED",
      content: `Killed draft ${i}`,
      message_text: `Killed draft ${i}`,
      created_at: at(20 + i),
      outbound_email_type: "COUNTER_OFFER",
      round_count: 1,
    });
  }
  for (let i = 0; i < 2; i++) {
    rows.push({
      id: `appr-${i}`,
      restaurant_id: REST,
      order_id: null,
      provider_id: "prov-2",
      direction: "outbound",
      status: "APPROVED",
      content: `Approved ${i}`,
      message_text: `Approved ${i}`,
      created_at: at(24 + i),
      outbound_email_type: "ORDER_CONFIRMATION",
      round_count: 1,
    });
  }
  rows.push({
    id: "canc-0",
    restaurant_id: REST,
    order_id: null,
    provider_id: "prov-2",
    direction: "outbound",
    status: "CANCELLED",
    content: "Cancelled",
    message_text: "Cancelled",
    created_at: at(26),
    outbound_email_type: "CLARIFICATION",
    round_count: 1,
  });
  // The one row that is genuinely live somewhere else: the approval queue.
  rows.push({
    id: "pend-0",
    restaurant_id: REST,
    order_id: null,
    provider_id: "prov-2",
    direction: "outbound",
    status: "PENDING_APPROVAL",
    content: "Awaiting the manager",
    message_text: "Awaiting the manager",
    created_at: at(27),
    outbound_email_type: "PRICE_INQUIRY",
    round_count: 1,
  });
  return rows;
}

/** The `procurement_orders` rows the embed can resolve. */
const ORDERS: Row[] = [
  { id: "ord-0", order_number: "PO-1", quantity: 6, inventory_id: "inv-0" },
  { id: "ord-1", order_number: "PO-2", quantity: 12, inventory_id: "inv-1" },
];

// ─────────────────────────────────────────────────────────────────────────────
// A PostgREST-faithful stub.
//
// It models the two things this change turns on and nothing else: how an
// `!inner` embed differs from a `!left` one, and how `or=` clauses behave when
// the column is NULL. Both are the actual defects — a stub that ignored either
// would pass against the pre-fix service.
// ─────────────────────────────────────────────────────────────────────────────

type Pred = (row: Row) => boolean;

/** `status.neq.DRAFT` / `status.is.null` / `direction.eq.inbound`. */
function clause(expr: string): Pred {
  const [col, op, ...rest] = expr.split(".");
  const raw = rest.join(".");
  return (row: Row) => {
    const v = row[col];
    switch (op) {
      case "is":
        return raw === "null" ? v === null || v === undefined : v === raw;
      case "eq":
        return v === raw;
      case "neq":
        // SQL three-valued logic: `NULL <> 'X'` is NULL, which does NOT pass a
        // WHERE. This is the whole reason the service pairs every `neq` with an
        // explicit `is.null` arm.
        return v === null || v === undefined ? false : v !== raw;
      default:
        throw new Error(`stub does not model operator '${op}'`);
    }
  };
}

function makeClient(rows: Row[]) {
  const captured: { select?: string; ors: string[] } = { ors: [] };

  const builder = (table: string) => {
    const preds: Pred[] = [];
    let selectStr = "";

    const self: any = {
      select(sel: string) {
        selectStr = sel;
        if (table === "procurement_conversations") captured.select = sel;
        return self;
      },
      eq(col: string, val: any) {
        preds.push((r) => r[col] === val);
        return self;
      },
      or(expr: string) {
        if (table === "procurement_conversations") captured.ors.push(expr);
        const arms = expr.split(",").map(clause);
        preds.push((r) => arms.some((a) => a(r)));
        return self;
      },
      in(col: string, vals: any[]) {
        preds.push((r) => vals.includes(r[col]));
        return self;
      },
      not(col: string, op: string, val: any) {
        if (op !== "in") throw new Error(`stub does not model not.${op}`);
        const list = String(val)
          .replace(/^\(|\)$/g, "")
          .split(",");
        preds.push((r) => r[col] !== null && !list.includes(r[col]));
        return self;
      },
      order: () => self,
      limit: () => self,
      then(resolve: any, reject: any) {
        let out = rows.filter((r) => preds.every((p) => p(r)));

        // The embed. `!inner` drops a row whose FK resolves to nothing;
        // `!left` keeps it and leaves the embedded object null.
        const inner = selectStr.includes("procurement_orders!inner");
        const left = selectStr.includes("procurement_orders!left");
        if (inner || left) {
          out = out
            .map((r) => ({
              ...r,
              procurement_orders:
                ORDERS.find((o) => o.id === r.order_id) ?? null,
            }))
            .filter((r) => (inner ? r.procurement_orders !== null : true));
        }
        return Promise.resolve({ data: out, error: null }).then(
          resolve,
          reject,
        );
      },
    };
    return self;
  };

  return {
    captured,
    client: { from: (t: string) => builder(t) },
  };
}

function serviceOver(rows: Row[]) {
  const { client, captured } = makeClient(rows);
  const service = new ProcurementService(
    { supabase: client, getClient: () => client } as any,
    {} as any,
    {} as any,
  );
  return { service, captured };
}

// ─────────────────────────────────────────────────────────────────────────────

describe("getConversationHistory — the ledger sees its own rows (ADR 0081)", () => {
  it("returns 26 of production's 27 rows, where the old query returned 2", async () => {
    const rows = productionShapedRows();
    expect(rows).toHaveLength(27);

    const { service } = serviceOver(rows);
    const out = await service.getConversationHistory(REST);

    // 27 minus the one PENDING_APPROVAL row, which is live in the approval
    // queue on /orders. Nothing else is withheld.
    expect(out).toHaveLength(26);
  });

  it("keeps conversations that are not attached to a purchase order", async () => {
    // The binding constraint. 25 of 27 production rows have order_id null and
    // `procurement_orders!inner` dropped every one of them, so this assertion
    // is the one that fails hardest against the pre-fix tree.
    const { service } = serviceOver(productionShapedRows());
    const out = await service.getConversationHistory(REST);

    const unattached = out.filter((r) => r.orderId === null);
    expect(unattached.length).toBe(24);
    expect(out.filter((r) => r.orderId !== null)).toHaveLength(2);
  });

  it("shows every inbound vendor reply", async () => {
    const { service } = serviceOver(productionShapedRows());
    const out = await service.getConversationHistory(REST);

    const inbound = out.filter((r) => r.direction === "INBOUND");
    expect(inbound).toHaveLength(10);
  });

  it("renders an inbound body from message_text instead of claiming none was recorded", async () => {
    // `content` is NULL on all ten inbound rows in production. Reading only
    // `content` made the page print "No message body was recorded for this
    // exchange" about messages whose bodies were recorded.
    const { service } = serviceOver(productionShapedRows());
    const out = await service.getConversationHistory(REST);

    const first = out.find((r) => r.id === "in-0");
    expect(first).toBeDefined();
    expect(first!.draftContent).toBe("Vendor reply number 0");
    expect(out.every((r) => r.draftContent !== null)).toBe(true);
  });

  it("withholds the approval queue, and only the approval queue", async () => {
    const { service } = serviceOver(productionShapedRows());
    const out = await service.getConversationHistory(REST);
    const statuses = out.map((r) => r.status);

    expect(statuses).not.toContain("PENDING_APPROVAL");
    // Discarded and cancelled drafts are part of the record of what happened
    // with a vendor, so they are shown rather than quietly dropped.
    expect(statuses.filter((s) => s === "DISCARDED")).toHaveLength(3);
    expect(statuses.filter((s) => s === "CANCELLED")).toHaveLength(1);
    expect(statuses.filter((s) => s === "APPROVED")).toHaveLength(2);
  });

  it("withholds an OUTBOUND draft but not an INBOUND one", async () => {
    const rows = productionShapedRows();
    rows.push({
      id: "own-draft",
      restaurant_id: REST,
      order_id: null,
      provider_id: "prov-0",
      direction: "outbound",
      status: "DRAFT",
      content: "Not sent yet",
      message_text: "Not sent yet",
      created_at: new Date(2026, 8, 1).toISOString(),
      outbound_email_type: "PRICE_INQUIRY",
      round_count: 0,
    });

    const { service } = serviceOver(rows);
    const out = await service.getConversationHistory(REST);
    const ids = out.map((r) => r.id);

    // Our own unsent draft lives in the approval queue.
    expect(ids).not.toContain("own-draft");
    // A vendor's reply wears the same DEFAULT status and is not a draft of ours.
    expect(ids).toContain("in-0");
  });

  it("shows a status nobody has heard of — the filter is a deny-list", async () => {
    // The allow-list was half the fault: DISCARDED and CANCELLED both
    // post-date it and vanished without a word. A ledger has to fail toward
    // showing too much.
    const rows = productionShapedRows();
    rows.push({
      id: "future-0",
      restaurant_id: REST,
      order_id: null,
      provider_id: "prov-0",
      direction: "outbound",
      status: "ESCALATED_TO_HUMAN",
      content: "A status this code has never seen",
      message_text: "A status this code has never seen",
      created_at: new Date(2026, 8, 2).toISOString(),
      outbound_email_type: null,
      round_count: 0,
    });

    const { service } = serviceOver(rows);
    const out = await service.getConversationHistory(REST);
    expect(out.map((r) => r.id)).toContain("future-0");
  });

  it("shows a row whose status is NULL rather than letting neq swallow it", async () => {
    // `status` is nullable — it only has a DEFAULT. `status <> 'DRAFT'` is
    // NULL for a NULL status and excludes the row, so both filters carry an
    // explicit `status.is.null` arm.
    const rows = productionShapedRows();
    rows.push({
      id: "null-status",
      restaurant_id: REST,
      order_id: null,
      provider_id: "prov-0",
      direction: "outbound",
      status: null,
      content: "No status at all",
      message_text: "No status at all",
      created_at: new Date(2026, 8, 3).toISOString(),
      outbound_email_type: null,
      round_count: 0,
    });

    const { service } = serviceOver(rows);
    const out = await service.getConversationHistory(REST);
    expect(out.map((r) => r.id)).toContain("null-status");
  });

  it("still refuses another restaurant's conversations", async () => {
    const rows = productionShapedRows();
    rows.push({
      id: "foreign",
      restaurant_id: OTHER,
      order_id: null,
      provider_id: "prov-9",
      direction: "inbound",
      status: "DRAFT",
      content: null,
      message_text: "Somebody else's vendor",
      created_at: new Date(2026, 8, 4).toISOString(),
      outbound_email_type: null,
      round_count: 0,
    });

    const { service } = serviceOver(rows);
    const out = await service.getConversationHistory(REST);
    expect(out.map((r) => r.id)).not.toContain("foreign");
  });

  it("does not use an INNER embed on procurement_orders", async () => {
    // Belt and braces on the stub: if someone reinstates `!inner`, the row
    // counts above go quiet in a way that is easy to misread as a fixture
    // problem. This says which line moved.
    const { service, captured } = serviceOver(productionShapedRows());
    await service.getConversationHistory(REST);

    expect(captured.select).toBeDefined();
    expect(captured.select).not.toContain("procurement_orders!inner");
    expect(captured.select).toContain("procurement_orders!left");
    expect(captured.select).toContain("message_text");
  });

  it("normalises direction to the casing the UI compares against", async () => {
    const { service } = serviceOver(productionShapedRows());
    const out = await service.getConversationHistory(REST);
    expect(new Set(out.map((r) => r.direction))).toEqual(
      new Set(["INBOUND", "OUTBOUND"]),
    );
  });
});
