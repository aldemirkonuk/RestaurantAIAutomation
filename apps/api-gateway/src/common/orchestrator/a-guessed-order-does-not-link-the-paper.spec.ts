import { RabbitMqBridgeService } from "./rabbitmq-bridge.service";
import { DocumentIntakeService } from "../../procurement/documents/document-intake.service";

/**
 * A GUESSED ORDER DOES NOT LINK THE PAPER.
 *
 * `handleInboundEmail` matches a vendor reply to an order in two ways: by the
 * reply's Gmail thread (step 2), or, when that names no order, by a fallback
 * (step 2b) that takes the vendor's newest order whose status is not
 * terminal. The fallback exists so a reply sent in a fresh thread still
 * reaches the negotiation it continues, and that stays: the conversation row,
 * the notice and the responder still get the fallback's order.
 *
 * What it must not do is reach `conversation_attachments.order_id`. The
 * document intake sweep hands that column to `ingest`, and `linkAndMatch`
 * files a document that arrives with an order as link_method "manual",
 * confidence 1. An attachment with no order goes to `autoLink`, which links
 * only when the PO number the document cites equals one of this house's order
 * numbers.
 *
 * The guess reaches the thread too: step 4 stores the inbound row with it,
 * and the responder's draft, a staff reply and a deal confirmation copy it
 * onto later rows with the same gmail_thread_id. So the attachment takes only
 * the order the thread NAMES: the order of the thread's EARLIEST row, and only
 * when that row is outbound and was not itself a reply (no
 * email_headers.in_reply_to): a row the house sent first. That is a staged
 * letter, stored before it is sent, so it stays the earliest row of the
 * thread it opens; or a manual reply or deal confirmation sent when its order
 * had no inbound message to answer, and stored after the send. This spec
 * stages letters only.
 *
 * Not covered here, and still open: a reply row stored with no in_reply_to
 * (a deal confirmation written before confirmDeal recorded it, or any reply
 * to an inbound message that had no Message-ID) that opens a NEW Gmail thread
 * still names its order for invoices sent into that thread.
 *
 * The bridge runs against a fake that keeps procurement_conversations as a
 * table: it applies eq, order and limit, and a read with no order returns the
 * NEWEST row first, so a thread lookup that does not order its rows fails
 * here rather than passing by luck. The last describe block pins the two
 * `linkAndMatch` paths, which this change does not touch.
 */

const HOUSE = "11111111-1111-4111-8111-111111111111";
const PROVIDER = "22222222-2222-4222-8222-222222222222";
const THREAD_ORDER = "33333333-3333-4333-8333-333333333333";
const GUESSED_ORDER = "44444444-4444-4444-8444-444444444444";

type Call = [string, ...unknown[]];
type Row = Record<string, any>;

/**
 * A supabase-js stand-in for the intake tests: every chain records its
 * filters, and awaiting it (or `.single()` / `.maybeSingle()`) answers from
 * `answer(table, calls)`.
 */
