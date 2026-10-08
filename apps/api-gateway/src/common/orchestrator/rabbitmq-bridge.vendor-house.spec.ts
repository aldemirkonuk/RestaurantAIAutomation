import {
  INBOUND_HOUSE_ROWS_READ,
  RabbitMqBridgeService,
} from "./rabbitmq-bridge.service";
import { InboundResponderService } from "./inbound-responder.service";

/**
 * Inbound vendor mail is filed under ONE house, with a vendor of THAT house
 * (ADR 0221: a vendor row belongs to one house; a row with no house is an
 * orphan and belongs to none). Vendor-house census 2026-10-08, finding 1.
 *
 * Before this, `handleInboundEmail` looked the sender up across every house
 * (`.ilike(contact_email).limit(1)`, house filter only when the event carried
 * one) and then let a `gmail_thread_id` match overwrite the house. So house B's
 * thread plus a sender who is house A's vendor wrote a `procurement_conversations`
 * row with B's `restaurant_id` and A's `provider_id`, and handed the same pair
 * to the promotion extractor and the responder. Every house-scoped read that
 * embeds `providers(...)` then showed B house A's vendor record.
 *
 * This file is the blocking guard for that pairing: it runs in CI's gateway
 * jest job (test-typescript, required by CI Complete).
 */

const HOUSE_A = "aaaaaaaa-0000-4000-8000-00000000000a";
const HOUSE_B = "bbbbbbbb-0000-4000-8000-00000000000b";
const VENDOR_A = "prov-a";
const VENDOR_B = "prov-b";
const SENDER = "sales@shared-vendor.test";

type Row = Record<string, any>;

/** In-memory Supabase stand-in with the operators these paths call. */
function makeStore(
  tables: Record<string, Row[]>,
  failedReads: Record<string, string> = {},
) {
  const from = (table: string) => {
    const filters: Array<(r: Row) => boolean> = [];
    let limitTo: number | null = null;
    let insertRows: Row[] | null = null;
    const run = () => {
      if (!insertRows && failedReads[table]) {
        return { data: null, error: { message: failedReads[table] } };
      }
      if (insertRows) {
        const rows = insertRows.map((r, i) => ({
          id: `${table}-${(tables[table]?.length ?? 0) + i + 1}`,
          ...r,
        }));
        (tables[table] ??= []).push(...rows);
        return { data: rows, error: null };
      }
      let rows = (tables[table] ?? []).filter((r) =>
        filters.every((f) => f(r)),
      );
      if (limitTo !== null) rows = rows.slice(0, limitTo);
      return { data: rows, error: null };
    };
    const b: any = {
      select: () => b,
      insert: (rows: Row | Row[]) => {
        insertRows = Array.isArray(rows) ? rows : [rows];
        return b;
      },
      eq: (c: string, v: any) => {
        filters.push((r) => r[c] === v);
        return b;
      },
      ilike: (c: string, v: string) => {
        filters.push(
          (r) => String(r[c] ?? "").toLowerCase() === v.toLowerCase(),
        );
        return b;
      },
      not: (c: string, op: string, v: string) => {
        if (op === "in") {
          const vals = v.replace(/^\(|\)$/g, "").split(",");
          filters.push((r) => !vals.includes(r[c]));
        }
        return b;
      },
      order: () => b,
      limit: (n: number) => {
        limitTo = n;
        return b;
      },
      single: async () => {
        const res = run();
        return { data: res.data?.[0] ?? null, error: res.error };
      },
      maybeSingle: async () => {
        const res = run();
        return { data: res.data?.[0] ?? null, error: res.error };
      },
      then: (resolve: any, reject: any) =>
        Promise.resolve(run()).then(resolve, reject),
    };
    return b;
  };
  return { supabase: { from } };
}

