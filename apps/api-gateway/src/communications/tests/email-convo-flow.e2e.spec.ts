/**
 * E2E: Real Email Conversation Flow
 *
 * Tests the full procurement email negotiation pipeline:
 *   1. Create a test order + PENDING_APPROVAL conversation in Supabase
 *   2. Approve the AI draft → real email sent to vendor via GmailService
 *   3. Simulate provider inbound reply (mirrors what EmailParsingAgent does)
 *   4. Verify GET /orders/:id/conversations returns OUTBOUND + INBOUND with direction field
 *   5. Verify the approval summary (hasNegotiation + rollingSummary) logic fires correctly
 *   6. Cleanup all test rows
 *
 * Run (dry — skips DB steps if no restaurant has inventory):
 *   cd apps/api-gateway
 *   npx jest --testPathPattern email-convo-flow --runInBand --forceExit
 *
 * Run against a real restaurant (Steps 1–6 fully execute):
 *   E2E_RESTAURANT_ID=<uuid> npx jest --testPathPattern email-convo-flow --runInBand --forceExit
 *
 * For a live Gmail send the account must be configured in .env:
 *   GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN
 * Without them the email step is skipped but all DB assertions still run.
 */

import { Test, TestingModule } from "@nestjs/testing";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { GmailService } from "../gmail.service";
import { DatabaseService } from "../../database/database.service";
import { vendorOutboundTemplate } from "../email-templates/vendor-action.template";

// ─── Config ──────────────────────────────────────────────────────────────────

const VENDOR_EMAIL = "konukald@msu.edu";
const MANAGER_EMAIL = "aldemirkonuk2004@gmail.com";
const WINE_NAME = "Opus One 2019";
const QUANTITY = 6;
const PRICE = 320;

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Derive the summary/hasNegotiation flags from a conversation list (mirrors Orders.tsx handleApprove) */
function deriveApprovalData(
  conversations: Array<{ direction: string; rollingSummary: string | null }>,
) {
  const hasProviderReply = conversations.some((c) => c.direction === "INBOUND");
  const latestSummary =
    [...conversations]
      .reverse()
      .find((c) => c.direction !== "INBOUND" && c.rollingSummary)
      ?.rollingSummary ?? "";
  return {
    hasNegotiation: hasProviderReply,
    conversationSummary: latestSummary,
  };
}

// ─── Suite ───────────────────────────────────────────────────────────────────

