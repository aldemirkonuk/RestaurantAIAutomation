/**
 * The two unsealed doors on /procurement, closed (ADR 0175 D9/D10; founder,
 * 2026-09-21: "Close the three unsealed doors in the same pass: manual-reply,
 * confirm-deal, and /conversations/:id/approve ... with an actor recorded").
 *
 * Until this date `manualReply` and `confirmDeal` took no user id: no role
 * check, no seal, no actor. A staff member refused on a drafted reply could
 * paste the same words into "Send reply", or commit money at a price from the
 * request body, and nobody's name was recorded.
 *
 * Real: ProcurementService, VendorSendAuthorityService and SealChallengeService
 * over one in-memory store. Doubles: Gmail (nothing may leave) and the bell.
 */

import { ProcurementService } from "./procurement.service";
import { SealChallengeService } from "../common/seal/seal-challenge.service";
import { VendorSendAuthorityService } from "../organizations/vendor-send-authority.service";
import {
  FakeDb,
  fakeNotifications,
  recorder,
} from "../notifications/producers/testing/fake-db";

const HOUSE = "house-1";
const ORDER = "order-1";
const MANAGER = "u-manager";
const STAFF = "u-staff";
const OWNER = "u-owner";
const GRANTEE = "u-grantee";
const VENDOR = "vendor@kavaklidere.example";

function build() {
  const db = new FakeDb();
  db.tables.users = [
    { user_id: OWNER, name: "Olcay Owner", restaurant_id: HOUSE, role: "owner" },
    { user_id: MANAGER, name: "Mert Manager", restaurant_id: HOUSE, role: "manager" },
    { user_id: STAFF, name: "Ayse Staff", restaurant_id: HOUSE, role: "staff" },
    { user_id: GRANTEE, name: "Gul Grantee", restaurant_id: HOUSE, role: "staff" },
  ];
  db.tables.user_restaurant_access = [
    { user_id: OWNER, restaurant_id: HOUSE, role: "owner", is_active: true },
    { user_id: MANAGER, restaurant_id: HOUSE, role: "manager", is_active: true },
    { user_id: STAFF, restaurant_id: HOUSE, role: "staff", is_active: true },
    { user_id: GRANTEE, restaurant_id: HOUSE, role: "staff", is_active: true },
  ];
  db.tables.procurement_orders = [
    {
      id: ORDER,
      restaurant_id: HOUSE,
      provider_id: "prov-1",
      inventory_id: null,
      status: "NEGOTIATING",
      quantity: 6,
      bottles_total: 6,
      quoted_price: 200,
      negotiated_price: null,
      final_price: null,
      currency: "TRY",
      providers: {
        name: "Kavaklidere",
        contact_email: VENDOR,
        contact_first_name: "Hasan",
        primary_contact: {},
        restaurant_id: HOUSE,
      },
      restaurant_inventory: { wine_name: "Yakut" },
    },
  ];
  db.tables.procurement_conversations = [];
  db.tables.authority_grants = [];
  db.tables.mcp_seal_challenges = [];
  const database = { supabase: db, getClient: () => db, client: db } as any;
  const gmail = {
    sendEmail: recorder(async (opts: any) => ({
      success: true,
      messageId: "gmail-1",
      threadId: "thread-1",
      rfc822MessageId: opts.messageIdHeader,
    })),
  };
  const seal = new SealChallengeService(database);
  const service = new ProcurementService(
    database,
    { createEvent: async () => undefined } as any,
    { recordTransaction: async () => undefined } as any,
    undefined,
    gmail as any,
    undefined,
    undefined,
    undefined,
    fakeNotifications([OWNER, MANAGER, STAFF, GRANTEE]) as any,
    undefined,
    undefined,
    seal,
    new VendorSendAuthorityService(database),
  );
  for (const level of ["log", "warn", "error"] as const) {
    (service as any).logger[level] = () => undefined;
    (seal as any).logger[level] = () => undefined;
  }
  const order = () => db.tables.procurement_orders[0];
  return { db, gmail, service, order };
}

