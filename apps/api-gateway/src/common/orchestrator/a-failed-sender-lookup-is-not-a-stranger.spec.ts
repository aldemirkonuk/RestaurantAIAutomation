import { RabbitMqBridgeService } from "./rabbitmq-bridge.service";

/**
 * A FAILED SENDER LOOKUP IS NOT A STRANGER (ADR 0067, ADR 0310).
 *
 * `handleInboundEmail` step 1 looks the sender up in `providers`. supabase-js
 * resolves a failed read with { data: null, error }, and the handler used to
 * read that as "no provider": a known vendor's reply went down the cold-email
 * path, filed as a prospect when it had an attachment or looked promotional,
 * otherwise logged "no provider found (not leaded)" and dropped. Nothing
 * redelivers it: the consumer acks before the handler settles and every
 * producer advances its cursor once the publish resolves.
 *
 * Now the lookup is tried three times, and a lookup that still fails parks
 * the mail in `dead_letter_queue` and stops: no prospect, no conversation
 * row, no notice. Gmail mail is parked as a pointer (no sender, subject,
 * body or bytes); webhook mail, which has no mailbox to fetch it from again,
 * is parked whole.
 *
 * The bridge runs against a fake client: every chain records its table and
 * filters, an insert records its row, and awaiting a chain answers from the
 * test's `providers` script (one answer per attempt) or from a fixed answer
 * per table.
 */

const HOUSE = "11111111-1111-4111-8111-111111111111";
const PROVIDER = "22222222-2222-4222-8222-222222222222";
const GRANT = "33333333-3333-4333-8333-333333333333";
const READ_ERROR = { message: "canceling statement due to statement timeout" };

type Answer = { data: unknown; error: unknown } | (() => never);

function fakeClient(opts: {
  providers: Answer[];
  parkError?: { message: string } | null;
}) {
  const providerAnswers = [...opts.providers];
  const inserts: Record<string, any[]> = {};
  const reads: string[] = [];
  const from = (table: string) => {
    let inserted: any = null;
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
      b[m] = () => b;
    }
    b.insert = (row: any) => {
      (inserts[table] ??= []).push(row);
      inserted = row;
      return b;
    };
    const result = (): any => {
      if (inserted) {
        if (table === "dead_letter_queue" && opts.parkError) {
          return { data: null, error: opts.parkError };
        }
        return { data: { id: `${table}-row-1` }, error: null };
      }
      reads.push(table);
      if (table === "providers") {
        const next = providerAnswers.shift();
        if (!next) throw new Error("providers read more times than scripted");
        if (typeof next === "function") return next();
        return next;
      }
      // Every other read: nothing matched, and it worked.
      return { data: [], error: null };
    };
    b.single = async () => result();
    b.maybeSingle = async () => result();
    b.then = (res: any, rej: any) =>
      Promise.resolve().then(result).then(res, rej);
    return b;
  };
  const storage = {
    from: () => ({ upload: async () => ({ data: null, error: null }) }),
  };
  return { client: { from, storage }, inserts, reads };
}

