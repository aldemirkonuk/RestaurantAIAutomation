/**
 * "Staff ask, manager sends" — the founder's answer of 2026-09-21, end to end
 * through the REAL gates.
 *
 *   *"the draft-send seal is REQUIRED on every vendor send now ... An owner, a
 *   manager, or a person an owner has granted sends with one hold. When a staff
 *   member holds, the letter becomes a REQUEST: save the staffer's exact edited
 *   text as the version, record who asked, mark the draft waiting for a
 *   manager, notify managers and owners (web bell now); a manager releases it
 *   with one hold over that exact text; an edit is a new version needing a new
 *   seal; the staffer sees who sent it."*
 *
 * WHAT IS REAL HERE, AND WHAT IS NOT
 * ---------------------------------
 * Real: `ProcurementService` (the request, the mint, the send, the readouts),
 * `VendorSendAuthorityService` (the role and grant reads and the decision) and
 * `SealChallengeService` (issue and redeem, single use, the args hash) — all
 * over one in-memory store (`FakeDb`, the producers' Postgres-shaped fake).
 * Doubles: Gmail (the vendor's mailbox — nothing may leave the test) and the
 * notifications funnel (the bell), both recorders. Neither is the unit under
 * test; both are asserted on as the OUTPUT of the unit.
 */

import { ForbiddenException, ConflictException } from "@nestjs/common";
import { ProcurementService } from "./procurement.service";
import { SealChallengeService } from "../common/seal/seal-challenge.service";
import { VendorSendAuthorityService } from "../organizations/vendor-send-authority.service";
import { letterVersionHash } from "./order-seal";
import { installGrantLedger } from "../organizations/testing/grant-ledger-fake";
import {
  FakeDb,
  fakeNotifications,
  recorder,
} from "../notifications/producers/testing/fake-db";

const HOUSE = "house-1";
const ORDER = "order-1";
const OWNER = "u-owner";
const MANAGER = "u-manager";
const STAFF = "u-staff";
const GRANTEE = "u-grantee";
const VENDOR = "vendor@kavaklidere.example";
const ENGINE_WORDS = "Dear Hasan,\n\nWe can take six cases at 2,400.\n\nBest";
const STAFF_WORDS = "Dear Hasan,\n\nWe can take six cases at 2,400, delivered Tuesday.\n\nAyse";

function seed(db: FakeDb) {
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
  db.tables.procurement_conversations = [
    {
      id: "draft-1",
      restaurant_id: HOUSE,
      order_id: ORDER,
      direction: "outbound",
      status: "PENDING_APPROVAL",
      content: ENGINE_WORDS,
      created_at: new Date(Date.now() - 60_000).toISOString(),
      gmail_thread_id: null,
      message_id: null,
      email_headers: { subject: "Re: Order" },
      providers: { name: "Kavaklidere", contact_email: VENDOR, restaurant_id: HOUSE },
      procurement_orders: { order_number: "ORD-1", inventory: { wine_name: "Yakut" } },
    },
  ];
  db.tables.authority_grants = [];
  db.tables.mcp_seal_challenges = [];
  installGrantLedger(db);
}

function build() {
  const db = new FakeDb();
  seed(db);
  const database = { supabase: db, getClient: () => db, client: db } as any;
  const gmail = {
    sendEmail: recorder(async (opts: any) => ({
      success: true,
      messageId: "gmail-1",
      threadId: "thread-1",
      rfc822MessageId: opts.messageIdHeader,
    })),
  };
  const notifications = fakeNotifications([OWNER, MANAGER, STAFF, GRANTEE]);
  const seal = new SealChallengeService(database);
  const authority = new VendorSendAuthorityService(database);
  const service = new ProcurementService(
    database,
    { createEvent: async () => undefined } as any,
    { recordTransaction: async () => undefined } as any,
    undefined, // orchestrator
    gmail as any,
    undefined, // inbound responder
    undefined, // websocket
    undefined, // inbound address
    notifications as any,
    undefined, // approval thresholds
    undefined, // organizations
    seal,
    authority,
  );
  for (const level of ["log", "warn", "error"] as const) {
    (service as any).logger[level] = () => undefined;
    (seal as any).logger[level] = () => undefined;
  }
  const draft = () => db.tables.procurement_conversations.find((r) => r.id === "draft-1")!;
  const mint = (userId: string, body: string, cc: string[] = []) =>
    service.issueDraftSendSeal(HOUSE, ORDER, userId, { body, to: VENDOR, cc });
  const send = (userId: string, body: string, challenge: string | null | undefined, cc: string[] = []) =>
    service.sendDraftedReply(HOUSE, ORDER, userId, { modifiedContent: body, ccEmails: cc }, challenge);
  return { db, gmail, notifications, service, draft, mint, send };
}