function answeringClient(
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

/**
 * The bridge's stand-in. `procurement_conversations` is a table: every row
 * (inserted by the bridge, or seeded by a test in place of the responder and
 * the staff writers) gets an increasing created_at, and a read applies its
 * eq filters, its order keys in turn, and its limit. With no order key a read
 * returns the newest row first. Other tables answer from `answer`. With
 * `threadReadError` set, a read filtered on gmail_thread_id resolves the way
 * supabase-js resolves a failed read, { data: null, error }; other reads of
 * the table (the gmail_message_id dedupe) still answer.
 */
function threadStore(
  answer: (table: string) => unknown,
  threadReadError: { message: string } | null = null,
) {
  let clock = 0;
  const stamp = () =>
    new Date(Date.UTC(2026, 9, 7, 12, 0, clock++)).toISOString();
  const rows: Row[] = [];
  const inserts: Record<string, Row[]> = {};
  const chains: Array<{ table: string; calls: Call[] }> = [];
  const seed = (row: Row): Row => {
    const stored = { id: `row-${clock}`, created_at: stamp(), ...row };
    rows.push(stored);
    return stored;
  };
  const read = (calls: Call[]) => {
    let out = rows.filter((r) =>
      calls.every((c) => c[0] !== "eq" || r[c[1] as string] === c[2]),
    );
    const keys = calls.filter((c) => c[0] === "order") as Array<
      [string, string, { ascending?: boolean }?]
    >;
    const cmp = (a: any, b: any) => (a < b ? -1 : a > b ? 1 : 0);
    out = [...out].sort((a, b) => {
      if (!keys.length) return cmp(b.created_at, a.created_at);
      for (const [, col, o] of keys) {
        const d = cmp(a[col], b[col]) * (o?.ascending === false ? -1 : 1);
        if (d) return d;
      }
      return 0;
    });
    const lim = calls.find((c) => c[0] === "limit");
    return lim ? out.slice(0, lim[1] as number) : out;
  };
  const from = (table: string) => {
    const calls: Call[] = [];
    chains.push({ table, calls });
    let insertedRow: Row | null = null;
    const b: any = {};
    for (const m of ["select", "ilike", "eq", "not", "order", "limit"]) {
      b[m] = (...args: unknown[]) => {
        if (m !== "select" || !insertedRow) calls.push([m, ...args]);
        return b;
      };
    }
    b.insert = (row: Row) => {
      (inserts[table] ??= []).push(row);
      insertedRow =
        table === "procurement_conversations"
          ? seed({ id: `conv-${rows.length + 1}`, ...row })
          : row;
      return b;
    };
    const result = () => {
      if (insertedRow)
        return { data: { id: insertedRow.id ?? null }, error: null };
      if (
        table === "procurement_conversations" &&
        threadReadError &&
        calls.some((c) => c[0] === "eq" && c[1] === "gmail_thread_id")
      )
        return { data: null, error: threadReadError };
      if (table === "procurement_conversations")
        return { data: read(calls), error: null };
      return answer(table);
    };
    b.single = async () => result();
    b.maybeSingle = async () => result();
    b.then = (res: any, rej: any) =>
      Promise.resolve().then(result).then(res, rej);
    return b;
  };
  return { from, rows, inserts, chains, seed };
}

async function settle() {
  for (let i = 0; i < 8; i++) await new Promise((r) => setImmediate(r));
}

const INVOICE = {
  filename: "invoice.pdf",
  mime_type: "application/pdf",
  data: Buffer.from("%PDF-1.4 invoice").toString("base64"),
};

function bridgeWorld(opts: {
  /** The vendor's newest order that is not terminal, which 2b guesses. */
  openOrder: string | null;
  /**
   * When set, the mocked responder stages its draft the way
   * inbound-responder.service.ts does: outbound, ai_generated, on the order
   * it was handed, in the reply's Gmail thread, answering the reply's
   * Message-ID.
   */
  responderStages?: "AUTO_SEND_SCHEDULED" | "PENDING_APPROVAL";
  /** When set, step 2's thread read resolves { data: null, error }. */
  threadReadError?: { message: string };
}) {
  const store = threadStore((table) => {
    if (table === "providers")
      return {
        data: [{ id: PROVIDER, restaurant_id: HOUSE, name: "Vendor" }],
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
  }, opts.threadReadError ?? null);
  const upload = jest.fn(async () => ({ data: { path: "ok" }, error: null }));
  const db = {
    supabase: {
      from: store.from,
      storage: { from: () => ({ upload }) },
    },
  };
  const drafts: Row[] = [];
  const responder = {
    analyzeAndDraftReply: jest.fn(async (ctx: any) => {
      if (!opts.responderStages) return undefined;
      drafts.push(
        store.seed({
          id: `draft-${drafts.length + 1}`,
          order_id: ctx.orderId,
          restaurant_id: ctx.restaurantId,
          provider_id: ctx.providerId,
          direction: "outbound",
          channel: "email",
          ai_generated: true,
          status: opts.responderStages,
          gmail_thread_id: ctx.gmailThreadId || null,
          email_headers: {
            subject: `Re: ${ctx.inboundSubject}`,
            in_reply_to: ctx.inboundRfc822MessageId || null,
            references: ctx.inboundReferences || null,
          },
        }),
      );
      return undefined;
    }),
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
  let n = 0;
  const deliver = async (m: { thread: string; invoice?: boolean }) => {
    n += 1;
    await (bridge as any).handleInboundEmail({
      payload: {
        from: "Vendor <orders@vendor.test>",
        subject: m.invoice ? "Invoice for your order" : "About your order",
        body: m.invoice
          ? "Please find the invoice attached."
          : "We can do 190 per bottle.",
        attachments: m.invoice ? [INVOICE] : [],
        gmail_thread_id: m.thread,
        gmail_message_id: `gmail-msg-${n}`,
        message_id_header: `<vendor-${n}@vendor.test>`,
        restaurant_id: HOUSE,
      },
    });
    await settle();
  };
  const attachmentOrders = () =>
    (store.inserts["conversation_attachments"] ?? []).map((r) => r.order_id);
  const inbound = () => store.rows.filter((r) => r.direction === "inbound");
  /** The house's own letter: staged before it is sent, with no reply headers. */
  const letter = (thread: string, order: string | null, extra: Row = {}) =>
    store.seed({
      id: `letter-${thread}`,
      order_id: order,
      restaurant_id: HOUSE,
      provider_id: PROVIDER,
      direction: "outbound",
      channel: "email",
      ai_generated: true,
      status: "SENT",
      gmail_thread_id: thread,
      email_headers: {},
      ...extra,
    });
  return {
    bridge,
    gateway,
    store,
    responder,
    drafts,
    deliver,
    attachmentOrders,
    inbound,
    letter,
  };
}

describe("an inbound vendor reply's attachment carries only the order its thread names", () => {
  it("a thread hit: the attachment row carries the thread's order", async () => {
    const w = bridgeWorld({ openOrder: GUESSED_ORDER });
    w.letter("house-thread", THREAD_ORDER);
    await w.deliver({ thread: "house-thread", invoice: true });

    expect(w.store.inserts["conversation_attachments"]).toHaveLength(1);
    expect(w.store.inserts["conversation_attachments"][0]).toMatchObject({
      order_id: THREAD_ORDER,
      restaurant_id: HOUSE,
      provider_id: PROVIDER,
    });
    expect(w.inbound()[0].order_id).toBe(THREAD_ORDER);
    // The thread answered, so the fallback never ran.
    expect(w.store.chains.some((c) => c.table === "procurement_orders")).toBe(
      false,
    );
  });

  it("a fallback-only match: the reply keeps the guessed order, the attachment row carries none", async () => {
    const w = bridgeWorld({ openOrder: GUESSED_ORDER });
    await w.deliver({ thread: "fresh-thread", invoice: true });

    // The fallback's decided purpose holds: the reply reaches the open order.
    expect(w.inbound()[0].order_id).toBe(GUESSED_ORDER);
    expect(w.responder.analyzeAndDraftReply).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: GUESSED_ORDER }),
    );
    // The paper does not: intake gets no order to file it against.
    expect(w.attachmentOrders()).toEqual([null]);
  });

  it("a thread whose outbound row names no order: the fallback's guess still stays off the attachment", async () => {
    const w = bridgeWorld({ openOrder: GUESSED_ORDER });
    w.letter("house-thread", null);
    await w.deliver({ thread: "house-thread", invoice: true });

    expect(w.inbound()[0].order_id).toBe(GUESSED_ORDER);
    expect(w.attachmentOrders()).toEqual([null]);
  });

  it("no thread hit and no open order: the attachment row carries no order", async () => {
    const w = bridgeWorld({ openOrder: null });
    await w.deliver({ thread: "fresh-thread", invoice: true });

    expect(w.inbound()[0].order_id).toBeNull();
    expect(w.attachmentOrders()).toEqual([null]);
    expect(w.responder.analyzeAndDraftReply).not.toHaveBeenCalled();
  });
});

