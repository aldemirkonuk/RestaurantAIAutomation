import { RabbitMqBridgeService } from "./rabbitmq-bridge.service";

/**
 * A TEAM OR GUEST MESSAGE FROM THE WIDER READER IS FILED PLAIN.
 *
 * `gmail_read_all` mirrors every conversation in a mailbox. The reader decides
 * vendor / team / guest from the grant's own house and publishes it as
 * `house_mail_kind`. For team and guest the bridge writes one conversation row
 * (kind, from, to, the grant that mirrored it) and does nothing else: no
 * provider lookup, no prospect, no order match, no promotion scan, no
 * notification, no autonomous responder, no attachment. Without a house AND a
 * grant it files nothing, because such a row could not be found by a
 * revocation. A vendor message goes the ordinary way and now also carries
 * kind, from and to.
 */

const HOUSE = "11111111-1111-4111-8111-111111111111";
const GRANT = "22222222-2222-4222-8222-222222222222";
const PROVIDER = "33333333-3333-4333-8333-333333333333";

function harness(opts: { existing?: boolean } = {}) {
  const inserts: Array<{ table: string; body: Record<string, any> }> = [];
  const tables: string[] = [];
  const from = (table: string) => {
    tables.push(table);
    const b: any = {};
    for (const m of ["select", "eq", "ilike", "not", "order", "limit", "is", "in"]) {
      b[m] = () => b;
    }
    b.insert = (body: Record<string, any>) => {
      inserts.push({ table, body });
      return b;
    };
    const result = () => {
      if (table === "providers") return { data: [{ id: PROVIDER, restaurant_id: HOUSE, name: "Fikri" }], error: null };
      if (table === "procurement_conversations" && !inserts.length) {
        return { data: opts.existing ? [{ id: "x" }] : [], error: null };
      }
      return { data: [], error: null };
    };
    b.single = () => Promise.resolve({ data: { id: "row-1" }, error: null });
    b.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve);
    return b;
  };
  const db = { supabase: { from } };
  const gateway = { emitRestaurantNotification: jest.fn(), emitConversationUpdated: jest.fn() };
  const responder = { analyzeAndDraftReply: jest.fn(), persistManagerNotification: jest.fn() };
  const promotions = { extractAndStore: jest.fn() };
  const prospects = { captureFromColdEmail: jest.fn(), domainOf: () => "d" };
  const bridge = new RabbitMqBridgeService(
    { get: () => undefined } as any,
    gateway as any,
    db as any,
    responder as any,
    promotions as any,
    prospects as any,
  );
  return { bridge, inserts, tables, gateway, responder, promotions, prospects };
}

const event = (over: Record<string, unknown> = {}) => ({
  payload: {
    restaurant_id: HOUSE,
    from: "Guest <guest@diner.example>",
    subject: "A table for six",
    body: "Saturday at eight?",
    gmail_message_id: "gm-1",
    gmail_thread_id: "gt-1",
    received_at: "2026-11-19T10:00:00.000Z",
    source: "house-inbox",
    mirrored_by_grant_id: GRANT,
    house_mail_kind: "guest",
    from_address: "guest@diner.example",
    to_addresses: ["Owner@House.example", "owner@house.example", "not-an-address"],
    headers: { "authentication-results": "mx.google.com; dkim=pass header.i=@diner.example; dmarc=pass" },
    ...over,
  },
});

describe("team and guest mail from the wider reader", () => {
  it("is one plain row carrying kind, from, to and the grant, and nothing else happens", async () => {
    const h = harness();
    await (h.bridge as any).handleInboundEmail(event());

    expect(h.inserts).toHaveLength(1);
    const { table, body } = h.inserts[0];
    expect(table).toBe("procurement_conversations");
    expect(body).toMatchObject({
      restaurant_id: HOUSE,
      provider_id: null,
      order_id: null,
      direction: "inbound",
      kind: "guest",
      from_address: "guest@diner.example",
      to_addresses: ["owner@house.example"],
      mirrored_by_grant_id: GRANT,
      gmail_message_id: "gm-1",
    });
    // No vendor path was entered.
    expect(h.tables).not.toContain("providers");
    expect(h.tables).not.toContain("procurement_orders");
    expect(h.responder.analyzeAndDraftReply).not.toHaveBeenCalled();
    expect(h.promotions.extractAndStore).not.toHaveBeenCalled();
    expect(h.prospects.captureFromColdEmail).not.toHaveBeenCalled();
    expect(h.gateway.emitRestaurantNotification).not.toHaveBeenCalled();
  });

  it("files a message once: a repeat of the same message id in the same house is skipped", async () => {
    const h = harness({ existing: true });
    await (h.bridge as any).handleInboundEmail(event({ house_mail_kind: "team" }));
    expect(h.inserts).toHaveLength(0);
  });

  it("files nothing without a house and a grant", async () => {
    const noGrant = harness();
    await (noGrant.bridge as any).handleInboundEmail(event({ mirrored_by_grant_id: null }));
    expect(noGrant.inserts).toHaveLength(0);
    const noHouse = harness();
    await (noHouse.bridge as any).handleInboundEmail(event({ restaurant_id: null }));
    expect(noHouse.inserts).toHaveLength(0);
  });

  it("leaves a vendor message on the ordinary path, now carrying kind, from and to", async () => {
    const h = harness();
    await (h.bridge as any).handleInboundEmail(
      event({ house_mail_kind: "vendor", from: "Fikri <fikri@fikritarim.com>" }),
    );
    const row = h.inserts.find((i) => i.table === "procurement_conversations")!;
    expect(h.tables).toContain("providers");
    expect(row.body).toMatchObject({
      provider_id: PROVIDER,
      kind: "vendor",
      from_address: "fikri@fikritarim.com",
      to_addresses: ["owner@house.example"],
      mirrored_by_grant_id: GRANT,
    });
  });

  it("keeps the sender check on the row, on both the team-and-guest and the vendor path (r108 mail-gap g8)", async () => {
    const guest = harness();
    await (guest.bridge as any).handleInboundEmail(event());
    expect(guest.inserts[0].body.email_headers.auth).toEqual({ spf: null, dkim: true, dmarc: true, signedBy: "diner.example" });
    const vendor = harness();
    await (vendor.bridge as any).handleInboundEmail(
      event({ house_mail_kind: "vendor", from: "Fikri <fikri@fikritarim.com>", headers: { "authentication-results": "mx; dkim=fail" } }),
    );
    const row = vendor.inserts.find((i) => i.table === "procurement_conversations")!;
    expect(row.body.email_headers.auth).toEqual({ spf: null, dkim: false, dmarc: null, signedBy: null });
    // A letter with no check recorded says so as unknown, never as failed.
    const none = harness();
    await (none.bridge as any).handleInboundEmail(event({ headers: undefined }));
    expect(none.inserts[0].body.email_headers.auth).toEqual({ spf: null, dkim: null, dmarc: null, signedBy: null });
  });
});
