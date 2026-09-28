/**
 * Unit tests for conversation summary and negotiation approval flow.
 *
 * Tests the mapping logic that:
 * 1. Returns `direction` on every conversation row (OUTBOUND/INBOUND)
 * 2. Identifies whether a provider has replied (INBOUND entry exists)
 * 3. Derives the most recent rolling summary, and carries its provenance
 *    (which engine read the answer, and when) for the responses sheet
 *    `apps/web/src/pages/orders/next/ResponsesSheet.tsx`
 *
 * These are pure-logic tests — no NestJS DI or Supabase required.
 *
 * Run:
 *   cd apps/api-gateway && npx jest --testPathPattern conversation-summary --runInBand
 */

// ─── Mirrors the mapping in procurement.service.ts getOrderConversations ──────

function mapConversationRow(row: Record<string, any>) {
  return {
    id: row.id,
    orderId: row.order_id,
    status: row.status,
    direction: (row.direction ?? "OUTBOUND") as "OUTBOUND" | "INBOUND",
    emailType: row.outbound_email_type,
    roundCount: row.round_count,
    createdAt: row.created_at,
    sentAt: row.sent_at ?? null,
    draftContent: row.content ?? row.message_text ?? null,
    rollingSummary: row.rolling_summary ?? null,
    // Provenance for the summary, added 2026-09-05 so the sheet can say WHO
    // wrote the sentence rather than letting it read as the house's own. Both
    // were already persisted by the understand step
    // (`inbound-responder.service.ts`) and read back by nothing.
    summaryModel: row.conversation_context?.model ?? null,
    summaryAnalyzedAt: row.conversation_context?.analyzed_at ?? null,
    orderNumber: row.procurement_orders?.order_number ?? null,
    quantity: row.procurement_orders?.quantity ?? null,
    quotedPrice: row.procurement_orders?.quoted_price ?? null,
    wineName: row.procurement_orders?.inventory?.wine_name ?? null,
    providerName: row.providers?.name ?? null,
    providerEmail: row.providers?.contact_email ?? null,
  };
}

function makeRow(overrides: Record<string, any> = {}) {
  return {
    id: "conv-1",
    order_id: "order-1",
    provider_id: "prov-1",
    outbound_email_type: "PRICE_INQUIRY",
    round_count: 1,
    created_at: new Date().toISOString(),
    sent_at: new Date().toISOString(),
    status: "SENT",
    direction: "OUTBOUND",
    content: "Dear provider, requesting 6 bottles.",
    message_text: null,
    rolling_summary: null,
    constraint_flags: null,
    procurement_orders: {
      order_number: "ORD-001",
      quantity: 6,
      quoted_price: 45,
      inventory: { wine_name: "Chateau Margaux 2018" },
    },
    providers: {
      name: "Bordeaux Suppliers",
      contact_email: "supplier@bordeaux.com",
    },
    ...overrides,
  };
}

// ─── Row mapping tests ────────────────────────────────────────────────────────

describe("getOrderConversations row mapping — direction field", () => {
  it("maps direction=OUTBOUND from a regular outbound draft row", () => {
    const result = mapConversationRow(makeRow({ direction: "OUTBOUND" }));
    expect(result.direction).toBe("OUTBOUND");
  });

  it("maps direction=INBOUND for a provider reply row", () => {
    const result = mapConversationRow(
      makeRow({
        direction: "INBOUND",
        content: "Thank you. We can offer $40/bottle.",
      }),
    );
    expect(result.direction).toBe("INBOUND");
    expect(result.draftContent).toContain("$40/bottle");
  });

  it("defaults direction to OUTBOUND when column is null", () => {
    const result = mapConversationRow(makeRow({ direction: null }));
    expect(result.direction).toBe("OUTBOUND");
  });

  it("returns rollingSummary when present", () => {
    const summary =
      "Provider agreed to $42/bottle, 6 bottles, delivery in 5 days.";
    const result = mapConversationRow(makeRow({ rolling_summary: summary }));
    expect(result.rollingSummary).toBe(summary);
  });

  it("returns null rollingSummary when not set", () => {
    const result = mapConversationRow(makeRow({ rolling_summary: null }));
    expect(result.rollingSummary).toBeNull();
  });

  it("includes all required fields", () => {
    const result = mapConversationRow(makeRow());
    expect(result).toMatchObject({
      id: expect.any(String),
      orderId: "order-1",
      status: "SENT",
      direction: expect.stringMatching(/^(OUTBOUND|INBOUND)$/),
      emailType: "PRICE_INQUIRY",
      roundCount: 1,
      providerName: "Bordeaux Suppliers",
      providerEmail: "supplier@bordeaux.com",
      wineName: "Chateau Margaux 2018",
    });
  });

  it("maps draftContent from content field (preferred over message_text)", () => {
    const row = makeRow({
      content: "Content field value",
      message_text: "Fallback text",
    });
    const result = mapConversationRow(row);
    expect(result.draftContent).toBe("Content field value");
  });

  it("falls back to message_text when content is null", () => {
    const row = makeRow({ content: null, message_text: "Fallback text" });
    const result = mapConversationRow(row);
    expect(result.draftContent).toBe("Fallback text");
  });
});

// ─── Business logic: negotiation summary visibility ───────────────────────────