describe("a thread the vendor opened names no order for any message in it", () => {
  it("message 2 of a fresh thread: its invoice does not inherit the guess message 1's row carries", async () => {
    // The verifier's reproduction: message 1 has no thread rows and takes the
    // 2b guess; message 2, in the same Gmail thread, carries the invoice.
    const w = bridgeWorld({ openOrder: GUESSED_ORDER });
    await w.deliver({ thread: "fresh-thread" });
    await w.deliver({ thread: "fresh-thread", invoice: true });

    expect(w.attachmentOrders()).toEqual([null]);
    // The text still follows the guess, read back from message 1's row.
    expect(w.inbound().map((r) => r.order_id)).toEqual([
      GUESSED_ORDER,
      GUESSED_ORDER,
    ]);
    expect(w.responder.analyzeAndDraftReply).toHaveBeenLastCalledWith(
      expect.objectContaining({ orderId: GUESSED_ORDER }),
    );
  });

  it.each([
    ["AUTO_SEND_SCHEDULED", null],
    ["PENDING_APPROVAL", null],
    ["AUTO_SENT", "2026-10-07T12:30:00.000Z"],
    ["SENT", "2026-10-07T12:30:00.000Z"],
  ])(
    "the responder's draft on the guess, staged into the thread and then %s: the next invoice carries no order",
    async (status, sentAt) => {
      const w = bridgeWorld({
        openOrder: GUESSED_ORDER,
        responderStages: "AUTO_SEND_SCHEDULED",
      });
      await w.deliver({ thread: "fresh-thread" });
      expect(w.drafts).toHaveLength(1);
      expect(w.drafts[0]).toMatchObject({
        order_id: GUESSED_ORDER,
        direction: "outbound",
        gmail_thread_id: "fresh-thread",
      });
      // An approval or the auto-send sweep moves the same row on.
      w.drafts[0].status = status;
      w.drafts[0].sent_at = sentAt;

      await w.deliver({ thread: "fresh-thread", invoice: true });

      expect(w.attachmentOrders()).toEqual([null]);
      expect(w.inbound()[1].order_id).toBe(GUESSED_ORDER);
    },
  );

  it("a staff reply and a deal confirmation on the guess, copied into the thread: the next invoice carries no order", async () => {
    const w = bridgeWorld({ openOrder: GUESSED_ORDER });
    await w.deliver({ thread: "fresh-thread" });
    const copy = {
      order_id: GUESSED_ORDER,
      restaurant_id: HOUSE,
      provider_id: PROVIDER,
      direction: "outbound",
      channel: "email",
      ai_generated: false,
      status: "SENT",
      gmail_thread_id: "fresh-thread",
    };
    w.store.seed({
      ...copy,
      id: "staff-reply",
      outbound_email_type: "MANUAL_REPLY",
      email_headers: {
        subject: "Re: About your order",
        in_reply_to: "<vendor-1@vendor.test>",
      },
    });
    // Shaped as confirmDeal wrote it before it recorded in_reply_to: the
    // NEWEST row of the thread, outbound, with no reply header.
    w.store.seed({
      ...copy,
      id: "deal-confirmation",
      outbound_email_type: "ORDER_CONFIRMATION",
      email_headers: { subject: "Re: About your order" },
    });

    await w.deliver({ thread: "fresh-thread", invoice: true });

    expect(w.attachmentOrders()).toEqual([null]);
  });

  it("a reply on the guess that opened a new Gmail thread names no order there; the text still joins the guess", async () => {
    // The guessed inbound row had no shared-mailbox thread (the inbound
    // domain, or a person's own mailbox), so the approved draft opened one.
    const w = bridgeWorld({ openOrder: null });
    w.store.seed({
      id: "draft-opened-thread",
      order_id: GUESSED_ORDER,
      restaurant_id: HOUSE,
      provider_id: PROVIDER,
      direction: "outbound",
      channel: "email",
      ai_generated: true,
      status: "AUTO_SENT",
      gmail_thread_id: "thread-the-reply-opened",
      email_headers: {
        subject: "Re: About your order",
        in_reply_to: "<vendor-0@vendor.test>",
      },
    });

    await w.deliver({ thread: "thread-the-reply-opened", invoice: true });

    expect(w.attachmentOrders()).toEqual([null]);
    expect(w.inbound()[0].order_id).toBe(GUESSED_ORDER);
    expect(w.responder.analyzeAndDraftReply).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: GUESSED_ORDER }),
    );
  });

  it("a deal confirmation that opened a new Gmail thread, as confirmDeal now records it, names no order there", async () => {
    const w = bridgeWorld({ openOrder: null });
    w.store.seed({
      id: "confirmation-opened-thread",
      order_id: GUESSED_ORDER,
      restaurant_id: HOUSE,
      provider_id: PROVIDER,
      direction: "outbound",
      channel: "email",
      ai_generated: false,
      status: "SENT",
      outbound_email_type: "ORDER_CONFIRMATION",
      gmail_thread_id: "thread-the-confirmation-opened",
      email_headers: {
        subject: "Re: About your order",
        in_reply_to: "<vendor-0@vendor.test>",
        references: null,
      },
    });

    await w.deliver({
      thread: "thread-the-confirmation-opened",
      invoice: true,
    });

    expect(w.attachmentOrders()).toEqual([null]);
  });
});

