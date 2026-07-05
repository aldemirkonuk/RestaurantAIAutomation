import { InboundResponderService } from './inbound-responder.service';

/**
 * Unit tests for the deterministic core of the autonomous inbound responder:
 * the guardrail engine, JSON parsing, and reply-threading helpers. The LLM call
 * itself is integration-tested in the deployed environment (needs ANTHROPIC_API_KEY).
 *
 * The numbers below are the REAL data from order #4e3c6629 (ORD-2026-29414):
 *   - We proposed $1,090/bottle for 6 bottles of the 2010 Poggio di Sotto Brunello.
 *   - GULLIT replied: "$1,200/bottle, OR $1,000/bottle if you buy 12 (2 cases)."
 */
describe('InboundResponderService (deterministic core)', () => {
  let service: InboundResponderService;
  const svc = () => service as any; // access private methods under test

  beforeEach(() => {
    // Pure-logic methods don't touch the injected deps, so stubs are fine.
    service = new InboundResponderService({} as any, {} as any, {} as any);
  });

  const baseAnalysis = (overrides: Record<string, any> = {}) => ({
    intent: 'counter_offer',
    sentiment: 'positive',
    summary: 'Vendor countered above target and offered a 12-bottle volume promo.',
    vendor_offers: [
      { price_per_bottle: 1200, quantity: 6, unit: 'bottle', conditions: 'standard', quote: "I'd accept at 1,200$" },
      { price_per_bottle: 1000, quantity: 12, unit: 'bottle', conditions: '2-case promo', quote: '12 bottles at 1000$' },
    ],
    key_facts: ['Counter at $1,200/bottle', 'Promo: $1,000/bottle for 12'],
    recommended_action: 'counter',
    reasoning: 'Price is above target; promo changes quantity.',
    reply_subject: 'Re: Order Request: 2010 Poggio di Sotto Brunello',
    reply_body:
      "Thanks for the quick reply! $1,200 is a bit above the $1,090 we had in mind for the six bottles — " +
      "is there any room to move closer to that? The 12-bottle option is interesting; let me check with my manager " +
      'on increasing the quantity and I will get back to you shortly.',
    ...overrides,
  });

  describe('computeGuardrails — real GULLIT offer', () => {
    it('trips price_above_target and qty_or_budget_change, not commitment/max_rounds', () => {
      const flags = svc().computeGuardrails(baseAnalysis(), 1090, 6, 1);

      expect(flags.price_above_target).toBe(true); // 1200 > 1090 at qty 6
      expect(flags.qty_or_budget_change).toBe(true); // 12 != 6
      expect(flags.commitment_language).toBe(false); // reply defers to manager
      expect(flags.max_rounds).toBe(false); // this is only round 2
      expect(flags.needs_approval).toBe(true);
      expect(flags.reasons).toEqual(
        expect.arrayContaining(['price_above_target', 'qty_or_budget_change']),
      );
      expect(flags.best_vendor_price).toBe(1000);
      expect(flags.target_price).toBe(1090);
    });

    it('flags commitment language and forces approval (UCC guardrail)', () => {
      const flags = svc().computeGuardrails(
        baseAnalysis({ reply_body: 'Great — we accept the offer and will take all six bottles.' }),
        1090,
        6,
        1,
      );
      expect(flags.commitment_language).toBe(true);
      expect(flags.reasons).toContain('commitment_language');
      expect(flags.needs_approval).toBe(true);
    });

    it('trips max_rounds on the 3rd outbound message', () => {
      const flags = svc().computeGuardrails(baseAnalysis(), 1090, 6, 2); // 2 sent -> this is #3
      expect(flags.max_rounds).toBe(true);
      expect(flags.reasons).toContain('max_rounds');
    });

    it('a clean at-target reply with same quantity trips nothing', () => {
      const flags = svc().computeGuardrails(
        baseAnalysis({
          vendor_offers: [{ price_per_bottle: 1050, quantity: 6, unit: 'bottle', conditions: '', quote: '' }],
          reply_body: 'Perfect, that works on our end — I will confirm with my manager and follow up.',
        }),
        1090,
        6,
        0,
      );
      expect(flags.needs_approval).toBe(false);
      expect(flags.reasons).toHaveLength(0);
    });
  });

  describe('parseAnalysis', () => {
    it('parses a fenced JSON block', () => {
      const raw = '```json\n' + JSON.stringify(baseAnalysis()) + '\n```';
      const parsed = svc().parseAnalysis(raw);
      expect(parsed).not.toBeNull();
      expect(parsed.intent).toBe('counter_offer');
      expect(parsed.vendor_offers).toHaveLength(2);
    });

    it('returns null when reply_body is missing', () => {
      const bad = JSON.stringify({ intent: 'general', sentiment: 'neutral' });
      expect(svc().parseAnalysis(bad)).toBeNull();
    });

    it('returns null on non-JSON', () => {
      expect(svc().parseAnalysis('I cannot help with that.')).toBeNull();
    });
  });

  describe('threading helpers', () => {
    it('normalizeReplySubject ensures a single Re: prefix and strips "Subject:"', () => {
      expect(svc().normalizeReplySubject('', 'Subject: Order Request: Brunello', 'Brunello')).toBe(
        'Re: Order Request: Brunello',
      );
      expect(svc().normalizeReplySubject('Re: Already replied', null, 'X')).toBe('Re: Already replied');
      expect(svc().normalizeReplySubject('', null, 'Brunello')).toBe('Re: Order Request: Brunello');
    });

    it('buildReferences appends the latest message id without duplicating', () => {
      expect(svc().buildReferences('<a@x>', '<b@x>')).toBe('<a@x> <b@x>');
      expect(svc().buildReferences('<a@x> <b@x>', '<b@x>')).toBe('<a@x> <b@x>');
      expect(svc().buildReferences(null, '<b@x>')).toBe('<b@x>');
    });

    it('mapEmailType maps actions to outbound_email_type', () => {
      expect(svc().mapEmailType('counter')).toBe('COUNTER_OFFER');
      expect(svc().mapEmailType('accept')).toBe('ACCEPTANCE_CONFIRM_REQUEST');
      expect(svc().mapEmailType('clarify')).toBe('CLARIFICATION');
    });
  });

  describe('auto-reply / loop protection', () => {
    it('flags autoresponders and bounces (never reply to these)', () => {
      for (const s of [
        'Out of Office: back Monday',
        'Automatic reply: I am away',
        'Subject: Auto-Reply from Gullit',
        'Undeliverable: Order Request',
        'Delivery Status Notification (Failure)',
        'Please do not reply to this message',
      ]) {
        expect(svc().isAutoReplyLike(s)).toBe(true);
      }
    });

    it('does NOT flag a normal vendor reply', () => {
      expect(svc().isAutoReplyLike('Re: Order Request: 2010 Poggio di Sotto Brunello')).toBe(false);
      expect(svc().isAutoReplyLike('Subject: Re: pricing on the Brunello')).toBe(false);
      expect(svc().isAutoReplyLike('')).toBe(false);
      expect(svc().isAutoReplyLike(null)).toBe(false);
    });
  });

  describe('syncOrderState — lifecycle (confirmed→APPROVED, matching receipt→ORDERED)', () => {
    // Capture the payload passed to supabase.update() so we can assert on the
    // status transition without a real DB.
    const withCapturingDb = () => {
      const captured: { update?: Record<string, any> } = {};
      const supabase = {
        from: () => ({
          update: (payload: Record<string, any>) => {
            captured.update = payload;
            return { eq: () => Promise.resolve({ error: null }) };
          },
        }),
      };
      const s = new InboundResponderService({} as any, { supabase } as any, {} as any);
      return { s: s as any, captured };
    };

    const acceptanceAnalysis = (overrides: Record<string, any> = {}) =>
      baseAnalysis({
        intent: 'price_acceptance',
        deal_kind: 'offer',
        vendor_offers: [{ price_per_bottle: 1050, quantity: 6, unit: 'bottle', conditions: '', quote: '' }],
        ...overrides,
      });

    it('vendor accepts under full autonomy → APPROVED, never straight to ORDERED (CONFIRMED)', async () => {
      const { s, captured } = withCapturingDb();
      const order = { id: 'o1', status: 'NEGOTIATING', quantity: 6, final_price: null, negotiated_price: null };
      await s.syncOrderState(order, acceptanceAnalysis(), 1090, 6, /* autonomyFull */ true);
      expect(captured.update?.status).toBe('APPROVED');
      expect(captured.update?.final_price).toBe(1050);
    });

    it('APPROVED order + matching verification receipt → ORDERED (CONFIRMED)', async () => {
      const { s, captured } = withCapturingDb();
      const order = { id: 'o2', status: 'APPROVED', quantity: 6, final_price: 1050, negotiated_price: 1050 };
      const receipt = acceptanceAnalysis({
        intent: 'order_confirmation',
        deal_kind: 'verification',
        vendor_offers: [{ price_per_bottle: 1050, quantity: 6, unit: 'bottle', conditions: '', quote: 'confirmed, shipping Monday' }],
      });
      await s.syncOrderState(order, receipt, 1090, 6, /* autonomyFull */ false);
      expect(captured.update?.status).toBe('CONFIRMED');
      expect(captured.update?.confirmed_at).toBeDefined();
    });

    it('APPROVED order + receipt that CONTRADICTS our price → stays APPROVED (needs manager review)', async () => {
      const { s, captured } = withCapturingDb();
      const order = { id: 'o3', status: 'APPROVED', quantity: 6, final_price: 1050, negotiated_price: 1050 };
      const mismatchedReceipt = acceptanceAnalysis({
        intent: 'order_confirmation',
        deal_kind: 'verification',
        vendor_offers: [{ price_per_bottle: 1200, quantity: 6, unit: 'bottle', conditions: '', quote: 'confirmed at 1200' }],
      });
      await s.syncOrderState(order, mismatchedReceipt, 1090, 6, false);
      expect(captured.update?.status).toBeUndefined(); // no lifecycle advance
    });

    it('already ORDERED (CONFIRMED) is terminal → no update at all', async () => {
      const { s, captured } = withCapturingDb();
      const order = { id: 'o4', status: 'CONFIRMED', quantity: 6, final_price: 1050 };
      await s.syncOrderState(order, acceptanceAnalysis(), 1090, 6, true);
      expect(captured.update).toBeUndefined();
    });
  });
});