function harness(
  tables: Record<string, Row[]>,
  failedReads: Record<string, string> = {},
) {
  const all: Record<string, Row[]> = {
    providers: [],
    procurement_conversations: [],
    procurement_orders: [],
    ...tables,
  };
  const store = makeStore(all, failedReads);
  const gateway = {
    emitRestaurantNotification: jest.fn(),
    emitConversationUpdated: jest.fn(),
  };
  const responder = {
    analyzeAndDraftReply: jest.fn(async () => undefined),
    persistManagerNotification: jest.fn(async () => undefined),
  };
  const promotionExtractor = {
    extractAndStore: jest.fn(async () => undefined),
  };
  const prospects = {
    domainOf: (email: string) => email.split("@")[1],
    captureFromColdEmail: jest.fn(async () => ({
      captured: true,
      isNew: false,
      isTriage: true,
      restaurantId: null,
      domain: "shared-vendor.test",
    })),
  };
  const bridge = new RabbitMqBridgeService(
    { get: () => undefined } as any,
    gateway as any,
    { supabase: store.supabase } as any,
    responder as any,
    promotionExtractor as any,
    prospects as any,
  );
  (bridge as any).persistAttachments = async () => undefined;
  (bridge as any).persistProspectAttachments = async () => [];
  const inbound = () =>
    all.procurement_conversations.filter((r) => r.direction === "inbound");
  const handle = (payload: Row) =>
    (bridge as any).handleInboundEmail({
      payload: {
        from: `Shared Vendor <${SENDER}>`,
        subject: "Re: your order",
        body: "Confirmed, 20% off this week only.",
        attachments: [
          { filename: "a.pdf", mime_type: "application/pdf", data: "" },
        ],
        ...payload,
      },
    });
  return {
    all,
    inbound,
    handle,
    responder,
    promotionExtractor,
    prospects,
  };
}

const vendor = (id: string, house: string | null) => ({
  id,
  restaurant_id: house,
  name: `Vendor ${id}`,
  contact_email: SENDER,
});

const threadRow = (house: string, gmailThreadId = "gt-1") => ({
  id: `conv-${house}`,
  direction: "outbound",
  order_id: `order-${house}`,
  thread_id: `thread-${house}`,
  restaurant_id: house,
  gmail_thread_id: gmailThreadId,
});

/** No row anywhere pairs one house with another house's (or no house's) vendor. */
function expectNoCrossHousePair(h: ReturnType<typeof harness>) {
  const houseOf = new Map(h.all.providers.map((p) => [p.id, p.restaurant_id]));
  for (const row of h.inbound()) {
    expect(houseOf.get(row.provider_id)).toBe(row.restaurant_id);
  }
  for (const [ctx] of h.promotionExtractor.extractAndStore.mock
    .calls as any[]) {
    expect(houseOf.get(ctx.providerId)).toBe(ctx.restaurantId);
  }
  for (const [ctx] of h.responder.analyzeAndDraftReply.mock.calls as any[]) {
    expect(houseOf.get(ctx.providerId)).toBe(ctx.restaurantId);
  }
}