describe("a thread the house opened names the letter's order for every message in it", () => {
  it("a house-opened thread: later invoices carry the letter's order, past the responder's own draft in the thread", async () => {
    const w = bridgeWorld({
      openOrder: GUESSED_ORDER,
      responderStages: "AUTO_SEND_SCHEDULED",
    });
    w.letter("house-thread", THREAD_ORDER);
    await w.deliver({ thread: "house-thread" });
    // The responder answered message 1 in the same thread, as a reply.
    expect(w.drafts[0]).toMatchObject({
      order_id: THREAD_ORDER,
      gmail_thread_id: "house-thread",
      email_headers: expect.objectContaining({
        in_reply_to: "<vendor-1@vendor.test>",
      }),
    });

    await w.deliver({ thread: "house-thread", invoice: true });
    await w.deliver({ thread: "house-thread", invoice: true });

    expect(w.attachmentOrders()).toEqual([THREAD_ORDER, THREAD_ORDER]);
    expect(w.inbound().map((r) => r.order_id)).toEqual([
      THREAD_ORDER,
      THREAD_ORDER,
      THREAD_ORDER,
    ]);
  });

  it("a letter whose direction is stored in upper case still names its order", async () => {
    const w = bridgeWorld({ openOrder: GUESSED_ORDER });
    w.letter("house-thread", THREAD_ORDER, { direction: "OUTBOUND" });
    await w.deliver({ thread: "house-thread", invoice: true });

    expect(w.attachmentOrders()).toEqual([THREAD_ORDER]);
  });
});

