import { InboundResponderService } from "./inbound-responder.service";

/**
 * F-538: the vendor-offer line and the AI-draft line carry the vendor's price
 * and terms, so they reach the house's owners and managers only, live and in
 * the bell, the same audience as the promotions digest. Before this, both
 * went to the restaurant room and to every member's bell, staff included.
 */
describe("inbound responder money bells (F-538)", () => {
  /** A Supabase stand-in that answers each table the responder reads. */
  function fakeSupabase() {
    const answer = (table: string, op: string) => {
      if (table === "procurement_orders")
        return {
          data: {
            id: "o1",
            quantity: 6,
            negotiated_price: 1090,
            status: "NEGOTIATING",
            providers: { name: "Gullit Wines", contact_email: "v@x.test" },
            restaurant_inventory: { wine_name: "Brunello" },
          },
          error: null,
        };
      if (op === "insert") return { data: { id: "draft-1" }, error: null };
      return { data: [], error: null };
    };
    return {
      from(table: string) {
        let op = "select";
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          in: () => chain,
          order: () => chain,
          limit: () => chain,
          update: () => ((op = "update"), chain),
          insert: () => ((op = "insert"), chain),
          single: () => Promise.resolve(answer(table, op)),
          maybeSingle: () => Promise.resolve(answer(table, op)),
          then: (ok: any, bad: any) =>
            Promise.resolve(answer(table, op)).then(ok, bad),
        };
        return chain;
      },
    };
  }

  function build() {
    const gateway = {
      emitRestaurantNotification: jest.fn(),
      emitRoleNotification: jest.fn(async () => 1),
      emitConversationUpdated: jest.fn(),
    };
    const s: any = new InboundResponderService(
      { get: () => "test-key" } as any,
      { supabase: fakeSupabase() } as any,
      {} as any,
      gateway as any,
      {} as any,
    );
    s.isNegotiationEnabled = async () => true;
    s.isAutonomousSendEnabled = async () => false;
    s.syncOrderState = async () => undefined;
    s.logDecision = async () => undefined;
    s.runLlm = async () => ({
      intent: "counter_offer",
      sentiment: "positive",
      summary: "Gullit asks $1,200 a bottle, or $1,000 for twelve.",
      email_class: "negotiation_reply",
      injection_suspected: false,
      deal_ready: true,
      special_conditions: [],
      vendor_offers: [],
      key_facts: [],
      recommended_action: "counter",
      reply_subject: "Re: Brunello",
      reply_body: "Thanks — let me check with my manager.",
    });
    s.computeGuardrails = () => ({ needs_approval: true, reasons: [] });
    s.buildDealProposal = () => ({
      dealKind: "offer",
      summary: "Gullit asks $1,200 a bottle.",
      finalPrice: 1200,
      proposedPrice: 1090,
      urgency: "normal",
    });
    const bells: Array<{ n: any; opts: any }> = [];
    s.persistManagerNotification = async (_r: string, n: any, opts?: any) => {
      bells.push({ n, opts });
    };
    return { s, gateway, bells };
  }

  const ctx = {
    restaurantId: "r1",
    orderId: "o1",
    providerId: "p1",
    inboundConversationId: "in-1",
    inboundSubject: "Re: Brunello",
  } as any;

  it("[REVERT-FAILS] the offer and the AI draft go to owners and managers only", async () => {
    const { s, gateway, bells } = build();
    const result = await s.analyzeAndDraftReply(ctx);
    expect(result.drafted).toBe(true);

    const types = bells.map((b) => b.n.type);
    expect(types).toEqual(expect.arrayContaining(["deal", "vendor_reply"]));
    for (const b of bells) {
      expect(b.opts?.roles).toEqual(["owner", "manager"]);
    }

    // Nothing with the vendor's price goes to the whole house's room.
    expect(gateway.emitRestaurantNotification).not.toHaveBeenCalled();
    const live = gateway.emitRoleNotification.mock.calls as any[];
    expect(live.map((c) => c[2].title)).toEqual([
      "Gullit Wines sent an offer to review",
      "AI drafted a reply to Gullit Wines",
    ]);
    for (const c of live) expect(c[1]).toEqual(["owner", "manager"]);
  });
});