function bridgeOver(fake: ReturnType<typeof fakeClient>) {
  const ws = {
    emitRestaurantNotification: jest.fn(),
    emitConversationUpdated: jest.fn(),
  };
  const responder = {
    analyzeAndDraftReply: jest.fn(),
    persistManagerNotification: jest.fn(),
  };
  const promo = { extractAndStore: jest.fn() };
  const prospects = {
    domainOf: (e: string) => String(e).split("@")[1] ?? "",
    captureFromColdEmail: jest.fn(async () => ({
      captured: true,
      isNew: true,
      isTriage: false,
      restaurantId: HOUSE,
      domain: "vendor.example",
    })),
  };
  const bridge = new RabbitMqBridgeService(
    { get: () => undefined } as any,
    ws as any,
    { supabase: fake.client } as any,
    responder as any,
    promo as any,
    prospects as any,
  );
  const logger = {
    log: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  (bridge as any).logger = logger;
  (bridge as any).providerReadRetryDelaysMs = [0, 0];
  return { bridge, ws, prospects, logger };
}

/** A promotional vendor reply with an attachment: the cold path files it. */
function gmailReply(extra: Record<string, unknown> = {}) {
  return {
    correlation_id: "corr-1",
    payload: {
      from: "Anna Vendor <anna@vendor.example>",
      subject: "New prices and a special offer for you",
      body: "Our new price list is attached. Limited time discount on the Barolo.",
      attachments: [
        {
          filename: "prices.pdf",
          mime_type: "application/pdf",
          data: "JVBERi0=",
        },
      ],
      gmail_message_id: "gm-msg-1",
      gmail_thread_id: "gm-thread-1",
      message_id_header: "<m1@vendor.example>",
      received_at: "2026-10-08T09:00:00.000Z",
      restaurant_id: HOUSE,
      headers: {},
      ...extra,
    },
  };
}

const run = (bridge: RabbitMqBridgeService, msg: unknown) =>
  (bridge as any).handleInboundEmail(msg) as Promise<void>;

const loggedErrors = (logger: { error: jest.Mock }) =>
  logger.error.mock.calls.map((c: unknown[]) => String(c[0])).join("\n");

describe("handleInboundEmail — a failed providers read", () => {
  it("parks the reply instead of filing a known vendor as a prospect", async () => {
    const fake = fakeClient({
      providers: [
        { data: null, error: READ_ERROR },
        { data: null, error: READ_ERROR },
        { data: null, error: READ_ERROR },
      ],
    });
    const { bridge, ws, prospects, logger } = bridgeOver(fake);

    await run(bridge, gmailReply());

    expect(prospects.captureFromColdEmail).not.toHaveBeenCalled();
    expect(fake.inserts["email_prospects"]).toBeUndefined();
    expect(fake.inserts["procurement_conversations"]).toBeUndefined();
    expect(ws.emitRestaurantNotification).not.toHaveBeenCalled();
    expect(fake.reads.filter((t) => t === "providers")).toHaveLength(3);

    const parked = fake.inserts["dead_letter_queue"];
    expect(parked).toHaveLength(1);
    expect(parked[0].agent_name).toBe("api-gateway.rabbitmq-bridge");
    expect(parked[0].original_exchange).toBe("email.events");
    expect(parked[0].original_routing_key).toBe("email.inbound.received");
    expect(parked[0].retry_count).toBe(3);
    expect(parked[0].error).toContain(READ_ERROR.message);
    expect(parked[0].message.parked).toBe("pointer");
    expect(parked[0].message.reason).toBe("provider_read_failed");
    expect(parked[0].message.gmail_message_id).toBe("gm-msg-1");
    expect(parked[0].message.restaurant_id).toBe(HOUSE);
    expect(parked[0].message.attachment_count).toBe(1);
    expect(loggedErrors(logger)).toContain("parked as dead_letter_queue");
  });

  it("parks a plain reply too, rather than dropping it as 'not leaded'", async () => {
    const fake = fakeClient({
      providers: [
        { data: null, error: READ_ERROR },
        { data: null, error: READ_ERROR },
        { data: null, error: READ_ERROR },
      ],
    });
    const { bridge, prospects, logger } = bridgeOver(fake);

    await run(
      bridge,
      gmailReply({
        subject: "Re: order 4471",
        body: "Confirmed for Friday.",
        attachments: [],
      }),
    );

    expect(prospects.captureFromColdEmail).not.toHaveBeenCalled();
    expect(fake.inserts["dead_letter_queue"]).toHaveLength(1);
    expect(loggedErrors(logger)).not.toContain("not leaded");
  });

  it("keeps no raw mail in a pointer: no sender, subject, body, headers or bytes", async () => {
    const fake = fakeClient({
      providers: [
        { data: null, error: READ_ERROR },
        { data: null, error: READ_ERROR },
        { data: null, error: READ_ERROR },
      ],
    });
    const { bridge } = bridgeOver(fake);

    await run(
      bridge,
      gmailReply({ source: "house-inbox", mirrored_by_grant_id: GRANT }),
    );

    const pointer = fake.inserts["dead_letter_queue"][0].message;
    expect(pointer.mirrored_by_grant_id).toBe(GRANT);
    expect(pointer.source).toBe("house-inbox");
    const text = JSON.stringify(pointer);
    expect(text).not.toContain("anna@vendor.example");
    expect(text).not.toContain("special offer");
    expect(text).not.toContain("Barolo");
    expect(text).not.toContain("JVBERi0=");
    expect(text).not.toContain("prices.pdf");
  });

  it("keeps the whole envelope of webhook mail, which has no mailbox to fetch it from again", async () => {
    const fake = fakeClient({
      providers: [
        { data: null, error: READ_ERROR },
        { data: null, error: READ_ERROR },
        { data: null, error: READ_ERROR },
      ],
    });
    const { bridge, prospects } = bridgeOver(fake);
    const msg = gmailReply({
      gmail_message_id: null,
      gmail_thread_id: null,
      source: "inbound-domain",
    });

    await run(bridge, msg);

    expect(prospects.captureFromColdEmail).not.toHaveBeenCalled();
    const parked = fake.inserts["dead_letter_queue"][0].message;
    expect(parked.parked).toBe("envelope");
    expect(parked.envelope).toEqual(msg);
  });

  it("treats a read that throws as a failed read, not as an unexpected error that loses the mail", async () => {
    const boom = () => {
      throw new TypeError("fetch failed");
    };
    const fake = fakeClient({ providers: [boom, boom, boom] });
    const { bridge, prospects } = bridgeOver(fake);

    await run(bridge, gmailReply());

    expect(prospects.captureFromColdEmail).not.toHaveBeenCalled();
    const parked = fake.inserts["dead_letter_queue"];
    expect(parked).toHaveLength(1);
    expect(parked[0].error).toContain("fetch failed");
  });

  it("says the mail is NOT STORED when parking it fails too, and still files no prospect", async () => {
    const fake = fakeClient({
      providers: [
        { data: null, error: READ_ERROR },
        { data: null, error: READ_ERROR },
        { data: null, error: READ_ERROR },
      ],
      parkError: { message: "connection refused" },
    });
    const { bridge, prospects, logger } = bridgeOver(fake);

    await expect(run(bridge, gmailReply())).resolves.toBeUndefined();

    expect(prospects.captureFromColdEmail).not.toHaveBeenCalled();
    const errors = loggedErrors(logger);
    expect(errors).toContain("NOT STORED");
    expect(errors).toContain("gmail_message_id=gm-msg-1");
  });
});

describe("handleInboundEmail — the retry and the paths it must not change", () => {
  it("stores the reply as the vendor's when a retry reads the provider", async () => {
    const fake = fakeClient({
      providers: [
        { data: null, error: READ_ERROR },
        {
          data: [{ id: PROVIDER, restaurant_id: HOUSE, name: "Anna's Wines" }],
          error: null,
        },
      ],
    });
    const { bridge, prospects } = bridgeOver(fake);

    await run(bridge, gmailReply());

    expect(prospects.captureFromColdEmail).not.toHaveBeenCalled();
    expect(fake.inserts["dead_letter_queue"]).toBeUndefined();
    const stored = fake.inserts["procurement_conversations"];
    expect(stored).toHaveLength(1);
    expect(stored[0].provider_id).toBe(PROVIDER);
    expect(stored[0].restaurant_id).toBe(HOUSE);
  });

  it("still files a genuine stranger as a prospect when the read WORKED and matched no one", async () => {
    const fake = fakeClient({ providers: [{ data: [], error: null }] });
    const { bridge, prospects } = bridgeOver(fake);

    await run(bridge, gmailReply());

    expect(prospects.captureFromColdEmail).toHaveBeenCalledTimes(1);
    expect(fake.inserts["dead_letter_queue"]).toBeUndefined();
    expect(fake.reads.filter((t) => t === "providers")).toHaveLength(1);
  });
});