describe("manual-reply: sealed, gated and named", () => {
  it("sends nothing without a seal — the door that had none", async () => {
    const t = build();
    await expect(t.service.manualReply(HOUSE, ORDER, MANAGER, "Hi Hasan", [], undefined)).rejects.toThrow(/seal/i);
    expect(t.gmail.sendEmail.calls).toHaveLength(0);
    expect(t.db.tables.procurement_conversations).toHaveLength(0);
  });

  it("refuses a staff member before any seal is issued, and points at the request", async () => {
    const t = build();
    await expect(
      t.service.issueManualReplySeal(HOUSE, ORDER, STAFF, { content: "Hi Hasan" }),
    ).rejects.toThrow(/Hold again to ask a manager/);
    await expect(t.service.manualReply(HOUSE, ORDER, STAFF, "Hi Hasan", [], "x")).rejects.toThrow(
      /Hold again to ask a manager/,
    );
    expect(t.db.tables.mcp_seal_challenges).toHaveLength(0);
    expect(t.gmail.sendEmail.calls).toHaveLength(0);
  });

  it("a manager's sealed reply goes and the row records who sent it", async () => {
    const t = build();
    const { challenge } = await t.service.issueManualReplySeal(HOUSE, ORDER, MANAGER, {
      content: "Hi Hasan, Tuesday works.",
      ccEmails: ["ops@house.example"],
    });
    await t.service.manualReply(HOUSE, ORDER, MANAGER, "Hi Hasan, Tuesday works.", ["ops@house.example"], challenge);
    expect(t.gmail.sendEmail.calls).toHaveLength(1);
    expect(t.db.tables.procurement_conversations[0]).toMatchObject({
      status: "SENT",
      outbound_email_type: "MANUAL_REPLY",
      sent_by_user_id: MANAGER,
      sent_under_grant_id: null,
    });
  });

  it("words changed after the hold are refused, and nothing is sent", async () => {
    const t = build();
    const { challenge } = await t.service.issueManualReplySeal(HOUSE, ORDER, MANAGER, { content: "Six cases." });
    await expect(
      t.service.manualReply(HOUSE, ORDER, MANAGER, "Sixty cases.", [], challenge),
    ).rejects.toThrow(/changed|different/i);
    expect(t.gmail.sendEmail.calls).toHaveLength(0);
  });

  it("a copy added after the hold is refused", async () => {
    const t = build();
    const { challenge } = await t.service.issueManualReplySeal(HOUSE, ORDER, MANAGER, { content: "Six cases." });
    await expect(
      t.service.manualReply(HOUSE, ORDER, MANAGER, "Six cases.", ["x@else.example"], challenge),
    ).rejects.toThrow(/changed|different/i);
    expect(t.gmail.sendEmail.calls).toHaveLength(0);
  });

  it("a seal minted to send a DRAFT cannot post a hand-written reply", async () => {
    const t = build();
    t.db.tables.procurement_conversations.push({
      id: "draft-1",
      restaurant_id: HOUSE,
      order_id: ORDER,
      status: "PENDING_APPROVAL",
      content: "Six cases.",
      providers: { contact_email: VENDOR, restaurant_id: HOUSE },
    });
    const { challenge } = await t.service.issueDraftSendSeal(HOUSE, ORDER, MANAGER, { body: "Six cases.", to: VENDOR });
    await expect(t.service.manualReply(HOUSE, ORDER, MANAGER, "Six cases.", [], challenge)).rejects.toThrow(
      /different act|different/i,
    );
    expect(t.gmail.sendEmail.calls).toHaveLength(0);
  });
});

describe("confirm-deal: sealed, gated by money, and named", () => {
  const terms = { finalPrice: 190, quantity: 6, sendConfirmation: true };

  it("commits nothing and mails nothing without a seal", async () => {
    const t = build();
    await expect(t.service.confirmDeal(HOUSE, ORDER, MANAGER, terms, undefined)).rejects.toThrow(/seal/i);
    expect(t.order().status).toBe("NEGOTIATING");
    expect(t.gmail.sendEmail.calls).toHaveLength(0);
  });

  it("refuses a staff member — there is no request path for a deal — and says who can", async () => {
    const t = build();
    await expect(t.service.issueConfirmDealSeal(HOUSE, ORDER, STAFF, terms)).rejects.toThrow(
      /Ask an owner or a manager to do it/,
    );
    await expect(t.service.confirmDeal(HOUSE, ORDER, STAFF, terms, "x")).rejects.toThrow(/Ask an owner or a manager/);
    expect(t.order().status).toBe("NEGOTIATING");
  });

  it("a grantee whose grant names no money limit cannot commit money", async () => {
    const t = build();
    t.db.tables.authority_grants.push({
      id: "g-1", restaurant_id: HOUSE, grantor_user_id: OWNER, grantee_user_id: GRANTEE, scope: "vendor_send",
      limit_amount: null, limit_currency: null, expires_at: null, created_at: "2026-09-20T00:00:00Z", revoked_at: null,
    });
    await expect(t.service.issueConfirmDealSeal(HOUSE, ORDER, GRANTEE, terms)).rejects.toThrow(/covers letters only/);
  });

  it("a grantee over their limit is refused; within it, the seal is issued", async () => {
    const t = build();
    t.db.tables.authority_grants.push({
      id: "g-1", restaurant_id: HOUSE, grantor_user_id: OWNER, grantee_user_id: GRANTEE, scope: "vendor_send",
      limit_amount: "1000.00", limit_currency: "TRY", expires_at: null, created_at: "2026-09-20T00:00:00Z", revoked_at: null,
    });
    // 190 x 6 = 1,140 TRY > 1,000
    await expect(t.service.issueConfirmDealSeal(HOUSE, ORDER, GRANTEE, terms)).rejects.toThrow(/over the limit/);
    // 150 x 6 = 900 TRY <= 1,000
    await expect(
      t.service.issueConfirmDealSeal(HOUSE, ORDER, GRANTEE, { ...terms, finalPrice: 150 }),
    ).resolves.toMatchObject({ act: "confirm_deal" });
  });

  it("terms changed after the hold are refused before anything is written", async () => {
    const t = build();
    const { challenge } = await t.service.issueConfirmDealSeal(HOUSE, ORDER, MANAGER, terms);
    await expect(
      t.service.confirmDeal(HOUSE, ORDER, MANAGER, { ...terms, finalPrice: 19 }, challenge),
    ).rejects.toThrow(/changed|different/i);
    expect(t.order().status).toBe("NEGOTIATING");
    expect(t.gmail.sendEmail.calls).toHaveLength(0);
  });

  it("a manager's sealed confirmation commits the order in their name and names the letter's sender", async () => {
    const t = build();
    const { challenge } = await t.service.issueConfirmDealSeal(HOUSE, ORDER, MANAGER, terms);
    const out = await t.service.confirmDeal(HOUSE, ORDER, MANAGER, terms, challenge);
    expect(out.confirmed).toBe(true);
    expect(t.order()).toMatchObject({ status: "APPROVED", approved_by: MANAGER });
    const letter = t.db.tables.procurement_conversations.find((r) => r.outbound_email_type === "ORDER_CONFIRMATION");
    expect(letter).toMatchObject({ sent_by_user_id: MANAGER, sent_under_grant_id: null });
  });
});