describe("the seal is required on every draft send (the REQUIRE_DRAFT_SEND_SEAL grace is gone)", () => {
  it("a manager's send with NO seal is refused as absent, and nothing reaches the vendor", async () => {
    const t = build();
    await expect(t.send(MANAGER, ENGINE_WORDS, undefined)).rejects.toThrow(/seal/i);
    expect(t.gmail.sendEmail.calls).toHaveLength(0);
    expect(t.draft().status).toBe("PENDING_APPROVAL");
  });

  it("a manager's sealed send goes, and the row names who sent it", async () => {
    const t = build();
    const { challenge } = await t.mint(MANAGER, ENGINE_WORDS);
    await t.send(MANAGER, ENGINE_WORDS, challenge);
    expect(t.gmail.sendEmail.calls).toHaveLength(1);
    expect(t.draft()).toMatchObject({ status: "SENT", sent_by_user_id: MANAGER, sent_under_grant_id: null });
  });

  it("the same seal cannot send twice", async () => {
    const t = build();
    const { challenge } = await t.mint(OWNER, ENGINE_WORDS);
    await t.send(OWNER, ENGINE_WORDS, challenge);
    t.draft().status = "PENDING_APPROVAL";
    await expect(t.send(OWNER, ENGINE_WORDS, challenge)).rejects.toThrow(/already been used|spent/i);
    expect(t.gmail.sendEmail.calls).toHaveLength(1);
  });
});