describe("Negotiation approval summary visibility logic (handleApprove)", () => {
  it("hasNegotiation=true when at least one INBOUND conversation exists", () => {
    const conversations: Array<{
      direction: string;
      status: string;
      rollingSummary: string | null;
    }> = [
      { direction: "OUTBOUND", status: "SENT", rollingSummary: null },
      { direction: "INBOUND", status: "SENT", rollingSummary: null },
    ];
    const hasProviderReply = conversations.some(
      (c) => c.direction === "INBOUND",
    );
    expect(hasProviderReply).toBe(true);
  });

  it("hasNegotiation=false when all conversations are OUTBOUND", () => {
    const conversations: Array<{
      direction: string;
      status: string;
      rollingSummary: string | null;
    }> = [
      { direction: "OUTBOUND", status: "SENT", rollingSummary: null },
      {
        direction: "OUTBOUND",
        status: "PENDING_APPROVAL",
        rollingSummary: null,
      },
    ];
    const hasProviderReply = conversations.some(
      (c) => c.direction === "INBOUND",
    );
    expect(hasProviderReply).toBe(false);
  });

  it("hasNegotiation=false when conversations array is empty", () => {
    const conversations: Array<{
      direction: string;
      status: string;
      rollingSummary: string | null;
    }> = [];
    const hasProviderReply = conversations.some(
      (c) => c.direction === "INBOUND",
    );
    expect(hasProviderReply).toBe(false);
  });

  it("picks the most recent outbound rolling summary", () => {
    const conversations = [
      {
        direction: "OUTBOUND",
        status: "SENT",
        rollingSummary: "Round 1 summary",
      },
      { direction: "INBOUND", status: "SENT", rollingSummary: null },
      {
        direction: "OUTBOUND",
        status: "PENDING_APPROVAL",
        rollingSummary: "Round 2 summary",
      },
    ];

    const latestSummary =
      [...conversations]
        .reverse()
        .find((c) => c.direction !== "INBOUND" && c.rollingSummary)
        ?.rollingSummary ?? "";

    expect(latestSummary).toBe("Round 2 summary");
  });

  it("skips INBOUND entries when looking for rolling summary", () => {
    const conversations = [
      {
        direction: "OUTBOUND",
        status: "SENT",
        rollingSummary: "Outbound summary",
      },
      {
        direction: "INBOUND",
        status: "SENT",
        rollingSummary: "Provider reply text",
      },
    ];

    const latestSummary =
      [...conversations]
        .reverse()
        .find((c) => c.direction !== "INBOUND" && c.rollingSummary)
        ?.rollingSummary ?? "";

    // Should pick the OUTBOUND summary, not the inbound reply text
    expect(latestSummary).toBe("Outbound summary");
  });

  it("returns empty string when no rolling summary exists on any outbound conv", () => {
    const conversations = [
      { direction: "OUTBOUND", status: "SENT", rollingSummary: null },
      { direction: "INBOUND", status: "SENT", rollingSummary: null },
    ];

    const latestSummary =
      [...conversations]
        .reverse()
        .find((c) => c.direction !== "INBOUND" && c.rollingSummary)
        ?.rollingSummary ?? "";

    expect(latestSummary).toBe("");
  });
});

// ─── The summary's provenance ─────────────────────────────────────────────────

/*
 * WHAT USED TO BE HERE, AND WHY IT IS NOT A REGRESSION TO DELETE IT.
 *
 * Four cases asserted `OrderApprovalModal`'s visibility rule —
 * `hasNegotiation && conversationSummary` — i.e. that an ABSENT summary made
 * the whole section disappear. That component was deleted on 2026-09-05 and its
 * rule was deliberately reversed with it: `pages/orders/next/ResponsesSheet`
 * always shows the section and prints `NO_SUMMARY_WRITTEN` where the sentence
 * would be. A panel that vanishes when nothing was written is read as "nothing
 * to worry about" rather than "nobody wrote this down" — the
 * absence-reported-as-health shape, on the one field that carries what a vendor
 * actually said. Keeping the four cases would have left the gateway's own suite
 * asserting a rule the house had just retired, about a file that no longer
 * exists.
 *
 * What replaces them is the half this service is actually responsible for: the
 * summary and its provenance survive the mapping unchanged, and an absent
 * provenance maps to null rather than to a plausible-looking default.
 */

describe("the summary carries its provenance out of the mapping", () => {
  it("passes the engine and the time it read, when the row records them", () => {
    const result = mapConversationRow(
      makeRow({
        direction: "INBOUND",
        rolling_summary: "Vendor holds $420 per case of 12 through Friday.",
        conversation_context: {
          model: "claude-haiku-4-5",
          analyzed_at: "2026-09-03T11:02:00.000Z",
        },
      }),
    );
    expect(result.rollingSummary).toBe(
      "Vendor holds $420 per case of 12 through Friday.",
    );
    expect(result.summaryModel).toBe("claude-haiku-4-5");
    expect(result.summaryAnalyzedAt).toBe("2026-09-03T11:02:00.000Z");
  });

  it("maps an absent provenance to null, never to a default engine name", () => {
    const result = mapConversationRow(
      makeRow({ direction: "INBOUND", rolling_summary: "Vendor replied." }),
    );
    expect(result.rollingSummary).toBe("Vendor replied.");
    expect(result.summaryModel).toBeNull();
    expect(result.summaryAnalyzedAt).toBeNull();
  });

  it("does not invent provenance for a row that has no summary", () => {
    const result = mapConversationRow(
      makeRow({ direction: "INBOUND", rolling_summary: null }),
    );
    expect(result.rollingSummary).toBeNull();
    expect(result.summaryModel).toBeNull();
  });
});
