/**
 * The house composer is a vendor send, so it is sealed and gated like one
 * (ADR 0175 D9/D10; the 2026-09-21 amendment).
 *
 * The judge's finding (lane research, 2026-09-21): `POST /communications/
 * letters` "queues vendor mail from any member" — every recipient it accepts is
 * an address in the house's VENDOR book (`book()` reads `providers` and
 * `provider_contacts`, and anything else is refused). D9 lists four doors and
 * does not name this one; the lane instruction was to build the gate here when
 * the judge shows it is a vendor send, and it does.
 *
 * Real: HouseLettersService's queue, VendorSendAuthorityService and
 * SealChallengeService over one in-memory store. Stand-ins: the sender
 * identity (which mailbox; not the gate) and the OAuth door (never reached —
 * the identity names no grant).
 */

import { HouseLettersService, HOUSE_LETTER_ACT, houseLetterSealArgs } from "./house-letters.service";
import { SealChallengeService } from "../../common/seal/seal-challenge.service";
import { VendorSendAuthorityService } from "../../organizations/vendor-send-authority.service";
import { VendorSendRequestsService } from "../../organizations/vendor-send-requests.service";
import { FakeDb } from "../../notifications/producers/testing/fake-db";
import { installGrantLedger } from "../../organizations/testing/grant-ledger-fake";

const HOUSE = "house-1";
const PROVIDER = "11111111-1111-4111-8111-111111111111";
const MANAGER = "u-manager";
const STAFF = "u-staff";
const GRANTEE = "u-grantee";
const OWNER = "u-owner";

const DRAFT = {
  providerId: PROVIDER,
  to: "fikri@fikritarim.com",
  subject: "Standing order",
  body: "Merhaba, geçen haftanın teslimatını konuşabilir miyiz?",
};

function build() {
  const db = new FakeDb();
  db.tables.users = [
    { user_id: OWNER, name: "Olcay Owner", restaurant_id: HOUSE, role: "owner" },
    { user_id: MANAGER, name: "Mert Manager", restaurant_id: HOUSE, role: "manager" },
    { user_id: STAFF, name: "Ayse Staff", restaurant_id: HOUSE, role: "staff" },
    { user_id: GRANTEE, name: "Gul Grantee", restaurant_id: HOUSE, role: "staff" },
  ];
  db.tables.user_restaurant_access = db.tables.users.map((u) => ({
    user_id: u.user_id,
    restaurant_id: HOUSE,
    role: u.role,
    is_active: true,
  }));
  db.tables.providers = [
    { id: PROVIDER, restaurant_id: HOUSE, name: "Fikri Tarım", contact_email: "fikri@fikritarim.com", primary_contact: {}, deleted_at: null },
  ];
  db.tables.provider_contacts = [];
  db.tables.procurement_conversations = [];
  db.tables.authority_grants = [];
  db.tables.mcp_seal_challenges = [];
  db.tables.vendor_send_requests = [];
  installGrantLedger(db);
  const database = { supabase: db, client: db, getClient: () => db } as any;
  const sender = {
    resolve: async () => ({
      kind: "house_mailbox",
      sendable: true,
      address: "siparis@house.example",
      ceremony: "undo",
      undoMs: 120_000,
      words: "",
      grant: null,
    }),
  } as any;
  const oauth = { getAccessToken: async () => "tok" } as any;
  const seal = new SealChallengeService(database);
  (seal as any).logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
  const authority = new VendorSendAuthorityService(database);
  const letters = new HouseLettersService(
    database,
    sender,
    oauth,
    authority,
    seal,
    new VendorSendRequestsService(database, authority),
  );
  const queued = () => db.tables.procurement_conversations.filter((r) => r.outbound_email_type === "HOUSE_LETTER");
  return { db, letters, queued };
}