describe("inbound mail never pairs a house with another house's vendor (ADR 0221)", () => {
  it("a reply in house B's thread from a sender who is only house A's vendor attaches no vendor of A", async () => {
    const h = harness({
      providers: [vendor(VENDOR_A, HOUSE_A)],
      procurement_conversations: [threadRow(HOUSE_B)],
    });

    await h.handle({ gmail_thread_id: "gt-1", gmail_message_id: "m-1" });

    expect(h.inbound()).toEqual([]);
    expect(h.promotionExtractor.extractAndStore).not.toHaveBeenCalled();
    expect(h.responder.analyzeAndDraftReply).not.toHaveBeenCalled();
    // It is an unknown sender in house B: the cold-email path, with no house
    // (the Gmail push stamps none), never house A.
    expect(h.prospects.captureFromColdEmail).toHaveBeenCalledWith(
      expect.objectContaining({ restaurantId: null }),
    );
    expectNoCrossHousePair(h);
  });

  it("a reply in house B's thread from a sender who is a vendor of A and of B attaches B's vendor, in B", async () => {
    const h = harness({
      providers: [vendor(VENDOR_A, HOUSE_A), vendor(VENDOR_B, HOUSE_B)],
      procurement_conversations: [threadRow(HOUSE_B)],
    });

    await h.handle({ gmail_thread_id: "gt-1", gmail_message_id: "m-1" });

    expect(h.inbound()).toHaveLength(1);
    expect(h.inbound()[0]).toMatchObject({
      restaurant_id: HOUSE_B,
      provider_id: VENDOR_B,
      order_id: `order-${HOUSE_B}`,
    });
    expect(h.responder.analyzeAndDraftReply).toHaveBeenCalledWith(
      expect.objectContaining({ restaurantId: HOUSE_B, providerId: VENDOR_B }),
    );
    expectNoCrossHousePair(h);
  });

  it("an event stamped with house A keeps the message in A even when house B holds the same gmail_thread_id", async () => {
    const h = harness({
      providers: [vendor(VENDOR_A, HOUSE_A), vendor(VENDOR_B, HOUSE_B)],
      procurement_conversations: [threadRow(HOUSE_B)],
    });

    await h.handle({
      restaurant_id: HOUSE_A,
      gmail_thread_id: "gt-1",
      gmail_message_id: "m-1",
    });

    expect(h.inbound()).toHaveLength(1);
    expect(h.inbound()[0]).toMatchObject({
      restaurant_id: HOUSE_A,
      provider_id: VENDOR_A,
      order_id: null,
    });
    expectNoCrossHousePair(h);
  });

  it("with no house on the event and no thread, a sender who is a vendor of exactly one house is filed in that house", async () => {
    const h = harness({ providers: [vendor(VENDOR_A, HOUSE_A)] });

    await h.handle({ gmail_message_id: "m-1" });

    expect(h.inbound()).toHaveLength(1);
    expect(h.inbound()[0]).toMatchObject({
      restaurant_id: HOUSE_A,
      provider_id: VENDOR_A,
    });
    expectNoCrossHousePair(h);
  });

  it("with no house on the event and no thread, a sender who is a vendor of two houses is an unknown sender", async () => {
    const h = harness({
      providers: [vendor(VENDOR_A, HOUSE_A), vendor(VENDOR_B, HOUSE_B)],
    });

    await h.handle({ gmail_message_id: "m-1" });

    expect(h.inbound()).toEqual([]);
    expect(h.promotionExtractor.extractAndStore).not.toHaveBeenCalled();
    expect(h.prospects.captureFromColdEmail).toHaveBeenCalledWith(
      expect.objectContaining({ restaurantId: null }),
    );
  });

  it("a houseless (orphan) vendor row is never attached, even in a house's thread", async () => {
    const h = harness({
      providers: [vendor("prov-orphan", null)],
      procurement_conversations: [threadRow(HOUSE_B)],
    });

    await h.handle({ gmail_thread_id: "gt-1", gmail_message_id: "m-1" });

    expect(h.inbound()).toEqual([]);
    expect(h.promotionExtractor.extractAndStore).not.toHaveBeenCalled();
  });

  it("with no house known, an orphan row sharing the address is ignored: it neither matches nor makes the sender ambiguous", async () => {
    const h = harness({
      providers: [vendor("prov-orphan", null), vendor(VENDOR_A, HOUSE_A)],
    });

    await h.handle({ gmail_message_id: "m-1" });

    expect(h.inbound()).toHaveLength(1);
    expect(h.inbound()[0]).toMatchObject({
      restaurant_id: HOUSE_A,
      provider_id: VENDOR_A,
    });
    expectNoCrossHousePair(h);
  });

  it("a failed thread read names no house, and the sender's own house is not used in its place", async () => {
    const h = harness(
      { providers: [vendor(VENDOR_A, HOUSE_A)] },
      { procurement_conversations: "connection reset" },
    );

    await h.handle({ gmail_thread_id: "gt-1", gmail_message_id: "m-1" });

    expect(h.inbound()).toEqual([]);
    expect(h.promotionExtractor.extractAndStore).not.toHaveBeenCalled();
  });

  it("a gmail_thread_id held by two houses names no house; the sender's own single house is used", async () => {
    const h = harness({
      providers: [vendor(VENDOR_A, HOUSE_A)],
      procurement_conversations: [threadRow(HOUSE_B), threadRow(HOUSE_A)],
    });

    await h.handle({ gmail_thread_id: "gt-1", gmail_message_id: "m-1" });

    expect(h.inbound()).toHaveLength(1);
    expect(h.inbound()[0]).toMatchObject({
      restaurant_id: HOUSE_A,
      provider_id: VENDOR_A,
      // The thread named no house, so it names no order either.
      order_id: null,
    });
    expectNoCrossHousePair(h);
  });

  it("dedicated-domain mail whose recipient resolved to no house takes the unknown-sender path, not the vendor's house", async () => {
    const h = harness({ providers: [vendor(VENDOR_A, HOUSE_A)] });

    await h.handle({ source: "inbound-domain", restaurant_id: null });

    expect(h.inbound()).toEqual([]);
    expect(h.promotionExtractor.extractAndStore).not.toHaveBeenCalled();
    expect(h.prospects.captureFromColdEmail).toHaveBeenCalledWith(
      expect.objectContaining({ restaurantId: null }),
    );
  });

  it("the open-order fallback takes only this house's order, never another house's order on the same vendor id", async () => {
    const h = harness({
      providers: [vendor(VENDOR_A, HOUSE_A)],
      procurement_orders: [
        {
          id: "order-foreign",
          provider_id: VENDOR_A,
          restaurant_id: HOUSE_B,
          status: "PENDING",
        },
      ],
    });

    await h.handle({ gmail_message_id: "m-1" });

    expect(h.inbound()).toHaveLength(1);
    expect(h.inbound()[0]).toMatchObject({
      restaurant_id: HOUSE_A,
      provider_id: VENDOR_A,
      order_id: null,
    });
    expect(h.responder.analyzeAndDraftReply).not.toHaveBeenCalled();
  });

  it("a sender read that fills the row limit names no house (fail closed)", async () => {
    const providers = Array.from({ length: INBOUND_HOUSE_ROWS_READ }, (_, i) =>
      vendor(`prov-${i}`, HOUSE_A),
    );
    const h = harness({ providers });

    await h.handle({ gmail_message_id: "m-1" });

    expect(h.inbound()).toEqual([]);
  });
});

describe("the responder reads the order only inside the message's house", () => {
  it("an order id of another house reads as not found, so no draft goes to that order's vendor", async () => {
    const store = makeStore({
      restaurant_feature_flags: [],
      procurement_orders: [
        {
          id: "order-a",
          restaurant_id: HOUSE_A,
          status: "PENDING",
          providers: { name: "Vendor A", contact_email: SENDER },
        },
      ],
    });
    const responder = new InboundResponderService(
      {
        get: (k: string) =>
          k === "ANTHROPIC_API_KEY" ? "test-key" : undefined,
      } as any,
      { supabase: store.supabase } as any,
      {} as any,
      { emitRestaurantNotification: jest.fn() } as any,
      {} as any,
    );

    const result = await responder.analyzeAndDraftReply({
      inboundConversationId: "conv-1",
      orderId: "order-a",
      restaurantId: HOUSE_B,
      providerId: VENDOR_B,
      gmailThreadId: null,
      inboundRfc822MessageId: null,
      inboundReferences: null,
      inboundSubject: null,
      inboundAttachments: [],
      transportSignals: {} as any,
      correlationId: "c-1",
    } as any);

    expect(result).toEqual({ drafted: false, reason: "Order not found" });
  });
});
