import { RabbitMqBridgeService } from "./rabbitmq-bridge.service";
import { DocumentIntakeService } from "../../procurement/documents/document-intake.service";

/**
 * A GUESSED ORDER DOES NOT LINK THE PAPER.
 *
 * `handleInboundEmail` matches a vendor reply to an order in two ways: by the
 * reply's Gmail thread (step 2), or, when that misses, by a fallback (step 2b)
 * that takes the vendor's newest order whose status is not terminal. The
 * fallback exists so a reply sent in a fresh thread still reaches the
 * negotiation it continues, and that stays: the conversation row, the notice
 * and the responder still get the fallback's order.
 *
 * What it must not do is reach `conversation_attachments.order_id`. The
 * document intake sweep hands that column to `ingest`, and `linkAndMatch`
 * files a document that arrives with an order as link_method "manual",
 * confidence 1. An attachment with no order goes to `autoLink`, which links
 * only when the PO number the document cites equals one of this house's order
 * numbers. The last describe block pins those two `linkAndMatch` paths, which
 * this change does not touch.
 */

const HOUSE = "11111111-1111-4111-8111-111111111111";
const PROVIDER = "22222222-2222-4222-8222-222222222222";
const THREAD_ORDER = "33333333-3333-4333-8333-333333333333";
const GUESSED_ORDER = "44444444-4444-4444-8444-444444444444";

type Call = [string, ...unknown[]];

/**
 * A supabase-js stand-in: every chain records its filters, and awaiting it
 * (or `.single()` / `.maybeSingle()`) answers from `answer(table, calls)`.
 */
function fakeClient(
  answer: (table: string, calls: Call[], inserted: boolean) => unknown,
) {
  const inserts: Record<string, any[]> = {};
  const chains: Array<{ table: string; calls: Call[] }> = [];
  const from = (table: string) => {
    const calls: Call[] = [];
    chains.push({ table, calls });
    let inserted = false;
    const b: any = {};
    for (const m of [
      "select",
      "ilike",
      "eq",
      "not",
      "order",
      "limit",
      "is",
      "in",
    ]) {
      b[m] = (...args: unknown[]) => {
        calls.push([m, ...args]);
        return b;
      };
    }
    b.insert = (row: any) => {
      (inserts[table] ??= []).push(row);
      inserted = true;
      return b;
    };
    const result = () => answer(table, calls, inserted);
    b.single = async () => result();
    b.maybeSingle = async () => result();
    b.then = (res: any, rej: any) =>
      Promise.resolve().then(result).then(res, rej);
    return b;
  };
  return { from, inserts, chains };
}

const named = (calls: Call[], column: string) =>
  calls.some((c) => c[0] === "eq" && c[1] === column);

async function settle() {
  for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
}

function bridgeWorld(opts: {
  /** The outbound row the Gmail thread finds: absent, or naming this order. */
  threadOrder: string | null | "row-without-order";
  openOrder: string | null;
}) {
  const client = fakeClient((table, calls, inserted) => {
    if (inserted)
      return table === "procurement_conversations"
        ? { data: { id: "conv-new" }, error: null }
        : { data: null, error: null };
    if (table === "providers")
      return {
        data: [{ id: PROVIDER, restaurant_id: HOUSE, name: "Vendor" }],
        error: null,
      };
    if (
      table === "procurement_conversations" &&
      named(calls, "gmail_thread_id")
    )
      return {
        data: opts.threadOrder
          ? [
              {
                id: "conv-out",
                order_id:
                  opts.threadOrder === "row-without-order"
                    ? null
                    : opts.threadOrder,
                thread_id: "t-1",
                restaurant_id: HOUSE,
              },
            ]
          : [],
        error: null,
      };
    if (table === "procurement_orders")
      return {
        data: opts.openOrder
          ? [{ id: opts.openOrder, restaurant_id: HOUSE }]
          : [],
        error: null,
      };
    return { data: [], error: null };
  });
  const upload = jest.fn(async () => ({ data: { path: "ok" }, error: null }));
  const db = {
    supabase: {
      from: client.from,
      storage: { from: () => ({ upload }) },
    },
  };
  const responder = {
    analyzeAndDraftReply: jest.fn(async () => undefined),
    persistManagerNotification: jest.fn(async () => undefined),
  };
  const gateway = {
    emitRestaurantNotification: jest.fn(),
    emitConversationUpdated: jest.fn(),
  };
  const bridge = new RabbitMqBridgeService(
    { get: () => undefined } as any,
    gateway as any,
    db as any,
    responder as any,
    { extractAndStore: jest.fn(async () => undefined) } as any,
    {} as any,
  );
  const deliver = () =>
    (bridge as any).handleInboundEmail({
      payload: {
        from: "Vendor <orders@vendor.test>",
        subject: "Invoice for your order",
        body: "Please find the invoice attached.",
        attachments: [
          {
            filename: "invoice.pdf",
            mime_type: "application/pdf",
            data: Buffer.from("%PDF-1.4 invoice").toString("base64"),
          },
        ],
        gmail_thread_id: "gmail-thread-1",
        gmail_message_id: "gmail-msg-1",
        restaurant_id: HOUSE,
      },
    });
  return { client, responder, deliver };
}