describe("the composer's queue is gated: an owner, a manager or a grantee", () => {
  it("refuses a staff member's send before the book is read, issues no seal, and points at the request", async () => {
    const t = build();
    await expect(t.letters.issueQueueSeal({ restaurantId: HOUSE, userId: STAFF, dto: DRAFT as any })).rejects.toThrow(
      /ask a manager instead/,
    );
    await expect(
      t.letters.queue({ restaurantId: HOUSE, userId: STAFF, dto: DRAFT as any, challenge: "x" }),
    ).rejects.toThrow(/Only an owner, a manager, or someone an owner has named/);
    expect(t.db.tables.mcp_seal_challenges).toHaveLength(0);
    expect(t.queued()).toHaveLength(0);
  });

  it("the readout tells staff before they click that their letter will be kept and a manager asked", async () => {
    // Founder answer 3, 2026-09-21: staff may ask a manager to send a composer letter.
    const t = build();
    const readout = await t.letters.sendOrAsk(STAFF, HOUSE);
    expect(readout).toMatchObject({ readable: true, maySend: false, mode: "ask" });
    expect(readout.sentence).toMatch(/^Your hold will ask a manager to send it; your version is kept/);
  });

  it("a live grant queues, and the row names the sender and the grant", async () => {
    const t = build();
    t.db.tables.authority_grants.push({
      id: "g-1", restaurant_id: HOUSE, grantor_user_id: OWNER, grantee_user_id: GRANTEE, scope: "vendor_send",
      limit_amount: null, limit_currency: null, expires_at: null, created_at: "2026-09-20T00:00:00Z", revoked_at: null,
      vouched_by_user_id: OWNER, suspended_at: null, deleted_at: null,
    });
    const { challenge } = await t.letters.issueQueueSeal({ restaurantId: HOUSE, userId: GRANTEE, dto: DRAFT as any });
    await t.letters.queue({ restaurantId: HOUSE, userId: GRANTEE, dto: DRAFT as any, challenge });
    expect(t.queued()[0]).toMatchObject({ sent_by_user_id: GRANTEE, sent_under_grant_id: "g-1" });
  });
});

describe("the composer's queue is sealed over the letter", () => {
  it("queues nothing without a seal", async () => {
    const t = build();
    await expect(
      t.letters.queue({ restaurantId: HOUSE, userId: MANAGER, dto: DRAFT as any, challenge: undefined }),
    ).rejects.toThrow(/seal/i);
    expect(t.queued()).toHaveLength(0);
  });

  it("a manager's sealed letter is queued, never sent immediately, in their name", async () => {
    const t = build();
    const { challenge } = await t.letters.issueQueueSeal({ restaurantId: HOUSE, userId: MANAGER, dto: DRAFT as any });
    const out = await t.letters.queue({ restaurantId: HOUSE, userId: MANAGER, dto: DRAFT as any, challenge });
    expect(out.status).toBe("HOUSE_QUEUED");
    expect(t.queued()[0]).toMatchObject({ sent_by_user_id: MANAGER, sent_under_grant_id: null, content: DRAFT.body });
  });

  it("words changed after the hold are refused, and nothing is queued", async () => {
    const t = build();
    const { challenge } = await t.letters.issueQueueSeal({ restaurantId: HOUSE, userId: MANAGER, dto: DRAFT as any });
    await expect(
      t.letters.queue({
        restaurantId: HOUSE,
        userId: MANAGER,
        dto: { ...DRAFT, body: `${DRAFT.body} Ve fiyatı ikiye katlayın.` } as any,
        challenge,
      }),
    ).rejects.toThrow(/changed|different/i);
    expect(t.queued()).toHaveLength(0);
  });

  it("a subject changed after the hold is refused too", async () => {
    const t = build();
    const { challenge } = await t.letters.issueQueueSeal({ restaurantId: HOUSE, userId: MANAGER, dto: DRAFT as any });
    await expect(
      t.letters.queue({ restaurantId: HOUSE, userId: MANAGER, dto: { ...DRAFT, subject: "Urgent" } as any, challenge }),
    ).rejects.toThrow(/changed|different/i);
    expect(t.queued()).toHaveLength(0);
  });

  it("the act is its own, and its args are the letter, the address and the vendor", () => {
    expect(HOUSE_LETTER_ACT).toBe("queue_house_letter");
    expect(Object.keys(houseLetterSealArgs(DRAFT)).sort()).toEqual(["body", "orderId", "providerId", "subject", "to"]);
  });
});