describe("a staff member's hold becomes a request, not a 403", () => {
  it("the readout tells staff their hold asks, before they hold", async () => {
    const t = build();
    const readout = await t.service.sendOrAskFor(STAFF, HOUSE);
    expect(readout).toMatchObject({ readable: true, maySend: false, mode: "ask" });
    expect(readout.sentence).toMatch(/Your hold will ask a manager/);
    const manager = await t.service.sendOrAskFor(MANAGER, HOUSE);
    expect(manager).toMatchObject({ readable: true, maySend: true, mode: "send", basis: "manager", sentence: null });
  });

  it("saves the staffer's exact words as the version, records who asked, keeps it waiting and tells owners and managers", async () => {
    const t = build();
    const out = await t.service.requestDraftSend(HOUSE, ORDER, STAFF, {
      content: STAFF_WORDS,
      ccEmails: ["Ops@House.example"],
    });
    expect(out.told).toBe(2);
    expect(t.draft()).toMatchObject({
      status: "PENDING_APPROVAL",
      content: STAFF_WORDS,
      send_requested_by: STAFF,
      send_requested_sha256: letterVersionHash(STAFF_WORDS),
      send_requested_cc: ["ops@house.example"],
    });
    expect(t.gmail.sendEmail.calls).toHaveLength(0);
    const [call] = t.notifications.persistForRestaurant.calls;
    expect(call[2].onlyUserIds.sort()).toEqual([MANAGER, OWNER].sort());
    expect(call[1].title).toMatch(/Ayse Staff asks you to send a letter/);
  });

  it("the staffer cannot SEND: the mint and the send both refuse and point at the request", async () => {
    const t = build();
    await expect(t.mint(STAFF, ENGINE_WORDS)).rejects.toThrow(/Hold again to ask a manager/);
    await expect(t.send(STAFF, ENGINE_WORDS, "anything")).rejects.toBeInstanceOf(ForbiddenException);
    expect(t.db.tables.mcp_seal_challenges).toHaveLength(0);
    expect(t.gmail.sendEmail.calls).toHaveLength(0);
  });

  it("a manager does not ask — 409, nothing written", async () => {
    const t = build();
    await expect(
      t.service.requestDraftSend(HOUSE, ORDER, MANAGER, { content: STAFF_WORDS }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(t.draft().content).toBe(ENGINE_WORDS);
    expect(t.draft().send_requested_by).toBeUndefined();
  });

  it("the draft readout shows the request, current, with the requester's name and copies", async () => {
    const t = build();
    await t.service.requestDraftSend(HOUSE, ORDER, STAFF, { content: STAFF_WORDS, ccEmails: ["ops@house.example"] });
    const pending = await t.service.getPendingDraft(HOUSE, ORDER);
    expect(pending?.content).toBe(STAFF_WORDS);
    expect(pending?.send_request).toMatchObject({
      requestedBy: STAFF,
      requestedByName: "Ayse Staff",
      current: true,
      ccEmails: ["ops@house.example"],
    });
    const active = await t.service.getActiveConversations(HOUSE);
    expect(active[0].sendRequest).toMatchObject({ requestedByName: "Ayse Staff", current: true });
  });

  it("a later edit makes the request read as no longer the staffer's version", async () => {
    const t = build();
    await t.service.requestDraftSend(HOUSE, ORDER, STAFF, { content: STAFF_WORDS });
    await t.service.editDraft(HOUSE, ORDER, "Somebody else's words entirely");
    const pending = await t.service.getPendingDraft(HOUSE, ORDER);
    expect(pending?.send_request?.current).toBe(false);
  });

  it("with no draft waiting, the staffer's own reply becomes the waiting draft, threaded to the vendor", async () => {
    const t = build();
    t.db.tables.procurement_conversations = [
      {
        id: "in-1",
        restaurant_id: HOUSE,
        order_id: ORDER,
        direction: "inbound",
        status: "RECEIVED",
        created_at: new Date(Date.now() - 3_600_000).toISOString(),
        gmail_thread_id: "thread-9",
        message_id: "<vendor-msg@x>",
        email_headers: { subject: "Re: Yakut" },
      },
    ];
    t.db.tables.procurement_orders = [
      {
        id: ORDER,
        restaurant_id: HOUSE,
        provider_id: "prov-1",
        providers: { name: "Kavaklidere", contact_email: VENDOR, restaurant_id: HOUSE },
        restaurant_inventory: { wine_name: "Yakut" },
      },
    ];
    const out = await t.service.requestDraftSend(HOUSE, ORDER, STAFF, { content: STAFF_WORDS });
    const row = t.db.tables.procurement_conversations.find((r) => r.id === out.conversationId)!;
    expect(row).toMatchObject({
      status: "PENDING_APPROVAL",
      direction: "outbound",
      outbound_email_type: "MANUAL_REPLY",
      content: STAFF_WORDS,
      send_requested_by: STAFF,
      gmail_thread_id: "thread-9",
      email_headers: { subject: "Re: Yakut", in_reply_to: "<vendor-msg@x>" },
    });
  });
});

describe("a manager releases the request with one hold over that exact text", () => {
  it("sends exactly the requested version, names the sender, and tells the staffer who sent it", async () => {
    const t = build();
    await t.service.requestDraftSend(HOUSE, ORDER, STAFF, { content: STAFF_WORDS, ccEmails: ["ops@house.example"] });
    const { challenge } = await t.mint(MANAGER, STAFF_WORDS, ["ops@house.example"]);
    await t.send(MANAGER, STAFF_WORDS, challenge, ["ops@house.example"]);

    expect(t.gmail.sendEmail.calls).toHaveLength(1);
    const mail = t.gmail.sendEmail.calls[0][0];
    expect(mail.html).toContain("delivered Tuesday");
    expect(mail.cc).toEqual(["ops@house.example"]);
    expect(t.draft()).toMatchObject({ status: "SENT", sent_by_user_id: MANAGER, send_requested_by: STAFF });

    const told = t.notifications.persistForRestaurant.calls.find((c) => c[1].type === "vendor_send_released");
    expect(told).toBeDefined();
    expect(told![2].onlyUserIds).toEqual([STAFF]);
    expect(told![1].message).toMatch(/Mert Manager sent your letter to Kavaklidere, as you wrote it\./);
  });

  it("an edit after the hold is a new version and is refused — nothing is sent", async () => {
    const t = build();
    await t.service.requestDraftSend(HOUSE, ORDER, STAFF, { content: STAFF_WORDS });
    const { challenge } = await t.mint(MANAGER, STAFF_WORDS);
    await expect(t.send(MANAGER, STAFF_WORDS.replace("six", "sixty"), challenge)).rejects.toThrow(
      /changed|different/i,
    );
    expect(t.gmail.sendEmail.calls).toHaveLength(0);
    expect(t.draft().status).toBe("PENDING_APPROVAL");
  });

  it("an edited release needs its own seal, and the staffer is told it went with changes", async () => {
    const t = build();
    await t.service.requestDraftSend(HOUSE, ORDER, STAFF, { content: STAFF_WORDS });
    const edited = STAFF_WORDS.replace("Tuesday", "Wednesday");
    const { challenge } = await t.mint(MANAGER, edited);
    await t.send(MANAGER, edited, challenge);
    expect(t.gmail.sendEmail.calls[0][0].html).toContain("Wednesday");
    const told = t.notifications.persistForRestaurant.calls.find((c) => c[1].type === "vendor_send_released");
    expect(told![1].message).toMatch(/with their own changes/);
  });
});

describe("a person an owner has granted sends with one hold", () => {
  function grant(t: ReturnType<typeof build>, over: Record<string, unknown> = {}) {
    t.db.tables.authority_grants.push({
      id: "grant-1",
      restaurant_id: HOUSE,
      grantor_user_id: OWNER,
      grantee_user_id: GRANTEE,
      scope: "vendor_send",
      limit_amount: null,
      limit_currency: null,
      expires_at: null,
      created_at: "2026-09-20T10:00:00.000Z",
      revoked_at: null,
      vouched_by_user_id: OWNER,
      suspended_at: null,
      deleted_at: null,
      ...over,
    });
  }

  it("a live grant sends, and the row records the grant it was sent under", async () => {
    const t = build();
    grant(t);
    const readout = await t.service.sendOrAskFor(GRANTEE, HOUSE);
    expect(readout).toMatchObject({
      maySend: true,
      basis: "grant",
      grant: { grantedBy: { userId: OWNER, name: "Olcay Owner" } },
    });
    const { challenge } = await t.mint(GRANTEE, ENGINE_WORDS);
    await t.send(GRANTEE, ENGINE_WORDS, challenge);
    expect(t.draft()).toMatchObject({ status: "SENT", sent_by_user_id: GRANTEE, sent_under_grant_id: "grant-1" });
    // The send under a grant is on the security ledger (ADR 0112 F12; founder
    // answer 4, 2026-09-21), written before anything left.
    expect(t.db.tables.security_events.map((e) => [e.kind, e.actor_user_id, e.subject_id])).toEqual([
      ["grant_relied_on", GRANTEE, "grant-1"],
    ]);
  });

  it("a send under a grant the ledger cannot record is refused, and nothing leaves", async () => {
    const t = build();
    grant(t);
    t.db.rpcHandlers.authority_grant_relied_on = () => ({ data: null, error: { message: "ledger unavailable" } });
    const { challenge } = await t.mint(GRANTEE, ENGINE_WORDS);
    await expect(t.send(GRANTEE, ENGINE_WORDS, challenge)).rejects.toThrow(/security ledger/);
    expect(t.gmail.sendEmail.calls).toHaveLength(0);
    expect(t.draft().status).toBe("PENDING_APPROVAL");
  });

  it("a grant whose owner went (latched) does not send, even if that owner is an owner again", async () => {
    const t = build();
    grant(t, { suspended_at: "2026-09-21T09:00:00.000Z" });
    await expect(t.mint(GRANTEE, ENGINE_WORDS)).rejects.toThrow(/waits for a current owner to re-approve/);
  });

  it("an expired grant is refused at the act, and nothing is sent", async () => {
    const t = build();
    grant(t, { expires_at: new Date(Date.now() - 1000).toISOString() });
    await expect(t.mint(GRANTEE, ENGINE_WORDS)).rejects.toThrow(/has expired/);
    await expect(t.send(GRANTEE, ENGINE_WORDS, "x")).rejects.toThrow(/has expired/);
    expect(t.gmail.sendEmail.calls).toHaveLength(0);
  });

  it("a grant from an owner who is no longer an owner does not count", async () => {
    const t = build();
    grant(t);
    t.db.tables.user_restaurant_access.find((r) => r.user_id === OWNER)!.role = "manager";
    const readout = await t.service.sendOrAskFor(GRANTEE, HOUSE);
    expect(readout).toMatchObject({ maySend: false, mode: "ask" });
    expect(readout.sentence).toMatch(/no longer an owner/);
  });
});

describe("a standing that cannot be read is an error, never a quiet answer", () => {
  it("a failed role read makes the readout unreadable, not 'ask' and not 'send'", async () => {
    const t = build();
    t.db.failures.user_restaurant_access = "permission denied";
    const readout = await t.service.sendOrAskFor(MANAGER, HOUSE);
    expect(readout).toMatchObject({ readable: false, maySend: false, mode: null });
    expect(readout.sentence).toMatch(/could not be read/);
  });

  it("a failed role read refuses the send with a 500, and nothing is sent", async () => {
    const t = build();
    t.db.failures.user_restaurant_access = "permission denied";
    await expect(t.send(MANAGER, ENGINE_WORDS, "x")).rejects.toThrow(/could not be read/);
    expect(t.gmail.sendEmail.calls).toHaveLength(0);
  });

  it("a failed grant read refuses a staff member's send rather than treating them as ungranted", async () => {
    const t = build();
    t.db.failures.authority_grants = "relation does not exist";
    await expect(t.service.sendOrAskFor(GRANTEE, HOUSE)).resolves.toMatchObject({ readable: false });
  });
});
