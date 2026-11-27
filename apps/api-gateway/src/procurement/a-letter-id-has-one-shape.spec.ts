/**
 * A letter's Message-ID has one stored shape, `<id>` (rfc822-message-id.ts).
 *
 * Rows written before 20270625100000 may still hold a bare id, and
 * threadingHeader (mime-headers.ts) keeps only `<...>` tokens, so every
 * procurement reader that hands a stored id to a reply's In-Reply-To reads it
 * in the stored shape, and every write of a sent letter's id stores it.
 *
 * Real: ProcurementService, VendorSendAuthorityService and SealChallengeService
 * over one in-memory store. Doubles: Gmail (which echoes a BARE id, the shape
 * an older transport might return) and the responder.
 */

import { ProcurementService } from "./procurement.service";
import { SealChallengeService } from "../common/seal/seal-challenge.service";
import { VendorSendAuthorityService } from "../organizations/vendor-send-authority.service";
import { VendorSendRequestsService } from "../organizations/vendor-send-requests.service";
import { installGrantLedger } from "../organizations/testing/grant-ledger-fake";
import {
  FakeDb,
  fakeNotifications,
  recorder,
} from "../notifications/producers/testing/fake-db";

const HOUSE = "house-1";
const ORDER = "order-1";
const MANAGER = "u-manager";
const STAFF = "u-staff";
const VENDOR = "vendor@kavaklidere.example";
/** The vendor's letter, stored bare by an older door. */
const BARE_INBOUND = " vendor-1@kavaklidere.example ";
const STORED = "<vendor-1@kavaklidere.example>";

function build() {
  const db = new FakeDb();
  db.tables.users = [
    { user_id: MANAGER, name: "Mert Manager", restaurant_id: HOUSE, role: "manager" },
    { user_id: STAFF, name: "Ayse Staff", restaurant_id: HOUSE, role: "staff" },
  ];
  db.tables.user_restaurant_access = [
    { user_id: MANAGER, restaurant_id: HOUSE, role: "manager", is_active: true },
    { user_id: STAFF, restaurant_id: HOUSE, role: "staff", is_active: true },
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
  db.tables.procurement_conversations = [
    {
      id: "inbound-1",
      restaurant_id: HOUSE,
      order_id: ORDER,
      provider_id: "prov-1",
      direction: "inbound",
      channel: "email",
      // Read an hour ago, so the "newer reply still being read" gate is quiet.
      created_at: new Date(Date.now() - 3_600_000).toISOString(),
      detected_intent: "counter_offer",
      gmail_thread_id: "thread-1",
      message_id: BARE_INBOUND,
      email_headers: { subject: "Re: Yakut", references: "<origin@wineops.ai>" },
    },
  ];
  db.tables.authority_grants = [];
  db.tables.mcp_seal_challenges = [];
  db.tables.vendor_send_requests = [];
  db.tables.conversation_attachments = [];
  installGrantLedger(db);
  const database = { supabase: db, getClient: () => db, client: db } as any;
  const gmail = {
    sendEmail: recorder(async (opts: any) => ({
      success: true,
      messageId: "gmail-1",
      threadId: "thread-1",
      // An echo without brackets: stored in the canonical shape all the same.
      rfc822MessageId: (opts.messageIdHeader ?? "<sent-1@wineops.ai>").replace(/[<>]/g, ""),
    })),
  };
  const responder = {
    analyzeAndDraftReply: recorder(async () => ({ draftId: "d-1", needsApproval: true })),
  };
  const seal = new SealChallengeService(database);
  const authority = new VendorSendAuthorityService(database);
  const service = new ProcurementService(
    database,
    { createEvent: async () => undefined } as any,
    { recordTransaction: async () => undefined } as any,
    undefined,
    gmail as any,
    responder as any,
    undefined,
    undefined,
    fakeNotifications([MANAGER, STAFF]) as any,
    undefined,
    undefined,
    seal,
    authority,
    new VendorSendRequestsService(database, authority),
  );
  for (const level of ["log", "warn", "error"] as const) {
    (service as any).logger[level] = () => undefined;
    (seal as any).logger[level] = () => undefined;
  }
  const outbound = () =>
    db.tables.procurement_conversations.filter((r: any) => r.direction === "outbound");
  return { db, gmail, responder, service, outbound };
}

describe("a reply to a letter stored bare still names it in In-Reply-To", () => {
  it("manual reply: In-Reply-To is <id>, and the sent letter's id is stored as <id>", async () => {
    const t = build();
    const { challenge } = await t.service.issueManualReplySeal(HOUSE, ORDER, MANAGER, {
      content: "Hi Hasan, Tuesday works.",
    });
    await t.service.manualReply(HOUSE, ORDER, MANAGER, "Hi Hasan, Tuesday works.", [], challenge);
    expect(t.gmail.sendEmail.calls).toHaveLength(1);
    expect(t.gmail.sendEmail.calls[0][0].inReplyTo).toBe(STORED);
    expect(t.outbound()[0].message_id).toBe("<sent-1@wineops.ai>");
  });

  it("deal confirmation: In-Reply-To is <id>, and the letter's id is stored as <id>", async () => {
    const t = build();
    const terms = { finalPrice: 190, quantity: 6, sendConfirmation: true };
    const { challenge } = await t.service.issueConfirmDealSeal(HOUSE, ORDER, MANAGER, terms);
    await t.service.confirmDeal(HOUSE, ORDER, MANAGER, terms, challenge);
    expect(t.gmail.sendEmail.calls).toHaveLength(1);
    expect(t.gmail.sendEmail.calls[0][0].inReplyTo).toBe(STORED);
    const letter = t.outbound().find((r: any) => r.outbound_email_type === "ORDER_CONFIRMATION");
    expect(letter?.message_id).toBe("<sent-1@wineops.ai>");
  });

  it("a staff member's asked-for reply stores In-Reply-To as <id>", async () => {
    const t = build();
    await t.service.requestDraftSend(HOUSE, ORDER, STAFF, { content: "Dear Hasan, six cases." });
    expect(t.outbound()[0].email_headers.in_reply_to).toBe(STORED);
  });

  it("the drafted reply is handed the letter's id as <id>", async () => {
    const t = build();
    await t.service.generateAiReply(HOUSE, ORDER);
    expect(t.responder.analyzeAndDraftReply.calls).toHaveLength(1);
    expect(t.responder.analyzeAndDraftReply.calls[0][0].inboundRfc822MessageId).toBe(STORED);
  });
});