describe("an inbound vendor reply's attachment carries only the thread's order", () => {
  it("a thread hit: the attachment row carries the thread's order", async () => {
    const w = bridgeWorld({
      threadOrder: THREAD_ORDER,
      openOrder: GUESSED_ORDER,
    });
    await w.deliver();
    await settle();

    expect(w.client.inserts["conversation_attachments"]).toHaveLength(1);
    expect(w.client.inserts["conversation_attachments"][0]).toMatchObject({
      order_id: THREAD_ORDER,
      restaurant_id: HOUSE,
      provider_id: PROVIDER,
    });
    expect(w.client.inserts["procurement_conversations"][0].order_id).toBe(
      THREAD_ORDER,
    );
    // The thread answered, so the fallback never ran.
    expect(w.client.chains.some((c) => c.table === "procurement_orders")).toBe(
      false,
    );
  });

  it("a fallback-only match: the reply keeps the guessed order, the attachment row carries none", async () => {
    const w = bridgeWorld({ threadOrder: null, openOrder: GUESSED_ORDER });
    await w.deliver();
    await settle();

    // The fallback's decided purpose holds: the reply reaches the open order.
    expect(w.client.inserts["procurement_conversations"][0].order_id).toBe(
      GUESSED_ORDER,
    );
    expect(w.responder.analyzeAndDraftReply).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: GUESSED_ORDER }),
    );
    // The paper does not: intake gets no order to file it against.
    expect(w.client.inserts["conversation_attachments"]).toHaveLength(1);
    expect(w.client.inserts["conversation_attachments"][0].order_id).toBeNull();
  });

  it("a thread whose outbound row names no order: the fallback's guess still stays off the attachment", async () => {
    const w = bridgeWorld({
      threadOrder: "row-without-order",
      openOrder: GUESSED_ORDER,
    });
    await w.deliver();
    await settle();

    expect(w.client.inserts["procurement_conversations"][0].order_id).toBe(
      GUESSED_ORDER,
    );
    expect(w.client.inserts["conversation_attachments"][0].order_id).toBeNull();
  });

  it("no thread hit and no open order: the attachment row carries no order", async () => {
    const w = bridgeWorld({ threadOrder: null, openOrder: null });
    await w.deliver();
    await settle();

    expect(
      w.client.inserts["procurement_conversations"][0].order_id,
    ).toBeNull();
    expect(w.client.inserts["conversation_attachments"][0].order_id).toBeNull();
    expect(w.responder.analyzeAndDraftReply).not.toHaveBeenCalled();
  });
});

describe("document intake's linking, which this change leaves as it was", () => {
  function intakeWorld(orderByNumber: Record<string, string>) {
    const client = fakeClient((table, calls, inserted) => {
      if (inserted) return { data: null, error: null };
      if (table === "procurement_orders") {
        const n = calls.find((c) => c[0] === "eq" && c[1] === "order_number");
        const id = n ? orderByNumber[String(n[2])] : undefined;
        return { data: id ? { id } : null, error: null };
      }
      return { data: [], error: null };
    });
    const service = new DocumentIntakeService(
      { getClient: () => ({ from: client.from }) } as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const linkAndMatch = (orderId: string | null, poNumber: string | null) =>
      (service as any).linkAndMatch("doc-1", HOUSE, orderId, {
        poNumber,
        lines: [],
      });
    return { client, linkAndMatch };
  }

  it("a document with no order and an exact PO number is linked by po_number at 0.95, inside the house", async () => {
    const w = intakeWorld({ "PO-1001": THREAD_ORDER });
    await w.linkAndMatch(null, "PO-1001");

    expect(w.client.inserts["procurement_document_links"]).toEqual([
      {
        document_id: "doc-1",
        order_id: THREAD_ORDER,
        restaurant_id: HOUSE,
        link_method: "po_number",
        confidence: 0.95,
      },
    ]);
    const orderRead = w.client.chains.find(
      (c) => c.table === "procurement_orders",
    )!;
    expect(orderRead.calls).toContainEqual(["eq", "restaurant_id", HOUSE]);
  });

  it("a document with no order and no PO number this house issued is not linked", async () => {
    const w = intakeWorld({ "PO-1001": THREAD_ORDER });
    await w.linkAndMatch(null, "PO-9999");
    await w.linkAndMatch(null, null);

    expect(w.client.inserts["procurement_document_links"]).toBeUndefined();
  });

  it("a document that arrives with an order (a thread hit) is filed against it as manual, 1", async () => {
    const w = intakeWorld({});
    await w.linkAndMatch(THREAD_ORDER, null);

    expect(w.client.inserts["procurement_document_links"]).toEqual([
      expect.objectContaining({
        order_id: THREAD_ORDER,
        link_method: "manual",
        confidence: 1,
      }),
    ]);
  });
});
