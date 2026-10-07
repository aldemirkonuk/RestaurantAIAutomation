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
  db.tables.vendor_send_requests = [];
  installGrantLedger(db);
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
  const authority = new VendorSendAuthorityService(database);
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
    authority,
    new VendorSendRequestsService(database, authority),
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

  it("refuses a staff member's confirmation, and points at the request they may make instead", async () => {
    // Founder answer 3 (2026-09-21): staff may ASK a manager to confirm a deal.
    const t = build();
    await expect(t.service.issueConfirmDealSeal(HOUSE, ORDER, STAFF, terms)).rejects.toThrow(
      /Hold again to ask a manager instead/,
    );
    await expect(t.service.confirmDeal(HOUSE, ORDER, STAFF, terms, "x")).rejects.toThrow(/ask a manager/);
    expect(t.order().status).toBe("NEGOTIATING");
  });


  it("a grantee whose grant names no money limit cannot commit money", async () => {
    const t = build();
    t.db.tables.authority_grants.push({
      id: "g-1", restaurant_id: HOUSE, grantor_user_id: OWNER, grantee_user_id: GRANTEE, scope: "vendor_send",
      limit_amount: null, limit_currency: null, expires_at: null, created_at: "2026-09-20T00:00:00Z", revoked_at: null,
      vouched_by_user_id: OWNER, suspended_at: null, deleted_at: null,
    });
    await expect(t.service.issueConfirmDealSeal(HOUSE, ORDER, GRANTEE, terms)).rejects.toThrow(/covers letters only/);
  });

  it("a grantee over their limit is refused; within it, the seal is issued", async () => {
    const t = build();
    t.db.tables.authority_grants.push({
      id: "g-1", restaurant_id: HOUSE, grantor_user_id: OWNER, grantee_user_id: GRANTEE, scope: "vendor_send",
      limit_amount: "1000.00", limit_currency: "TRY", expires_at: null, created_at: "2026-09-20T00:00:00Z", revoked_at: null,
      vouched_by_user_id: OWNER, suspended_at: null, deleted_at: null,
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

describe("staff ask a manager to confirm a deal (founder answer 3, 2026-09-21)", () => {
  const terms = { finalPrice: 190, quantity: 6, sendConfirmation: true };

  it("a staff member's ask saves the exact terms, commits nothing, mails nothing, and tells the owners and managers", async () => {
    const t = build();
    const out = await t.service.requestConfirmDeal(HOUSE, ORDER, STAFF, terms);
    expect(out.told).toBeGreaterThan(0);
    expect(t.db.tables.vendor_send_requests).toEqual([
      expect.objectContaining({
        kind: "confirm_deal",
        order_id: ORDER,
        requested_by: STAFF,
        state: "waiting",
        payload: { finalPrice: 190, quantity: 6, sendConfirmation: true },
      }),
    ]);
    expect(t.order().status).toBe("NEGOTIATING");
    expect(t.gmail.sendEmail.calls).toHaveLength(0);
    const notices = t.db.tables.notifications.filter((n) => n.type === "vendor_deal_requested");
    expect(notices.map((n) => n.user_id).sort()).toEqual([MANAGER, OWNER].sort());
    // Bell only, and a push could only ever say the nameless sentence (founder answer 5).
    expect(notices.every((n) => n.priority === "low" && n.metadata.lockScreenText === "A letter is waiting for your approval")).toBe(true);
  });

  it("a person who may confirm is not asked on their behalf", async () => {
    const t = build();
    await expect(t.service.requestConfirmDeal(HOUSE, ORDER, MANAGER, terms)).rejects.toThrow(/yourself with one hold/);
    expect(t.db.tables.vendor_send_requests).toHaveLength(0);
  });

  it("a second ask while one waits is refused, and the waiting one stands", async () => {
    const t = build();
    await t.service.requestConfirmDeal(HOUSE, ORDER, STAFF, terms);
    // The partial unique index on (order_id) WHERE kind = 'confirm_deal' AND
    // state = 'waiting' (20261116100700), modelled on this store's inserts.
    const insert = t.db.from.bind(t.db);
    (t.db as any).from = (table: string) => {
      const q = insert(table);
      if (table === "vendor_send_requests") {
        const orig = (q as any).insert.bind(q);
        (q as any).insert = (row: any) => {
          if (t.db.tables.vendor_send_requests.some((r) => r.state === "waiting" && r.order_id === row.order_id)) {
            return { select: () => ({ single: async () => ({ data: null, error: { code: "23505", message: "duplicate" } }) }) };
          }
          return orig(row);
        };
      }
      return q;
    };
    await expect(t.service.requestConfirmDeal(HOUSE, ORDER, STAFF, { ...terms, finalPrice: 180 })).rejects.toThrow(
      /already waiting/,
    );
    expect(t.db.tables.vendor_send_requests).toHaveLength(1);
  });

  it("a manager's sealed confirmation releases the waiting request, and the staffer is told it went on their terms", async () => {
    const t = build();
    await t.service.requestConfirmDeal(HOUSE, ORDER, STAFF, terms);
    const readout = await t.service.dealRequestReadout(HOUSE, ORDER, MANAGER, terms);
    expect(readout.request).toMatchObject({ requestedBy: { userId: STAFF, name: "Ayse Staff" }, payload: terms });
    expect(readout.standing).toMatchObject({ maySend: true, mode: "send" });
    const { challenge } = await t.service.issueConfirmDealSeal(HOUSE, ORDER, MANAGER, terms);
    await t.service.confirmDeal(HOUSE, ORDER, MANAGER, terms, challenge);
    expect(t.db.tables.vendor_send_requests[0]).toMatchObject({
      state: "released",
      released_by: MANAGER,
      released_as_written: true,
    });
    const told = t.db.tables.notifications.find((n) => n.type === "vendor_deal_released");
    expect(told).toMatchObject({ user_id: STAFF });
    expect(told?.message).toMatch(/as you set it/);
  });

  it("a confirmation on different terms still answers the request, and says the terms changed", async () => {
    const t = build();
    await t.service.requestConfirmDeal(HOUSE, ORDER, STAFF, terms);
    const changed = { ...terms, finalPrice: 185 };
    const { challenge } = await t.service.issueConfirmDealSeal(HOUSE, ORDER, MANAGER, changed);
    await t.service.confirmDeal(HOUSE, ORDER, MANAGER, changed, challenge);
    expect(t.db.tables.vendor_send_requests[0]).toMatchObject({ state: "released", released_as_written: false });
    expect(t.db.tables.notifications.find((n) => n.type === "vendor_deal_released")?.message).toMatch(/with their own changes/);
  });

  it("a dismissed deal closes the waiting request, so it stops waiting and the staffer can ask again", async () => {
    const t = build();
    await t.service.requestConfirmDeal(HOUSE, ORDER, STAFF, terms);
    const out = await t.service.dismissDeal(HOUSE, ORDER);
    expect(out).toEqual({ dismissed: true, requestsClosed: 1 });
    expect(t.db.tables.vendor_send_requests[0]).toMatchObject({ state: "closed", closed_reason: "deal_dismissed" });
    expect((await t.service.dealRequestReadout(HOUSE, ORDER, MANAGER, terms)).request).toBeNull();
    await t.service.requestConfirmDeal(HOUSE, ORDER, STAFF, { ...terms, finalPrice: 180 });
    expect(t.db.tables.vendor_send_requests.map((r) => r.state)).toEqual(["closed", "waiting"]);
  });

  it("a dismissal whose request cannot be closed is refused, and the request still waits", async () => {
    const t = build();
    await t.service.requestConfirmDeal(HOUSE, ORDER, STAFF, terms);
    const from = t.db.from.bind(t.db);
    (t.db as any).from = (table: string) => {
      const q = from(table);
      if (table === "vendor_send_requests") {
        (q as any).update = () => {
          const failed: any = { eq: () => failed, select: async () => ({ data: null, error: { message: "timeout" } }) };
          return failed;
        };
      }
      return q;
    };
    await expect(t.service.dismissDeal(HOUSE, ORDER)).rejects.toThrow(/could not be closed \(timeout\), so the deal was not dismissed/);
    expect(t.db.tables.vendor_send_requests[0]).toMatchObject({ state: "waiting" });
  });

  it("the readout tells a staff member their hold asks, before they hold", async () => {
    const t = build();
    const readout = await t.service.dealRequestReadout(HOUSE, ORDER, STAFF, terms);
    expect(readout.standing).toMatchObject({ maySend: false, mode: "ask" });
    expect(readout.standing.sentence).toMatch(/^Your hold will ask a manager to confirm this deal/);
  });
});

describe("a waiting deal request may be declined or withdrawn, exactly like a letter (founder, 2026-09-22, round 6z, verbatim pick 1: \"Yes, same as letters (Recommended)\")", () => {
  const terms = { finalPrice: 190, quantity: 6, sendConfirmation: true };
  const request = (t: ReturnType<typeof build>) => t.db.tables.vendor_send_requests[0];
  const noticesOf = (t: ReturnType<typeof build>, type: string) => t.db.tables.notifications.filter((n) => n.type === type);

  it("an owner or a manager declines with a reason: closed on the record, the staffer told why, and it no longer waits", async () => {
    const t = build();
    await t.service.requestConfirmDeal(HOUSE, ORDER, STAFF, terms);
    const out = await t.service.declineDealRequest(HOUSE, ORDER, MANAGER, "We already ordered from them this week.");
    expect(out).toMatchObject({ id: request(t).id, state: "closed" });
    expect(request(t)).toMatchObject({
      state: "closed",
      closed_how: "declined",
      closed_by: MANAGER,
      closed_reason: "We already ordered from them this week.",
    });
    // The pre-existing shared bell wording said "Nothing was sent" for a
    // deal too (it was built generic-first, for the letter path); fixed in
    // the same pass since this is the first caller to exercise it for a deal.
    const told = noticesOf(t, "vendor_deal_declined");
    expect(told.map((n) => n.user_id)).toEqual([STAFF]);
    expect(told[0].message).toBe(
      "Mert Manager declined your request to confirm a deal. Why: We already ordered from them this week. Nothing was confirmed.",
    );
    expect((await t.service.dealRequestReadout(HOUSE, ORDER, MANAGER, terms)).request).toBeNull();
  });

  it("staff and grantees may not decline a deal request; an owner may", async () => {
    const t = build();
    await t.service.requestConfirmDeal(HOUSE, ORDER, STAFF, terms);
    await expect(t.service.declineDealRequest(HOUSE, ORDER, GRANTEE, "no")).rejects.toThrow(/Only an owner or a manager may decline/);
    await expect(t.service.declineDealRequest(HOUSE, ORDER, STAFF, "no")).rejects.toThrow(/Only an owner or a manager may decline/);
    expect(request(t).state).toBe("waiting");
    await t.service.declineDealRequest(HOUSE, ORDER, OWNER, "Not now.");
    expect(request(t)).toMatchObject({ state: "closed", closed_by: OWNER });
  });

  it("a decline without a reason is refused and changes nothing", async () => {
    const t = build();
    await t.service.requestConfirmDeal(HOUSE, ORDER, STAFF, terms);
    await expect(t.service.declineDealRequest(HOUSE, ORDER, MANAGER, "   ")).rejects.toThrow(/A decline says why/);
    expect(request(t).state).toBe("waiting");
  });

  it("the staffer withdraws their own: closed on the record, and the owners and managers are told", async () => {
    const t = build();
    await t.service.requestConfirmDeal(HOUSE, ORDER, STAFF, terms);
    const out = await t.service.withdrawDealRequest(HOUSE, ORDER, STAFF);
    expect(out).toMatchObject({ state: "closed" });
    expect(request(t)).toMatchObject({ state: "closed", closed_how: "withdrawn", closed_by: STAFF });
    const told = noticesOf(t, "vendor_deal_withdrawn");
    expect(told.map((n) => n.user_id).sort()).toEqual([MANAGER, OWNER].sort());
    expect(told[0].message).toBe("Ayse Staff withdrew their request to confirm a deal. It no longer waits for you, and nothing was confirmed.");
  });

  it("nobody but the person who asked may withdraw it — a manager declines instead", async () => {
    const t = build();
    await t.service.requestConfirmDeal(HOUSE, ORDER, STAFF, terms);
    await expect(t.service.withdrawDealRequest(HOUSE, ORDER, MANAGER)).rejects.toThrow(/Only the person who asked may withdraw/);
    expect(request(t).state).toBe("waiting");
  });

  it("a released request cannot be declined or withdrawn after the fact", async () => {
    const t = build();
    await t.service.requestConfirmDeal(HOUSE, ORDER, STAFF, terms);
    const { challenge } = await t.service.issueConfirmDealSeal(HOUSE, ORDER, MANAGER, terms);
    await t.service.confirmDeal(HOUSE, ORDER, MANAGER, terms, challenge);
    await expect(t.service.declineDealRequest(HOUSE, ORDER, OWNER, "late")).rejects.toThrow(/already released, so it was not declined/);
    await expect(t.service.withdrawDealRequest(HOUSE, ORDER, STAFF)).rejects.toThrow(/already released, so it was not withdrawn/);
    expect(request(t).state).toBe("released");
  });

  it("no waiting deal request on this order is a 404, whether declining or withdrawing", async () => {
    const t = build();
    await expect(t.service.declineDealRequest(HOUSE, ORDER, MANAGER, "no")).rejects.toMatchObject({ status: 404 });
    await expect(t.service.withdrawDealRequest(HOUSE, ORDER, STAFF)).rejects.toMatchObject({ status: 404 });
  });
});

describe("a deal proposal is resolved only inside the caller's house (#482 merge-audit follow-up)", () => {
  // `resolveLatestDealProposal` read and wrote `procurement_conversations` by
  // order id alone, while `dealMessageFor` — which must pick the same row —
  // filtered by house too. A row carrying the same order id under another
  // house must be neither marked resolved nor discarded.
  const FOREIGN = "house-2";
  const proposal = (id: string, house: string, created_at: string) => ({
    id,
    order_id: ORDER,
    restaurant_id: house,
    direction: "inbound",
    created_at,
    conversation_context: { deal_proposal: { finalPrice: 190, quantity: 6 } },
  });

  it("dismissDeal marks this house's proposal and leaves another house's untouched", async () => {
    const t = build();
    // The foreign row is NEWER, so an unscoped read would pick it first.
    t.db.tables.procurement_conversations.push(
      proposal("conv-own", HOUSE, "2026-09-20T10:00:00Z"),
      proposal("conv-foreign", FOREIGN, "2026-09-21T10:00:00Z"),
    );
    await t.service.dismissDeal(HOUSE, ORDER);
    const byId = (id: string) => t.db.tables.procurement_conversations.find((r) => r.id === id);
    expect(byId("conv-own")?.conversation_context).toMatchObject({ deal_resolution: "dismissed" });
    expect(byId("conv-foreign")?.conversation_context?.deal_resolved_at).toBeUndefined();
    expect(byId("conv-foreign")?.conversation_context?.deal_resolution).toBeUndefined();
  });

  it("dismissDeal resolves nothing when the only proposal on the order id is another house's", async () => {
    const t = build();
    t.db.tables.procurement_conversations.push(proposal("conv-foreign", FOREIGN, "2026-09-21T10:00:00Z"));
    await t.service.dismissDeal(HOUSE, ORDER);
    expect(t.db.tables.procurement_conversations[0].conversation_context?.deal_resolved_at).toBeUndefined();
  });

  it("confirmDeal resolves and discards only this house's rows", async () => {
    const t = build();
    const terms = { finalPrice: 190, quantity: 6, sendConfirmation: false };
    t.db.tables.procurement_conversations.push(
      proposal("conv-own", HOUSE, "2026-09-20T10:00:00Z"),
      proposal("conv-foreign", FOREIGN, "2026-09-21T10:00:00Z"),
      { id: "draft-own", order_id: ORDER, restaurant_id: HOUSE, direction: "outbound", status: "PENDING_APPROVAL", created_at: "2026-09-20T11:00:00Z" },
      { id: "draft-foreign", order_id: ORDER, restaurant_id: FOREIGN, direction: "outbound", status: "PENDING_APPROVAL", created_at: "2026-09-21T11:00:00Z" },
    );
    const { challenge } = await t.service.issueConfirmDealSeal(HOUSE, ORDER, MANAGER, terms);
    await t.service.confirmDeal(HOUSE, ORDER, MANAGER, terms, challenge);
    const byId = (id: string) => t.db.tables.procurement_conversations.find((r) => r.id === id);
    expect(byId("conv-own")?.conversation_context).toMatchObject({ deal_resolution: "confirmed" });
    expect(byId("conv-foreign")?.conversation_context?.deal_resolved_at).toBeUndefined();
    expect(byId("draft-own")?.status).toBe("DISCARDED");
    expect(byId("draft-foreign")?.status).toBe("PENDING_APPROVAL");
  });
});

describe("every order-keyed conversation read on the deal and reply paths is this house's own", () => {
  // `procurement_conversations.order_id` is a plain FK to `procurement_orders(id)`
  // with nothing tying the row's `restaurant_id` to the order's house, and the
  // gateway reads with the service role, so these filters are the only fence.
  // A house letter names its order from the request body unchecked, and the
  // mail bridge threads a vendor's answer onto whatever order the letter named,
  // under the letter's house — so a row on this order id can be another house's.
  // In each case the other house's row is the NEWER one, so an unscoped read
  // picks it first; each case also carries this house's own row, so a path
  // that simply did nothing would fail.
  const FOREIGN = "house-2";
  const inbound = (id: string, house: string, created_at: string, extra: Record<string, any> = {}) => ({
    id,
    order_id: ORDER,
    restaurant_id: house,
    provider_id: house === HOUSE ? "prov-1" : "prov-foreign",
    direction: "inbound",
    created_at,
    detected_intent: "counter_offer",
    gmail_thread_id: `thread-${id}`,
    message_id: `<${id}@mail.example>`,
    email_headers: { subject: `Re: ${id}`, references: `<${id}-ref@mail.example>` },
    ...extra,
  });
  const proposal = { deal_proposal: { finalPrice: 190, quantity: 6, sourceQuote: "190 per bottle" } };

  it("getDealProposal shows this house's proposal, never another house's newer one on the same order id", async () => {
    const t = build();
    t.db.tables.procurement_conversations.push(
      inbound("conv-own", HOUSE, "2026-09-20T10:00:00Z", { conversation_context: proposal }),
      inbound("conv-foreign", FOREIGN, "2026-09-21T10:00:00Z", {
        conversation_context: { deal_proposal: { finalPrice: 99, quantity: 60, sourceQuote: "another house's terms" } },
      }),
    );
    const shown = await t.service.getDealProposal(HOUSE, ORDER);
    expect(shown).toMatchObject({ conversationId: "conv-own", finalPrice: 190, sourceQuote: "190 per bottle" });
  });

  it("getDealProposal answers null when the only proposal on the order id is another house's", async () => {
    const t = build();
    t.db.tables.procurement_conversations.push(
      inbound("conv-foreign", FOREIGN, "2026-09-21T10:00:00Z", { conversation_context: proposal }),
    );
    await expect(t.service.getDealProposal(HOUSE, ORDER)).resolves.toBeNull();
  });

  it("manual-reply threads onto this house's latest reply and discards only this house's waiting drafts", async () => {
    const t = build();
    t.db.tables.procurement_conversations.push(
      inbound("conv-own", HOUSE, "2026-09-20T10:00:00Z"),
      inbound("conv-foreign", FOREIGN, "2026-09-21T10:00:00Z"),
      { id: "draft-own", order_id: ORDER, restaurant_id: HOUSE, direction: "outbound", status: "AUTO_SEND_SCHEDULED", created_at: "2026-09-20T11:00:00Z" },
      { id: "draft-foreign", order_id: ORDER, restaurant_id: FOREIGN, direction: "outbound", status: "AUTO_SEND_SCHEDULED", created_at: "2026-09-21T11:00:00Z" },
    );
    const { challenge } = await t.service.issueManualReplySeal(HOUSE, ORDER, MANAGER, { content: "Tuesday works." });
    await t.service.manualReply(HOUSE, ORDER, MANAGER, "Tuesday works.", [], challenge);
    expect(t.gmail.sendEmail.calls).toHaveLength(1);
    expect(t.gmail.sendEmail.calls[0][0]).toMatchObject({
      subject: "Re: conv-own",
      threadId: "thread-conv-own",
      inReplyTo: "<conv-own@mail.example>",
      references: "<conv-own-ref@mail.example>",
    });
    const byId = (id: string) => t.db.tables.procurement_conversations.find((r) => r.id === id);
    expect(byId("draft-own")?.status).toBe("DISCARDED");
    expect(byId("draft-foreign")?.status).toBe("AUTO_SEND_SCHEDULED");
  });

  it("the deal confirmation letter threads onto this house's latest reply, not another house's", async () => {
    const t = build();
    const terms = { finalPrice: 190, quantity: 6, sendConfirmation: true };
    t.db.tables.procurement_conversations.push(
      inbound("conv-own", HOUSE, "2026-09-20T10:00:00Z", { conversation_context: proposal }),
      inbound("conv-foreign", FOREIGN, "2026-09-21T10:00:00Z", { conversation_context: proposal }),
    );
    const { challenge } = await t.service.issueConfirmDealSeal(HOUSE, ORDER, MANAGER, terms);
    await t.service.confirmDeal(HOUSE, ORDER, MANAGER, terms, challenge);
    expect(t.gmail.sendEmail.calls).toHaveLength(1);
    expect(t.gmail.sendEmail.calls[0][0]).toMatchObject({
      subject: "Re: conv-own",
      threadId: "thread-conv-own",
      inReplyTo: "<conv-own@mail.example>",
      references: "<conv-own-ref@mail.example>",
    });
  });

  // The mail bridge lets a Gmail thread name an order only when the thread's
  // earliest row is outbound with no email_headers.in_reply_to
  // (rabbitmq-bridge.service.ts handleInboundEmail, step 2). A confirmation
  // whose send opened a new thread is that thread's earliest row, and its
  // order may be the bridge's guess, so the row records the reply it answers.
  it("the deal confirmation row records the reply headers it was sent with when it has a Gmail thread id", async () => {
    const t = build();
    const terms = { finalPrice: 190, quantity: 6, sendConfirmation: true };
    t.db.tables.procurement_conversations.push(
      inbound("conv-own", HOUSE, "2026-09-20T10:00:00Z", {
        conversation_context: proposal,
      }),
    );
    const { challenge } = await t.service.issueConfirmDealSeal(
      HOUSE,
      ORDER,
      MANAGER,
      terms,
    );
    await t.service.confirmDeal(HOUSE, ORDER, MANAGER, terms, challenge);
    const letter = t.db.tables.procurement_conversations.find(
      (r) => r.outbound_email_type === "ORDER_CONFIRMATION",
    );
    expect(letter?.gmail_thread_id).toBe("thread-1");
    expect(letter?.email_headers).toEqual({
      subject: "Re: conv-own",
      in_reply_to: "<conv-own@mail.example>",
      references: "<conv-own-ref@mail.example>",
    });
  });

  // With no Gmail thread id, set_conversation_thread_key would derive the
  // row's thread_key from reply headers instead of its subject, which would
  // move it to another /communications thread. Such a row is never a thread
  // the bridge can look up, so it records only its subject, as before.
  it("a deal confirmation row with no Gmail thread id records only its subject", async () => {
    const t = build();
    const terms = { finalPrice: 190, quantity: 6, sendConfirmation: true };
    t.gmail.sendEmail = recorder(async () => ({ success: true }));
    t.db.tables.procurement_conversations.push(
      inbound("conv-own", HOUSE, "2026-09-20T10:00:00Z", {
        conversation_context: proposal,
        gmail_thread_id: null,
      }),
    );
    const { challenge } = await t.service.issueConfirmDealSeal(
      HOUSE,
      ORDER,
      MANAGER,
      terms,
    );
    await t.service.confirmDeal(HOUSE, ORDER, MANAGER, terms, challenge);
    expect(t.gmail.sendEmail.calls).toHaveLength(1);
    const letter = t.db.tables.procurement_conversations.find(
      (r) => r.outbound_email_type === "ORDER_CONFIRMATION",
    );
    expect(letter?.gmail_thread_id).toBeNull();
    expect(letter?.email_headers).toEqual({ subject: "Re: conv-own" });
  });

  it("another house's reply still being read does not hold this house's confirmation; this house's own does", async () => {
    const terms = { finalPrice: 190, quantity: 6, sendConfirmation: false };
    const justNow = () => new Date().toISOString();

    const held = build();
    held.db.tables.procurement_conversations.push(
      inbound("conv-own", HOUSE, justNow(), { detected_intent: null }),
    );
    const heldSeal = await held.service.issueConfirmDealSeal(HOUSE, ORDER, MANAGER, terms);
    await expect(
      held.service.confirmDeal(HOUSE, ORDER, MANAGER, terms, heldSeal.challenge),
    ).rejects.toThrow(/still reading it/);
    expect(held.order().status).toBe("NEGOTIATING");

    const t = build();
    t.db.tables.procurement_conversations.push(
      inbound("conv-foreign", FOREIGN, justNow(), { detected_intent: null }),
    );
    const { challenge } = await t.service.issueConfirmDealSeal(HOUSE, ORDER, MANAGER, terms);
    await expect(t.service.confirmDeal(HOUSE, ORDER, MANAGER, terms, challenge)).resolves.toMatchObject({
      confirmed: true,
    });
    expect(t.order().status).toBe("APPROVED");
  });

  it("generate-reply hands the responder this house's latest reply, and finds none when only another house's exists", async () => {
    const asked: any[] = [];
    const withResponder = () => {
      const t = build();
      t.db.tables.conversation_attachments = [];
      (t.service as any).inboundResponder = {
        analyzeAndDraftReply: async (args: any) => {
          asked.push(args);
          return { drafted: true, draftId: "d-1", needsApproval: true, autoSendScheduled: false };
        },
      };
      return t;
    };

    const t = withResponder();
    t.db.tables.procurement_conversations.push(
      inbound("conv-own", HOUSE, "2026-09-20T10:00:00Z"),
      inbound("conv-foreign", FOREIGN, "2026-09-21T10:00:00Z"),
    );
    await t.service.generateAiReply(HOUSE, ORDER);
    expect(asked).toHaveLength(1);
    expect(asked[0]).toMatchObject({
      inboundConversationId: "conv-own",
      restaurantId: HOUSE,
      providerId: "prov-1",
      gmailThreadId: "thread-conv-own",
      inboundSubject: "Re: conv-own",
    });

    const only = withResponder();
    only.db.tables.procurement_conversations.push(inbound("conv-foreign", FOREIGN, "2026-09-21T10:00:00Z"));
    await expect(only.service.generateAiReply(HOUSE, ORDER)).resolves.toMatchObject({
      triggered: false,
      reason: "No inbound vendor reply found for this order",
    });
    expect(asked).toHaveLength(1);
  });

  it("a scheduled auto-send is held by this house's newer reply, and not by another house's", async () => {
    const scheduled = {
      id: "auto-1",
      order_id: ORDER,
      restaurant_id: HOUSE,
      provider_id: "prov-1",
      direction: "outbound",
      status: "AUTO_SEND_SCHEDULED",
      scheduled_send_at: "2026-09-20T09:00:00Z",
      content: "Six cases, Tuesday.",
      email_headers: { subject: "Re: Yakut" },
      created_at: "2026-09-20T08:00:00Z",
    };

    const held = build();
    held.db.tables.procurement_conversations.push(
      { ...scheduled },
      inbound("conv-own", HOUSE, "2026-09-20T08:30:00Z"),
    );
    await held.service.processScheduledAutoSends();
    expect(held.db.tables.procurement_conversations.find((r) => r.id === "auto-1")?.status).toBe("PENDING_APPROVAL");
    expect(held.gmail.sendEmail.calls).toHaveLength(0);

    const t = build();
    t.db.tables.procurement_conversations.push(
      { ...scheduled },
      inbound("conv-foreign", FOREIGN, "2026-09-20T08:30:00Z"),
    );
    await t.service.processScheduledAutoSends();
    expect(t.db.tables.procurement_conversations.find((r) => r.id === "auto-1")?.status).toBe("AUTO_SENT");
    expect(t.gmail.sendEmail.calls).toHaveLength(1);
  });

  it("a scheduled auto-send with a blank the send cannot fill is held unsent (ORD-W7)", async () => {
    const t = build();
    t.db.tables.procurement_conversations.push({
      id: "auto-2",
      order_id: ORDER,
      restaurant_id: HOUSE,
      provider_id: "prov-1",
      direction: "outbound",
      status: "AUTO_SEND_SCHEDULED",
      scheduled_send_at: "2026-09-20T09:00:00Z",
      content: "Six cases by [Delivery Date].",
      email_headers: { subject: "Re: Yakut" },
      created_at: "2026-09-20T08:00:00Z",
    });
    await t.service.processScheduledAutoSends();
    expect(t.db.tables.procurement_conversations.find((r) => r.id === "auto-2")?.status).toBe("PENDING_APPROVAL");
    expect(t.gmail.sendEmail.calls).toHaveLength(0);
  });
});