describe("staff ask a manager to send a composer letter (founder answer 3, 2026-09-21)", () => {
  it("a staff member's ask keeps the exact letter, queues nothing, and tells the owners and managers on the bell", async () => {
    const t = build();
    const out = await t.letters.ask({ restaurantId: HOUSE, userId: STAFF, dto: DRAFT as any });
    expect(out.told).toBe(2);
    expect(t.queued()).toHaveLength(0);
    expect(t.db.tables.vendor_send_requests).toEqual([
      expect.objectContaining({
        kind: "house_letter",
        provider_id: PROVIDER,
        requested_by: STAFF,
        state: "waiting",
        payload: expect.objectContaining({ body: DRAFT.body, subject: DRAFT.subject, to: DRAFT.to }),
      }),
    ]);
    const notices = t.db.tables.notifications.filter((n) => n.type === "vendor_letter_requested");
    expect(notices.map((n) => n.user_id).sort()).toEqual([MANAGER, OWNER].sort());
    expect(notices.every((n) => n.priority === "low" && n.metadata.lockScreenText === "A letter is waiting for your approval")).toBe(true);
  });

  it("an ask to an address not in the book is refused like a send would be, before anything is saved", async () => {
    const t = build();
    await expect(
      t.letters.ask({ restaurantId: HOUSE, userId: STAFF, dto: { ...DRAFT, to: "someone@else.example" } as any }),
    ).rejects.toThrow(/not in this house's book/);
    expect(t.db.tables.vendor_send_requests).toHaveLength(0);
  });

  it("a person who may send is not asked on their behalf", async () => {
    const t = build();
    await expect(t.letters.ask({ restaurantId: HOUSE, userId: MANAGER, dto: DRAFT as any })).rejects.toThrow(
      /yourself with one hold/,
    );
  });

  it("a manager sees the waiting letters; the staffer sees only their own", async () => {
    const t = build();
    await t.letters.ask({ restaurantId: HOUSE, userId: STAFF, dto: DRAFT as any });
    expect((await t.letters.requestsFor(MANAGER, HOUSE)).requests).toHaveLength(1);
    expect((await t.letters.requestsFor(STAFF, HOUSE)).requests).toHaveLength(1);
    expect((await t.letters.requestsFor(GRANTEE, HOUSE)).requests).toHaveLength(0);
  });

  it("a manager releases it with one seal: it queues with the undo window, the request is taken once, and the staffer is told", async () => {
    const t = build();
    const { requestId } = await t.letters.ask({ restaurantId: HOUSE, userId: STAFF, dto: DRAFT as any });
    const release = { ...DRAFT, requestId };
    const { challenge } = await t.letters.issueQueueSeal({ restaurantId: HOUSE, userId: MANAGER, dto: release as any });
    const out = await t.letters.queue({ restaurantId: HOUSE, userId: MANAGER, dto: release as any, challenge });
    expect(out.status).toBe("HOUSE_QUEUED");
    expect(out.undoMs).toBe(120_000);
    expect(t.db.tables.vendor_send_requests[0]).toMatchObject({
      state: "released",
      released_by: MANAGER,
      released_as_written: true,
      conversation_id: t.queued()[0].id,
    });
    const told = t.db.tables.notifications.find((n) => n.type === "vendor_letter_released");
    expect(told).toMatchObject({ user_id: STAFF });
    expect(told?.message).toMatch(/as you set it/);
    // A second release of the same request sends nothing.
    const again = await t.letters.issueQueueSeal({ restaurantId: HOUSE, userId: OWNER, dto: release as any });
    await expect(
      t.letters.queue({ restaurantId: HOUSE, userId: OWNER, dto: release as any, challenge: again.challenge }),
    ).rejects.toThrow(/already released/);
    expect(t.queued()).toHaveLength(1);
  });

  it("a release with the manager's own edits is recorded as not as written", async () => {
    const t = build();
    const { requestId } = await t.letters.ask({ restaurantId: HOUSE, userId: STAFF, dto: DRAFT as any });
    const edited = { ...DRAFT, body: `${DRAFT.body} Teşekkürler.`, requestId };
    const { challenge } = await t.letters.issueQueueSeal({ restaurantId: HOUSE, userId: MANAGER, dto: edited as any });
    await t.letters.queue({ restaurantId: HOUSE, userId: MANAGER, dto: edited as any, challenge });
    expect(t.db.tables.vendor_send_requests[0]).toMatchObject({ released_as_written: false });
  });

  it("a release cannot redirect the staffer's request to another vendor", async () => {
    const t = build();
    const OTHER = "22222222-2222-4222-8222-222222222222";
    t.db.tables.providers.push({ id: OTHER, restaurant_id: HOUSE, name: "Other", contact_email: "o@other.example", primary_contact: {}, deleted_at: null });
    const { requestId } = await t.letters.ask({ restaurantId: HOUSE, userId: STAFF, dto: DRAFT as any });
    const moved = { providerId: OTHER, to: "o@other.example", subject: DRAFT.subject, body: DRAFT.body, requestId };
    await expect(
      t.letters.queue({ restaurantId: HOUSE, userId: MANAGER, dto: moved as any, challenge: "x" }),
    ).rejects.toThrow(/letter to a different vendor/);
    expect(t.db.tables.vendor_send_requests[0].state).toBe("waiting");
  });

  it("a release refused by the seal leaves the request waiting", async () => {
    const t = build();
    const { requestId } = await t.letters.ask({ restaurantId: HOUSE, userId: STAFF, dto: DRAFT as any });
    await expect(
      t.letters.queue({ restaurantId: HOUSE, userId: MANAGER, dto: { ...DRAFT, requestId } as any, challenge: undefined }),
    ).rejects.toThrow(/seal/i);
    expect(t.db.tables.vendor_send_requests[0].state).toBe("waiting");
  });
});

describe("decline, withdraw, and an undone release waits again (founder, 2026-09-21: \"Decline/withdraw; undo re-waits\")", () => {
  async function asked(t: ReturnType<typeof build>) {
    const { requestId } = await t.letters.ask({ restaurantId: HOUSE, userId: STAFF, dto: DRAFT as any });
    return requestId;
  }
  async function released(t: ReturnType<typeof build>, requestId: string, by = MANAGER) {
    const release = { ...DRAFT, requestId };
    const { challenge } = await t.letters.issueQueueSeal({ restaurantId: HOUSE, userId: by, dto: release as any });
    return t.letters.queue({ restaurantId: HOUSE, userId: by, dto: release as any, challenge });
  }
  const request = (t: ReturnType<typeof build>) => t.db.tables.vendor_send_requests[0];
  const noticesOf = (t: ReturnType<typeof build>, type: string) => t.db.tables.notifications.filter((n) => n.type === type);

  it("a manager declines with a reason: closed on the record, the staffer told why, and it can no longer be released", async () => {
    const t = build();
    const requestId = await asked(t);
    const out = await t.letters.declineRequest({ restaurantId: HOUSE, userId: MANAGER, requestId, reason: "We already ordered from them this week." });
    expect(out).toMatchObject({ id: requestId, state: "closed" });
    expect(request(t)).toMatchObject({
      state: "closed",
      closed_how: "declined",
      closed_by: MANAGER,
      closed_reason: "We already ordered from them this week.",
    });
    expect(request(t).closed_at).toEqual(expect.any(String));
    const told = noticesOf(t, "vendor_letter_declined");
    expect(told.map((n) => n.user_id)).toEqual([STAFF]);
    expect(told[0].message).toBe("Mert Manager declined your letter. Why: We already ordered from them this week. Nothing was sent.");
    expect(told[0].priority).toBe("low");
    await expect(released(t, requestId, OWNER)).rejects.toThrow(/closed/);
    expect(t.queued()).toHaveLength(0);
    expect((await t.letters.requestsFor(MANAGER, HOUSE)).requests).toHaveLength(0);
  });

  it("an owner may decline too; staff and grantees may not", async () => {
    const t = build();
    const requestId = await asked(t);
    await expect(
      t.letters.declineRequest({ restaurantId: HOUSE, userId: GRANTEE, requestId, reason: "no" }),
    ).rejects.toThrow(/Only an owner or a manager may decline/);
    await expect(
      t.letters.declineRequest({ restaurantId: HOUSE, userId: STAFF, requestId, reason: "no" }),
    ).rejects.toThrow(/Only an owner or a manager may decline/);
    expect(request(t).state).toBe("waiting");
    await t.letters.declineRequest({ restaurantId: HOUSE, userId: OWNER, requestId, reason: "Not now." });
    expect(request(t)).toMatchObject({ state: "closed", closed_by: OWNER });
  });

  it("a role that cannot be read refuses the decline; it is never read as a manager", async () => {
    const t = build();
    const requestId = await asked(t);
    t.db.failures.user_restaurant_access = "connection reset";
    t.db.failures.users = "connection reset";
    await expect(
      t.letters.declineRequest({ restaurantId: HOUSE, userId: MANAGER, requestId, reason: "Not now." }),
    ).rejects.toThrow();
    delete t.db.failures.user_restaurant_access;
    delete t.db.failures.users;
    expect(request(t).state).toBe("waiting");
    expect(noticesOf(t, "vendor_letter_declined")).toHaveLength(0);
  });

  it("a decline without a reason is refused and changes nothing", async () => {
    const t = build();
    const requestId = await asked(t);
    await expect(
      t.letters.declineRequest({ restaurantId: HOUSE, userId: MANAGER, requestId, reason: "   " }),
    ).rejects.toThrow(/A decline says why/);
    expect(request(t).state).toBe("waiting");
  });

  it("the staffer withdraws their own: closed on the record, and the owners and managers are told", async () => {
    const t = build();
    const requestId = await asked(t);
    const out = await t.letters.withdrawRequest({ restaurantId: HOUSE, userId: STAFF, requestId });
    expect(out).toMatchObject({ state: "closed" });
    expect(request(t)).toMatchObject({ state: "closed", closed_how: "withdrawn", closed_by: STAFF });
    const told = noticesOf(t, "vendor_letter_withdrawn");
    expect(told.map((n) => n.user_id).sort()).toEqual([MANAGER, OWNER].sort());
    expect(told[0].message).toBe("Ayse Staff withdrew their letter. It no longer waits for you, and nothing was sent.");
    expect((await t.letters.requestsFor(STAFF, HOUSE)).requests).toHaveLength(0);
  });

  it("nobody but the person who asked may withdraw it — a manager declines instead", async () => {
    const t = build();
    const requestId = await asked(t);
    await expect(t.letters.withdrawRequest({ restaurantId: HOUSE, userId: MANAGER, requestId })).rejects.toThrow(
      /Only the person who asked may withdraw/,
    );
    await expect(t.letters.withdrawRequest({ restaurantId: HOUSE, userId: GRANTEE, requestId })).rejects.toThrow(
      /Only the person who asked may withdraw/,
    );
    expect(request(t).state).toBe("waiting");
  });

  it("a released request cannot be declined or withdrawn after the fact", async () => {
    const t = build();
    const requestId = await asked(t);
    await released(t, requestId);
    await expect(
      t.letters.declineRequest({ restaurantId: HOUSE, userId: OWNER, requestId, reason: "late" }),
    ).rejects.toThrow(/already released, so it was not declined/);
    await expect(t.letters.withdrawRequest({ restaurantId: HOUSE, userId: STAFF, requestId })).rejects.toThrow(
      /already released, so it was not withdrawn/,
    );
    expect(request(t).state).toBe("released");
  });

  it("a release that lands between the read and the close wins: the decline changes nothing", async () => {
    const t = build();
    const requestId = await asked(t);
    const requests = (t.letters as any).requests;
    const stale = { ...request(t) };
    const realOne = requests.one.bind(requests);
    requests.one = async (...args: any[]) => {
      const row = await realOne(...args);
      // Another manager releases it after this read.
      Object.assign(request(t), { state: "released", released_by: OWNER, released_at: "2026-09-21T10:00:00Z", released_as_written: true });
      return { ...row, ...stale };
    };
    await expect(
      t.letters.declineRequest({ restaurantId: HOUSE, userId: MANAGER, requestId, reason: "no" }),
    ).rejects.toThrow(/released or closed by someone else a moment ago/);
    expect(request(t)).toMatchObject({ state: "released", released_by: OWNER });
  });

  it("a released letter pulled back inside its undo window puts the request back to waiting, and the staffer is told", async () => {
    const t = build();
    const requestId = await asked(t);
    const queued = await released(t, requestId);
    expect(request(t)).toMatchObject({ state: "released", conversation_id: queued.id });

    const out = await t.letters.cancel({ restaurantId: HOUSE, id: queued.id, userId: MANAGER });

    expect(out).toMatchObject({ status: "HOUSE_CANCELLED", requestWaitsAgain: true });
    expect(out.says).toMatch(/waiting for an owner or a manager again/);
    expect(request(t)).toMatchObject({
      state: "waiting",
      released_by: null,
      released_at: null,
      released_as_written: null,
      conversation_id: null,
      undone_count: 1,
      last_undone_by: MANAGER,
    });
    expect(request(t).last_undone_at).toEqual(expect.any(String));
    const told = noticesOf(t, "vendor_letter_rewaiting");
    expect(told.map((n) => n.user_id)).toEqual([STAFF]);
    expect(told[0].message).toBe(
      "Mert Manager pulled your letter to Fikri Tarım back before it left. It was not sent, and your request is waiting for an owner or a manager again.",
    );
    // It waits for a release again, and a release queues a new letter.
    expect((await t.letters.requestsFor(MANAGER, HOUSE)).requests).toEqual([
      expect.objectContaining({ id: requestId, undoneCount: 1 }),
    ]);
    await released(t, requestId, OWNER);
    expect(request(t)).toMatchObject({ state: "released", released_by: OWNER });
    expect(t.queued().filter((r) => r.status === "HOUSE_QUEUED")).toHaveLength(1);
  });

  it("pulling back a letter that released no request touches no request", async () => {
    const t = build();
    const requestId = await asked(t);
    const { challenge } = await t.letters.issueQueueSeal({ restaurantId: HOUSE, userId: MANAGER, dto: DRAFT as any });
    const own = await t.letters.queue({ restaurantId: HOUSE, userId: MANAGER, dto: DRAFT as any, challenge });
    const out = await t.letters.cancel({ restaurantId: HOUSE, id: own.id, userId: MANAGER });
    expect(out.requestWaitsAgain).toBe(false);
    expect(request(t)).toMatchObject({ id: requestId, state: "waiting" });
    expect(request(t).last_undone_at ?? null).toBeNull();
    expect(noticesOf(t, "vendor_letter_rewaiting")).toHaveLength(0);
  });

  it("a request that cannot be put back is said in the answer; the letter is still pulled back", async () => {
    const t = build();
    const requestId = await asked(t);
    const queued = await released(t, requestId);
    t.db.failures.vendor_send_requests = "connection reset";
    const out = await t.letters.cancel({ restaurantId: HOUSE, id: queued.id, userId: MANAGER });
    expect(out.status).toBe("HOUSE_CANCELLED");
    expect(out.requestWaitsAgain).toBe(false);
    expect(out.says).toMatch(/could not be put back to waiting \(.*connection reset.*\)/);
    delete t.db.failures.vendor_send_requests;
    expect(request(t).state).toBe("released");
  });

  // Last call, 2026-09-21: the request was found only through the best-effort
  // link, so a link that did not land left it released — silently — after its
  // letter was pulled back. The letter now carries the request's id.
  it("a release whose link to its letter did not land still waits again when the letter is pulled back", async () => {
    const t = build();
    const requestId = await asked(t);
    const requests = (t.letters as any).requests;
    // The link is best-effort in the release (logged, not refused): here it fails.
    requests.linkConversation = async () => undefined;
    const queued = await released(t, requestId);
    expect(request(t).state).toBe("released");
    expect(request(t).conversation_id ?? null).toBeNull();
    expect(t.queued()[0].email_headers).toMatchObject({ request_id: requestId });

    const out = await t.letters.cancel({ restaurantId: HOUSE, id: queued.id, userId: MANAGER });

    expect(out).toMatchObject({ status: "HOUSE_CANCELLED", requestWaitsAgain: true });
    expect(request(t)).toMatchObject({ state: "waiting", released_by: null, undone_count: 1, last_undone_by: MANAGER });
    expect(noticesOf(t, "vendor_letter_rewaiting").map((n) => n.user_id)).toEqual([STAFF]);
  });

  it("a letter whose request no longer reads as released by it says so, and touches no request", async () => {
    const t = build();
    const requestId = await asked(t);
    const queued = await released(t, requestId);
    // The request now carries a different letter.
    request(t).conversation_id = "99999999-9999-4999-8999-999999999999";
    const out = await t.letters.cancel({ restaurantId: HOUSE, id: queued.id, userId: MANAGER });
    expect(out).toMatchObject({ status: "HOUSE_CANCELLED", requestWaitsAgain: false });
    expect(out.says).toMatch(/could not be put back to waiting \(it no longer reads as released by this letter\)/);
    expect(request(t)).toMatchObject({ state: "released", conversation_id: "99999999-9999-4999-8999-999999999999" });
    expect(request(t).last_undone_at ?? null).toBeNull();
    expect(noticesOf(t, "vendor_letter_rewaiting")).toHaveLength(0);
  });

  it("a letter no request asked for carries no request id", async () => {
    const t = build();
    const { challenge } = await t.letters.issueQueueSeal({ restaurantId: HOUSE, userId: MANAGER, dto: DRAFT as any });
    await t.letters.queue({ restaurantId: HOUSE, userId: MANAGER, dto: DRAFT as any, challenge });
    expect(t.queued()[0].email_headers.request_id).toBeNull();
  });

  it("a letter the dispatcher took between the read and the write is not reported as pulled back", async () => {
    const t = build();
    const requestId = await asked(t);
    const queued = await released(t, requestId);
    const row = t.queued()[0];
    const realFrom = t.db.from.bind(t.db);
    let reads = 0;
    (t.db as any).from = (table: string) => {
      const q = realFrom(table);
      if (table === "procurement_conversations" && reads++ === 0) {
        // After this read, the dispatcher claims the row.
        const realMaybe = q.maybeSingle.bind(q);
        q.maybeSingle = async () => {
          const r = await realMaybe();
          const seen = { ...r, data: r.data ? { ...r.data } : r.data };
          row.status = "HOUSE_SENDING";
          return seen;
        };
      }
      return q;
    };
    await expect(t.letters.cancel({ restaurantId: HOUSE, id: queued.id, userId: MANAGER })).rejects.toThrow(
      /left the queue a moment ago/,
    );
    expect(request(t).state).toBe("released");
  });

  it("the waiting list tells the reader whether they may decline", async () => {
    const t = build();
    await asked(t);
    expect((await t.letters.requestsFor(MANAGER, HOUSE)).viewer).toEqual({ userId: MANAGER, mayDecline: true });
    expect((await t.letters.requestsFor(STAFF, HOUSE)).viewer).toEqual({ userId: STAFF, mayDecline: false });
  });
});
