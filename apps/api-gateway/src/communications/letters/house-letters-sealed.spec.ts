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