describe("Real Email Conversation Flow (E2E)", () => {
  let module: TestingModule;
  let gmail: GmailService;
  let db: DatabaseService;
  let cfg: ConfigService;

  // IDs created during the test — cleaned up in afterAll
  let restaurantId: string;
  let providerId: string | null = null;
  let inventoryId: string | null = null;
  let orderId: string;
  let outboundConvId: string;
  let inboundConvId: string;

  // ── Setup ──────────────────────────────────────────────────────────────────
  beforeAll(async () => {
    module = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({
          isGlobal: true,
          envFilePath: [".env", ".env.local", "../../.env"],
        }),
      ],
      providers: [GmailService, DatabaseService],
    }).compile();

    gmail = module.get(GmailService);
    db = module.get(DatabaseService);
    cfg = module.get(ConfigService);

    await module.init();

    // Resolve the test restaurant (first one found, or the default UUID)
    restaurantId =
      process.env.E2E_RESTAURANT_ID ||
      cfg.get<string>("DEFAULT_RESTAURANT_ID") ||
      "00000000-0000-0000-0000-000000000001";

    // Try to find a provider with this vendor email already in the DB
    const { data: provRows } = await db.supabase
      .from("providers")
      .select("id")
      .eq("contact_email", VENDOR_EMAIL)
      .eq("restaurant_id", restaurantId)
      .limit(1);
    providerId = provRows?.[0]?.id ?? null;

    // Find any inventory item for this restaurant to use as inventory_id
    const { data: invRows } = await db.supabase
      .from("restaurant_inventory")
      .select("id")
      .eq("restaurant_id", restaurantId)
      .limit(1);
    inventoryId = invRows?.[0]?.id ?? null;
  }, 30_000);

  afterAll(async () => {
    // Best-effort cleanup of test rows — failures here are non-fatal
    if (inboundConvId) {
      await db.supabase
        .from("procurement_conversations")
        .delete()
        .eq("id", inboundConvId);
    }
    if (outboundConvId) {
      await db.supabase
        .from("procurement_conversations")
        .delete()
        .eq("id", outboundConvId);
    }
    if (orderId) {
      await db.supabase.from("procurement_orders").delete().eq("id", orderId);
    }
    await module?.close();
  }, 15_000);

  // ── STEP 1: Create test order ──────────────────────────────────────────────
  it("Step 1 — creates a test procurement order in pending_approval status", async () => {
    // inventory_id is required — skip with a clear message if the restaurant has no inventory
    if (!inventoryId) {
      console.warn(
        "[Step 1] No inventory items found for restaurant — skipping DB-dependent steps",
      );
      return;
    }

    const orderNumber = `E2E-FLOW-${Date.now()}`;

    const { data, error } = await db.supabase
      .from("procurement_orders")
      .insert({
        restaurant_id: restaurantId,
        provider_id: providerId,
        inventory_id: inventoryId,
        order_number: orderNumber,
        quantity: QUANTITY,
        quoted_price: PRICE,
        unit_type: "bottles",
        status: "pending_approval",
        requested_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
    orderId = data!.id;

    console.log(`[Step 1] Order created: ${orderId} (${orderNumber})`);
  }, 15_000);

  // ── STEP 2: Create outbound AI draft conversation ──────────────────────────
  it("Step 2 — inserts an OUTBOUND PENDING_APPROVAL conversation (AI draft)", async () => {
    if (!orderId) {
      console.warn("[Step 2] No orderId — skipped");
      return;
    }
    expect(orderId).toBeTruthy();

    const draftBody = `Dear ${VENDOR_EMAIL.split("@")[0]},

We would like to inquire about placing an order for ${WINE_NAME} — ${QUANTITY} bottles at approximately $${PRICE}/bottle.

Could you please confirm availability and delivery timeline?

Best regards,
WineOps AI`;

    const { data, error } = await db.supabase
      .from("procurement_conversations")
      .insert({
        restaurant_id: restaurantId,
        order_id: orderId,
        provider_id: providerId,
        direction: "OUTBOUND",
        outbound_email_type: "PRICE_INQUIRY",
        status: "PENDING_APPROVAL",
        round_count: 1,
        content: draftBody,
      })
      .select("id")
      .single();

    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
    outboundConvId = data!.id;

    console.log(`[Step 2] Outbound draft created: ${outboundConvId}`);
  }, 15_000);

  // ── STEP 3: Approve draft — send real email via GmailService ──────────────
  it("Step 3 — sends the vendor outbound email (real Gmail send if configured)", async () => {
    if (!outboundConvId) {
      console.warn("[Step 3] No outboundConvId — skipped");
      return;
    }
    expect(outboundConvId).toBeTruthy();

    const html = vendorOutboundTemplate({
      recipientName: "Vendor",
      bodyHtml: `<p>Dear Vendor,</p>
<p>We are interested in ordering <strong>${WINE_NAME} — ${QUANTITY} bottles</strong> at ~$${PRICE}/bottle.</p>
<p>Please confirm availability and pricing. <em>This is an automated E2E test email — no action required.</em></p>`,
      orderId,
      orderNumber: `E2E-FLOW-${orderId.slice(-6)}`,
      wineName: WINE_NAME,
      quantity: QUANTITY,
      restaurantName: "WineOps Test Restaurant",
      senderName: "WineOps AI",
      senderTitle: "Automated Procurement",
      senderEmail: MANAGER_EMAIL,
    });

    const result = await gmail.sendEmail({
      to: [VENDOR_EMAIL],
      cc: [MANAGER_EMAIL],
      subject: `[E2E Test] Wine Inquiry: ${WINE_NAME} × ${QUANTITY} — ${orderId.slice(-8)}`,
      html,
    });

    if (result.success) {
      console.log(
        `[Step 3] Email SENT → ${VENDOR_EMAIL} | MessageID: ${result.messageId}`,
      );
      console.log(`         CC: ${MANAGER_EMAIL}`);
      console.log(
        `         ✉  Reply to this email from ${VENDOR_EMAIL} to trigger inbound flow.`,
      );
    } else {
      console.warn(
        `[Step 3] Email send skipped/failed (Gmail not configured): ${result.error}`,
      );
    }

    // Update the outbound conversation to SENT
    const { error: updateErr } = await db.supabase
      .from("procurement_conversations")
      .update({ status: "SENT", sent_at: new Date().toISOString() })
      .eq("id", outboundConvId);

    expect(updateErr).toBeNull();
    console.log(`[Step 3] Outbound conversation marked SENT`);
  }, 20_000);

  // ── STEP 4: Simulate inbound provider reply ────────────────────────────────
  it("Step 4 — simulates provider inbound reply (mirrors EmailParsingAgent output)", async () => {
    if (!orderId) {
      console.warn("[Step 4] No orderId — skipped");
      return;
    }
    expect(orderId).toBeTruthy();

    const replyBody = `Hello,

Thank you for your inquiry. We have ${WINE_NAME} available.

Pricing: $${PRICE - 10}/bottle for ${QUANTITY}+ bottles.
Delivery: 3–5 business days.

Please confirm and we will issue an invoice.

Best regards,
${VENDOR_EMAIL}`;

    const summary = `Provider confirmed availability of ${WINE_NAME} at $${PRICE - 10}/bottle. Delivery 3–5 business days. Awaiting manager confirmation.`;

    const { data, error } = await db.supabase
      .from("procurement_conversations")
      .insert({
        restaurant_id: restaurantId,
        order_id: orderId,
        provider_id: providerId,
        direction: "INBOUND",
        status: "SENT",
        round_count: 1,
        content: replyBody,
        rolling_summary: summary,
      })
      .select("id")
      .single();

    expect(error).toBeNull();
    expect(data?.id).toBeTruthy();
    inboundConvId = data!.id;

    console.log(`[Step 4] Inbound reply simulated: ${inboundConvId}`);
    console.log(`         Summary: "${summary}"`);
  }, 15_000);

  // ── STEP 5: Verify GET /orders/:id/conversations returns both entries ───────
  it("Step 5 — GET conversations returns OUTBOUND + INBOUND with correct direction fields", async () => {
    if (!orderId || !outboundConvId || !inboundConvId) {
      console.warn("[Step 5] Prerequisites missing — skipped");
      return;
    }
    expect(orderId).toBeTruthy();
    expect(outboundConvId).toBeTruthy();
    expect(inboundConvId).toBeTruthy();

    const { data, error } = await db.supabase
      .from("procurement_conversations")
      .select("id, direction, status, content, rolling_summary, round_count")
      .eq("restaurant_id", restaurantId)
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });

    expect(error).toBeNull();
    expect(data).toBeDefined();
    expect(data!.length).toBeGreaterThanOrEqual(2);

    const outbound = data!.find((c) => c.id === outboundConvId);
    const inbound = data!.find((c) => c.id === inboundConvId);

    // Direction field is returned
    expect(outbound).toBeDefined();
    expect(outbound!.direction).toBe("OUTBOUND");
    expect(outbound!.status).toBe("SENT");

    expect(inbound).toBeDefined();
    expect(inbound!.direction).toBe("INBOUND");
    expect(inbound!.rolling_summary).toContain(WINE_NAME);

    console.log(`[Step 5] Conversations returned: ${data!.length} rows`);
    console.log(`         OUTBOUND: ${outbound!.id} (${outbound!.status})`);
    console.log(`         INBOUND:  ${inbound!.id} (${inbound!.direction})`);
  }, 15_000);

  // ── STEP 6: Verify approval summary logic fires correctly ──────────────────
  it("Step 6 — deriveApprovalData returns hasNegotiation=true and real rolling summary", async () => {
    if (!orderId) {
      console.warn("[Step 6] No orderId — skipped");
      return;
    }
    const { data } = await db.supabase
      .from("procurement_conversations")
      .select("direction, rolling_summary")
      .eq("order_id", orderId)
      .order("created_at", { ascending: true });

    const convs = (data ?? []).map((r) => ({
      direction: (r.direction ?? "OUTBOUND") as string,
      rollingSummary: r.rolling_summary ?? null,
    }));

    const { hasNegotiation, conversationSummary } = deriveApprovalData(convs);

    expect(hasNegotiation).toBe(true);
    expect(conversationSummary).toBeTruthy();
    expect(conversationSummary).toContain(WINE_NAME);

    // Modal visibility: should render summary section
    const shouldShowSummary = hasNegotiation && !!conversationSummary;
    expect(shouldShowSummary).toBe(true);

    console.log(`[Step 6] hasNegotiation=${hasNegotiation}`);
    console.log(`         conversationSummary="${conversationSummary}"`);
    console.log(`         Modal summary section visible: ${shouldShowSummary}`);
  }, 15_000);

  // ── STEP 7: Verify summary hidden before provider reply ───────────────────
  it("Step 7 — hasNegotiation=false when only OUTBOUND conversations exist", () => {
    const outboundOnly = [
      {
        direction: "OUTBOUND",
        rollingSummary: "Round 1 draft ready for approval",
      },
    ];

    const { hasNegotiation, conversationSummary } =
      deriveApprovalData(outboundOnly);

    expect(hasNegotiation).toBe(false);
    // Summary section should be hidden (invisible) on first-round approval
    expect(hasNegotiation && !!conversationSummary).toBe(false);

    console.log(
      `[Step 7] Pre-reply: hasNegotiation=${hasNegotiation} → summary section hidden ✓`,
    );
  });
});
