import { InboundResponderService } from "./inbound-responder.service";
import { parseCommercialTerms } from "./commercial-terms";

/**
 * Unit tests for the deterministic core of the autonomous inbound responder:
 * the guardrail engine, JSON parsing, and reply-threading helpers. The LLM call
 * itself is integration-tested in the deployed environment (needs ANTHROPIC_API_KEY).
 *
 * The numbers below are the REAL data from order #4e3c6629 (ORD-2026-29414):
 *   - We proposed $1,090/bottle for 6 bottles of the 2010 Poggio di Sotto Brunello.
 *   - GULLIT replied: "$1,200/bottle, OR $1,000/bottle if you buy 12 (2 cases)."
 */
describe("InboundResponderService (deterministic core)", () => {
  let service: InboundResponderService;
  const svc = () => service as any; // access private methods under test

  beforeEach(() => {
    // Pure-logic methods don't touch the injected deps, so stubs are fine.
    // Order: configService, databaseService, modelClient, websocketGateway,
    // nfVerdicts.
    service = new InboundResponderService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  const baseAnalysis = (overrides: Record<string, any> = {}) => ({
    intent: "counter_offer",
    sentiment: "positive",
    summary:
      "Vendor countered above target and offered a 12-bottle volume promo.",
    vendor_offers: [
      {
        price_per_bottle: 1200,
        quantity: 6,
        unit: "bottle",
        conditions: "standard",
        quote: "I'd accept at 1,200$",
      },
      {
        price_per_bottle: 1000,
        quantity: 12,
        unit: "bottle",
        conditions: "2-case promo",
        quote: "12 bottles at 1000$",
      },
    ],
    key_facts: ["Counter at $1,200/bottle", "Promo: $1,000/bottle for 12"],
    recommended_action: "counter",
    reasoning: "Price is above target; promo changes quantity.",
    reply_subject: "Re: Order Request: 2010 Poggio di Sotto Brunello",
    reply_body:
      "Thanks for the quick reply! $1,200 is a bit above the $1,090 we had in mind for the six bottles — " +
      "is there any room to move closer to that? The 12-bottle option is interesting; let me check with my manager " +
      "on increasing the quantity and I will get back to you shortly.",
    ...overrides,
  });

  describe("computeGuardrails — real GULLIT offer", () => {
    it("trips price_above_target and qty_or_budget_change, not commitment/max_rounds", () => {
      const flags = svc().computeGuardrails(baseAnalysis(), 1090, 6, 1);

      expect(flags.price_above_target).toBe(true); // 1200 > 1090 at qty 6
      expect(flags.qty_or_budget_change).toBe(true); // 12 != 6
      expect(flags.commitment_language).toBe(false); // reply defers to manager
      expect(flags.max_rounds).toBe(false); // this is only round 2
      expect(flags.needs_approval).toBe(true);
      expect(flags.reasons).toEqual(
        expect.arrayContaining(["price_above_target", "qty_or_budget_change"]),
      );
      expect(flags.best_vendor_price).toBe(1000);
      expect(flags.target_price).toBe(1090);
    });

    it("flags commitment language and forces approval (UCC guardrail)", () => {
      const flags = svc().computeGuardrails(
        baseAnalysis({
          reply_body:
            "Great — we accept the offer and will take all six bottles.",
        }),
        1090,
        6,
        1,
      );
      expect(flags.commitment_language).toBe(true);
      expect(flags.reasons).toContain("commitment_language");
      expect(flags.needs_approval).toBe(true);
    });

    it("trips max_rounds on the 3rd outbound message", () => {
      const flags = svc().computeGuardrails(baseAnalysis(), 1090, 6, 2); // 2 sent -> this is #3
      expect(flags.max_rounds).toBe(true);
      expect(flags.reasons).toContain("max_rounds");
    });

    it("a clean at-target reply with same quantity trips nothing", () => {
      const flags = svc().computeGuardrails(
        baseAnalysis({
          vendor_offers: [
            {
              price_per_bottle: 1050,
              quantity: 6,
              unit: "bottle",
              conditions: "",
              quote: "",
            },
          ],
          reply_body:
            "Perfect, that works on our end — I will confirm with my manager and follow up.",
        }),
        1090,
        6,
        0,
      );
      expect(flags.needs_approval).toBe(false);
      expect(flags.reasons).toHaveLength(0);
    });

    const cleanOffer = (reply_body: string) =>
      baseAnalysis({
        vendor_offers: [
          {
            price_per_bottle: 1050,
            quantity: 6,
            unit: "bottle",
            conditions: "",
            quote: "",
          },
        ],
        reply_body,
      });

    it("flags sender_unverified when transport auth fails, forcing approval", () => {
      const flags = svc().computeGuardrails(
        cleanOffer(
          "Sounds good — I will confirm with my manager and follow up.",
        ),
        1090,
        6,
        0,
        { senderVerified: false },
      );
      expect(flags.sender_unverified).toBe(true);
      expect(flags.reasons).toContain("sender_unverified");
      expect(flags.needs_approval).toBe(true);
    });

    it("does not flag sender_unverified when transport is verified or absent", () => {
      const verified = svc().computeGuardrails(
        cleanOffer("Great, I will confirm with my manager."),
        1090,
        6,
        0,
        { senderVerified: true },
      );
      expect(verified.sender_unverified).toBe(false);
      const absent = svc().computeGuardrails(
        cleanOffer("Great, I will confirm with my manager."),
        1090,
        6,
        0,
      );
      expect(absent.sender_unverified).toBe(false);
    });

    it("detects a French commitment phrase (multilingual UCC guardrail)", () => {
      const flags = svc().computeGuardrails(
        baseAnalysis({
          reply_body:
            "Merci — nous acceptons votre offre pour les six bouteilles.",
        }),
        1090,
        6,
        1,
      );
      expect(flags.commitment_language).toBe(true);
      expect(flags.reasons).toContain("commitment_language");
    });

    it("surfaces commercial-terms guardrails (MOQ not met + tax unknown on a concrete deal)", () => {
      const analysis = baseAnalysis({
        deal_ready: true,
        vendor_offers: [
          {
            price_per_bottle: 1050,
            quantity: 6,
            unit: "bottle",
            conditions: "",
            quote: "",
          },
        ],
        reply_body: "Noted — I will check with my manager and follow up.",
        commercial_terms: parseCommercialTerms({
          unit_price: 1050,
          min_order_qty: 12,
          tax_status: "unknown",
        }),
      });
      const flags = svc().computeGuardrails(analysis, 1090, 6, 0);
      expect(flags.reasons).toEqual(
        expect.arrayContaining(["moq_not_met", "tax_status_unknown"]),
      );
      expect(flags.needs_approval).toBe(true);
    });

    it("does not raise tax_status_unknown when there is no concrete deal yet", () => {
      const analysis = baseAnalysis({
        deal_ready: false,
        vendor_offers: [
          {
            price_per_bottle: 1050,
            quantity: 6,
            unit: "bottle",
            conditions: "",
            quote: "",
          },
        ],
        reply_body: "Noted — I will check with my manager and follow up.",
        commercial_terms: parseCommercialTerms({
          unit_price: 1050,
          tax_status: "unknown",
        }),
      });
      const flags = svc().computeGuardrails(analysis, 1090, 6, 0);
      expect(flags.reasons).not.toContain("tax_status_unknown");
    });
  });

  describe("parseAnalysis", () => {
    it("parses a fenced JSON block", () => {
      const raw = "```json\n" + JSON.stringify(baseAnalysis()) + "\n```";
      const parsed = svc().parseAnalysis(raw);
      expect(parsed).not.toBeNull();
      expect(parsed.intent).toBe("counter_offer");
      expect(parsed.vendor_offers).toHaveLength(2);
    });

    it("returns null when reply_body is missing", () => {
      const bad = JSON.stringify({ intent: "general", sentiment: "neutral" });
      expect(svc().parseAnalysis(bad)).toBeNull();
    });

    it("returns null on non-JSON", () => {
      expect(svc().parseAnalysis("I cannot help with that.")).toBeNull();
    });

    it("parses shadow classification fields when present", () => {
      const raw = JSON.stringify(
        baseAnalysis({
          email_class: "promotion",
          is_automated: true,
          requires_reply: false,
          injection_suspected: true,
        }),
      );
      const parsed = svc().parseAnalysis(raw);
      expect(parsed.email_class).toBe("promotion");
      expect(parsed.is_automated).toBe(true);
      expect(parsed.requires_reply).toBe(false);
      expect(parsed.injection_suspected).toBe(true);
    });

    it("defaults classification safely when the model omits it", () => {
      const parsed = svc().parseAnalysis(JSON.stringify(baseAnalysis()));
      expect(parsed.email_class).toBe("other"); // unknown/absent → other
      expect(parsed.is_automated).toBe(false);
      expect(parsed.requires_reply).toBe(true); // absent → we still consider replying
      expect(parsed.injection_suspected).toBe(false);
    });

    it("coerces an unknown email_class to other", () => {
      const parsed = svc().parseAnalysis(
        JSON.stringify(baseAnalysis({ email_class: "bogus" })),
      );
      expect(parsed.email_class).toBe("other");
    });
  });

  describe("threading helpers", () => {
    it('normalizeReplySubject ensures a single Re: prefix and strips "Subject:"', () => {
      expect(
        svc().normalizeReplySubject(
          "",
          "Subject: Order Request: Brunello",
          "Brunello",
        ),
      ).toBe("Re: Order Request: Brunello");
      expect(
        svc().normalizeReplySubject("Re: Already replied", null, "X"),
      ).toBe("Re: Already replied");
      expect(svc().normalizeReplySubject("", null, "Brunello")).toBe(
        "Re: Order Request: Brunello",
      );
    });

    it("buildReferences appends the latest message id without duplicating", () => {
      expect(svc().buildReferences("<a@x>", "<b@x>")).toBe("<a@x> <b@x>");
      expect(svc().buildReferences("<a@x> <b@x>", "<b@x>")).toBe("<a@x> <b@x>");
      expect(svc().buildReferences(null, "<b@x>")).toBe("<b@x>");
    });

    it("mapEmailType maps actions to outbound_email_type", () => {
      expect(svc().mapEmailType("counter")).toBe("COUNTER_OFFER");
      expect(svc().mapEmailType("accept")).toBe("ACCEPTANCE_CONFIRM_REQUEST");
      expect(svc().mapEmailType("clarify")).toBe("CLARIFICATION");
    });
  });

  describe("auto-reply / loop protection", () => {
    it("flags autoresponders and bounces (never reply to these)", () => {
      for (const s of [
        "Out of Office: back Monday",
        "Automatic reply: I am away",
        "Subject: Auto-Reply from Gullit",
        "Undeliverable: Order Request",
        "Delivery Status Notification (Failure)",
        "Please do not reply to this message",
      ]) {
        expect(svc().isAutoReplyLike(s)).toBe(true);
      }
    });

    it("does NOT flag a normal vendor reply", () => {
      expect(
        svc().isAutoReplyLike(
          "Re: Order Request: 2010 Poggio di Sotto Brunello",
        ),
      ).toBe(false);
      expect(
        svc().isAutoReplyLike("Subject: Re: pricing on the Brunello"),
      ).toBe(false);
      expect(svc().isAutoReplyLike("")).toBe(false);
      expect(svc().isAutoReplyLike(null)).toBe(false);
    });
  });

  describe("syncOrderState — lifecycle (confirmed→APPROVED, matching receipt→ORDERED)", () => {
    /**
     * Capture what `syncOrderState` writes, PER TABLE, without a real database.
     *
     * WHY PER TABLE (fixed 2026-09-05, ADR 0119 Q2 fallout)
     * ----------------------------------------------------
     * This mock used to implement `from().update().eq()` and nothing else, and
     * kept ONE `captured.update`. That was enough while the method wrote one
     * row. It is not any more: the header's `final_price` became a
     * trigger-maintained echo of `procurement_order_items.final_unit_price`, so
     * an accepted price is now written to the LINE, and the method first READS
     * the order's first line to find it.
     *
     * The mock had no `select`, so that read threw, the catch swallowed it, and
     * NOTHING was captured — the acceptance case asserted `status` on an
     * `undefined` payload and failed. The fix is here rather than in the
     * service: the service's behaviour is correct and deliberate, and a mock
     * that cannot answer a read the code makes is a broken mock, not a broken
     * write path.
     *
     * `lineRead` lets a case make that read FAIL, which is its own asserted
     * behaviour: the status still advances and no price is written anywhere.
     */
    const withCapturingDb = (
      lineRead: { data: any; error: any } = { data: { id: "line1" }, error: null },
    ) => {
      const updates: Record<string, Record<string, any>> = {};
      const captured: { update?: Record<string, any> } = {};
      const supabase = {
        from: (table: string) => ({
          update: (payload: Record<string, any>) => {
            updates[table] = payload;
            // Kept so the cases that only care about the order keep reading the
            // way they always did.
            if (table === "procurement_orders") captured.update = payload;
            return { eq: () => Promise.resolve({ error: null }) };
          },
          select: () => ({
            eq: () => ({
              order: () => ({
                limit: () => ({
                  maybeSingle: () => Promise.resolve(lineRead),
                }),
              }),
            }),
          }),
        }),
      };
      const s = new InboundResponderService(
        {} as any,
        { supabase } as any,
        {} as any, // modelClient — unused by the deterministic core under test
        {} as any,
        {} as any, // nfVerdicts — the graded path is not the core under test
      );
      // The decline path tells a manager. Captured rather than stubbed away:
      // "the order moved and nobody was told" is the failure this replaces.
      const notes: Array<{ restaurantId: string; n: Record<string, any> }> = [];
      (s as any).persistManagerNotification = async (
        restaurantId: string,
        n: Record<string, any>,
      ) => {
        notes.push({ restaurantId, n });
      };
      return { s: s as any, captured, updates, notes };
    };

    const acceptanceAnalysis = (overrides: Record<string, any> = {}) =>
      baseAnalysis({
        intent: "price_acceptance",
        deal_kind: "offer",
        vendor_offers: [
          {
            price_per_bottle: 1050,
            quantity: 6,
            unit: "bottle",
            conditions: "",
            quote: "",
          },
        ],
        ...overrides,
      });

    it("vendor accepts under full autonomy → APPROVED, never straight to ORDERED (CONFIRMED)", async () => {
      const { s, updates } = withCapturingDb();
      const order = {
        id: "o1",
        status: "NEGOTIATING",
        quantity: 6,
        final_price: null,
        negotiated_price: null,
      };
      await s.syncOrderState(
        order,
        acceptanceAnalysis(),
        1090,
        6,
        /* autonomyFull */ true,
      );
      expect(updates.procurement_orders?.status).toBe("APPROVED");
      // The accepted price goes on the LINE, and the header is left alone: it is
      // a trigger-maintained echo, and a direct write here that disagreed with
      // the line comes back as a 23514 that would take the status update down
      // with it (ADR 0119 Q2).
      expect(updates.procurement_order_items?.final_unit_price).toBe(1050);
      expect(updates.procurement_orders).not.toHaveProperty("final_price");
    });

    it("a line that cannot be READ advances the status and writes no price at all", async () => {
      // A failed read is not an empty one. Without knowing whether a line
      // exists, writing the header could hit the echo trigger and take the whole
      // status update down, so the price is left unwritten and said out loud.
      const { s, updates } = withCapturingDb({
        data: null,
        error: { message: "relation unavailable" },
      });
      const order = {
        id: "o5",
        status: "NEGOTIATING",
        quantity: 6,
        final_price: null,
        negotiated_price: null,
      };
      await s.syncOrderState(order, acceptanceAnalysis(), 1090, 6, true);
      expect(updates.procurement_orders?.status).toBe("APPROVED");
      expect(updates.procurement_orders).not.toHaveProperty("final_price");
      expect(updates.procurement_order_items).toBeUndefined();
    });

    it("APPROVED order + matching verification receipt → ORDERED (CONFIRMED)", async () => {
      const { s, captured } = withCapturingDb();
      const order = {
        id: "o2",
        status: "APPROVED",
        quantity: 6,
        final_price: 1050,
        negotiated_price: 1050,
      };
      const receipt = acceptanceAnalysis({
        intent: "order_confirmation",
        deal_kind: "verification",
        vendor_offers: [
          {
            price_per_bottle: 1050,
            quantity: 6,
            unit: "bottle",
            conditions: "",
            quote: "confirmed, shipping Monday",
          },
        ],
      });
      await s.syncOrderState(order, receipt, 1090, 6, /* autonomyFull */ false);
      expect(captured.update?.status).toBe("CONFIRMED");
      expect(captured.update?.confirmed_at).toBeDefined();
    });

    it("APPROVED order + receipt that CONTRADICTS our price → stays APPROVED (needs manager review)", async () => {
      const { s, captured } = withCapturingDb();
      const order = {
        id: "o3",
        status: "APPROVED",
        quantity: 6,
        final_price: 1050,
        negotiated_price: 1050,
      };
      const mismatchedReceipt = acceptanceAnalysis({
        intent: "order_confirmation",
        deal_kind: "verification",
        vendor_offers: [
          {
            price_per_bottle: 1200,
            quantity: 6,
            unit: "bottle",
            conditions: "",
            quote: "confirmed at 1200",
          },
        ],
      });
      await s.syncOrderState(order, mismatchedReceipt, 1090, 6, false);
      expect(captured.update?.status).toBeUndefined(); // no lifecycle advance
    });

    it("already ORDERED (CONFIRMED) is terminal → no update at all", async () => {
      const { s, captured } = withCapturingDb();
      const order = {
        id: "o4",
        status: "CONFIRMED",
        quantity: 6,
        final_price: 1050,
      };
      await s.syncOrderState(order, acceptanceAnalysis(), 1090, 6, true);
      expect(captured.update).toBeUndefined();
    });

  /**
   * ADR 0125 Q3 — a vendor's no is not the order's death.
   *
   * ADDED AFTER AN AUDIT. The Q3 change shipped with no regression test at all in
   * either language: the auditor swapped the PRE-FIX service back in and the whole
   * file still passed 25/25, because none of the existing cases sends a decline.
   *
   * Writing these found a real defect in the shipped change, not just a gap: the
   * `CONFIRMED -> NEGOTIATING` edge was added to the transition table and was
   * UNREACHABLE from here, because `syncOrderState` returned early on any terminal
   * status — CONFIRMED among them — before the decline branch was ever consulted.
   * The first version of the CONFIRMED case below failed against the code that had
   * already been committed.
   */
  describe("syncOrderState — a vendor's decline (ADR 0125 Q3)", () => {
    const declineAnalysis = (intent: string) =>
      baseAnalysis({
        intent,
        deal_kind: "none",
        vendor_offers: [],
        summary: "We cannot supply this vintage.",
      });

    it("leaves an order already NEGOTIATING where it is, and tells a manager", async () => {
      const { s, updates, notes } = withCapturingDb();
      const order = {
        id: "d1",
        restaurant_id: "rest-A",
        status: "NEGOTIATING",
        quantity: 6,
        final_price: null,
        negotiated_price: null,
      };
      await s.syncOrderState(order, declineAnalysis("rejection"), 1090, 6, false);

      // No status write: it is already in the state a decline lands in, and a
      // rewrite would be a change nobody made.
      expect(updates.procurement_orders).not.toHaveProperty("status");
      // And NOT closed. This is the whole decision: REJECTED would drop the order
      // out of every open-order list before a person decided anything.
      expect(updates.procurement_orders?.status).not.toBe("REJECTED");

      // The decline is NOT copied onto the order. Who declined, when and in what
      // words is the inbound `procurement_conversations` row; two accounts of one
      // event can disagree.
      const payload = JSON.stringify(updates.procurement_orders ?? {});
      expect(payload).not.toMatch(/decline/i);
      expect(payload).not.toMatch(/cannot supply/i);
      expect(updates.procurement_orders).not.toHaveProperty("rejection_reason");

      expect(notes).toHaveLength(1);
      expect(notes[0].restaurantId).toBe("rest-A");
      expect(notes[0].n.message).toMatch(/not cancelled/i);
      expect(notes[0].n.metadata.from_status).toBe("NEGOTIATING");
    });

    it("returns a CONFIRMED order to NEGOTIATING rather than treating it as terminal", async () => {
      // The case that caught the defect. CONFIRMED is in `terminal`, so before the
      // fix `syncOrderState` returned before the decline branch and the order
      // stayed placed with the vendor that had just refused it.
      const { s, updates, notes } = withCapturingDb();
      const order = {
        id: "d2",
        restaurant_id: "rest-A",
        status: "CONFIRMED",
        quantity: 6,
        final_price: 1050,
        negotiated_price: 1050,
      };
      await s.syncOrderState(order, declineAnalysis("out_of_stock"), 1090, 6, false);
      expect(updates.procurement_orders?.status).toBe("NEGOTIATING");
      expect(notes[0]?.n.metadata.from_status).toBe("CONFIRMED");
    });

    it.each(["rejection", "declined", "out_of_stock", "OUT_OF_STOCK"])(
      "reads %s as a decline",
      async (intent) => {
        const { s, updates } = withCapturingDb();
        const order = { id: "d3", restaurant_id: "rest-A", status: "CONFIRMED", quantity: 6 };
        await s.syncOrderState(order, declineAnalysis(intent), 1090, 6, false);
        expect(updates.procurement_orders?.status).toBe("NEGOTIATING");
      },
    );

    it("does NOT treat a counter-offer as a decline", async () => {
      // Haggling is not refusing. If `counter_offer` joined DECLINE_INTENTS every
      // ordinary negotiation would rewind a placed order and notify a manager.
      const { s, updates, notes } = withCapturingDb();
      const order = {
        id: "d4",
        restaurant_id: "rest-A",
        status: "CONFIRMED",
        quantity: 6,
        final_price: 1050,
      };
      await s.syncOrderState(
        order,
        baseAnalysis({ intent: "counter_offer", deal_kind: "offer", vendor_offers: [] }),
        1090,
        6,
        false,
      );
      // CONFIRMED is terminal for everything that is not a decline, so nothing at
      // all happened.
      expect(updates.procurement_orders).toBeUndefined();
      expect(notes).toHaveLength(0);
    });

    it("still refuses to rewind an order whose wine is moving or arrived", async () => {
      // The decline rewind is allowed out of CONFIRMED and nothing else, because
      // the transition table has no IN_TRANSIT/DELIVERED -> NEGOTIATING edge. A
      // "decline" at that point is a delivery problem, and it belongs at the door.
      for (const status of ["IN_TRANSIT", "DELIVERED", "COMPLETED", "CANCELLED"]) {
        const { s, updates, notes } = withCapturingDb();
        await s.syncOrderState(
          { id: "d5", restaurant_id: "rest-A", status, quantity: 6 },
          declineAnalysis("rejection"),
          1090,
          6,
          false,
        );
        expect(updates.procurement_orders).toBeUndefined();
        expect(notes).toHaveLength(0);
      }
    });
  });
  });
});