describe("a failed thread read is not an empty thread, and does not become a guess", () => {
  it("the thread read fails: the reply is stored with no order, marked, and the fallback never runs", async () => {
    const w = bridgeWorld({
      openOrder: GUESSED_ORDER,
      threadReadError: { message: "connection reset by peer" },
    });
    const logged = jest
      .spyOn((w.bridge as any).logger, "error")
      .mockImplementation(() => undefined);
    // The house's letter IS in the thread; the read just cannot see it.
    w.letter("house-thread", THREAD_ORDER);
    await w.deliver({ thread: "house-thread", invoice: true });

    // The mail is kept: one inbound row, on this house and vendor.
    expect(w.inbound()).toHaveLength(1);
    const row = w.inbound()[0];
    expect(row).toMatchObject({
      restaurant_id: HOUSE,
      provider_id: PROVIDER,
      gmail_thread_id: "house-thread",
    });
    // No guessed order, and no thread order either.
    expect(row.order_id).toBeNull();
    expect(row.thread_id).toBeNull();
    expect(row.confidence_score).toBeNull();
    // It says the match could not be read, not that nothing matched.
    expect(row.email_headers.order_match).toBe("thread_read_failed");
    // 2b never read the vendor's open orders, so it could not link one.
    expect(w.store.chains.some((c) => c.table === "procurement_orders")).toBe(
      false,
    );
    // No order, so no responder draft and no order link on the notice.
    expect(w.responder.analyzeAndDraftReply).not.toHaveBeenCalled();
    expect(w.gateway.emitRestaurantNotification).toHaveBeenCalledWith(
      HOUSE,
      expect.objectContaining({ action_url: undefined }),
    );
    // The invoice reaches intake with no order, so only autoLink can file it.
    expect(w.attachmentOrders()).toEqual([null]);
    // The failure is logged, with the read's own error.
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining(
        "thread read failed for gmail_thread_id=house-thread",
      ),
    );
    expect(logged).toHaveBeenCalledWith(
      expect.stringContaining("connection reset by peer"),
    );
  });

  it("a thread read that answers carries no order_match mark, and 2b still runs when the thread names no order", async () => {
    const w = bridgeWorld({ openOrder: GUESSED_ORDER });
    await w.deliver({ thread: "fresh-thread", invoice: true });

    expect(w.inbound()[0].order_id).toBe(GUESSED_ORDER);
    expect(w.inbound()[0].email_headers).not.toHaveProperty("order_match");
    expect(w.store.chains.some((c) => c.table === "procurement_orders")).toBe(
      true,
    );
  });
});

describe("document intake's linking, which this change leaves as it was", () => {
  function intakeWorld(orderByNumber: Record<string, string>) {
    const client = answeringClient((table, calls, inserted) => {
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
