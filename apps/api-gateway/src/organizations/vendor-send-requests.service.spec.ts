/**
 * A staff member's request that a manager confirm a deal or send a composer
 * letter (founder answer 3, 2026-09-21), and the claim a release takes on it.
 *
 * Real: VendorSendRequestsService and VendorSendAuthorityService over one
 * in-memory store that applies the filters it is given — so a claim whose
 * update forgot its `state = waiting` condition would take a request twice,
 * and the concurrent case below would see it.
 */
import { ConflictException, ForbiddenException } from "@nestjs/common";
import { FakeDb } from "../notifications/producers/testing/fake-db";
import { VendorSendAuthorityService } from "./vendor-send-authority.service";
import { SEND_REQUEST_PUSH_TEXT, VendorSendRequestsService, requestHash } from "./vendor-send-requests.service";

const HOUSE = "house-1";
const OWNER = "u-owner";
const MANAGER = "u-manager";
const STAFF = "u-staff";

function build() {
  const db = new FakeDb();
  db.tables.users = [
    { user_id: OWNER, name: "Olcay Owner", restaurant_id: HOUSE, role: "owner" },
    { user_id: MANAGER, name: "Mert Manager", restaurant_id: HOUSE, role: "manager" },
    { user_id: STAFF, name: "Ayse Staff", restaurant_id: HOUSE, role: "staff" },
  ];
  db.tables.user_restaurant_access = db.tables.users.map((u) => ({
    user_id: u.user_id,
    restaurant_id: HOUSE,
    role: u.role,
    is_active: true,
  }));
  db.tables.authority_grants = [];
  db.tables.vendor_send_requests = [];
  const database = { supabase: db, client: db, getClient: () => db } as any;
  const authority = new VendorSendAuthorityService(database);
  const requests = new VendorSendRequestsService(database, authority);
  (requests as any).logger = { log: () => undefined, warn: () => undefined, error: () => undefined };
  const letter = { providerId: "prov-1", to: "a@b.example", subject: "S", body: "B", orderId: null };
  const ask = () =>
    requests.ask({
      userId: STAFF,
      restaurantId: HOUSE,
      kind: "house_letter",
      orderId: null,
      providerId: "prov-1",
      payload: letter,
      sealArgs: letter,
      act: "send this letter",
    });
  return { db, requests, ask, letter };
}

describe("asking", () => {
  it("a staff member's ask keeps the exact payload and its hash, waiting", async () => {
    const t = build();
    const row = await t.ask();
    expect(row).toMatchObject({ kind: "house_letter", requested_by: STAFF, state: "waiting", payload: t.letter });
    expect(row.payload_sha256).toBe(requestHash(t.letter));
  });

  it("a person who may send is refused, and nothing is saved", async () => {
    const t = build();
    await expect(
      t.requests.ask({
        userId: MANAGER,
        restaurantId: HOUSE,
        kind: "house_letter",
        orderId: null,
        providerId: "prov-1",
        payload: t.letter,
        sealArgs: t.letter,
        act: "send this letter",
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(t.db.tables.vendor_send_requests).toHaveLength(0);
  });

  it("a person with no role in the house is refused", async () => {
    const t = build();
    await expect(
      t.requests.ask({
        userId: "u-stranger",
        restaurantId: HOUSE,
        kind: "house_letter",
        orderId: null,
        providerId: "prov-1",
        payload: t.letter,
        sealArgs: t.letter,
        act: "send this letter",
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("the managers are told on the bell, low priority, with only a nameless sentence for any push", async () => {
    const t = build();
    const row = await t.ask();
    const told = await t.requests.tellManagers({
      restaurantId: HOUSE,
      requesterId: STAFF,
      kind: "house_letter",
      vendorName: "Fikri",
      requestId: row.id,
      orderId: null,
    });
    expect(told).toBe(2);
    const notices = t.db.tables.notifications;
    expect(notices.map((n) => n.user_id).sort()).toEqual([MANAGER, OWNER].sort());
    for (const n of notices) {
      expect(n.priority).toBe("low");
      expect(n.metadata.lockScreenText).toBe(SEND_REQUEST_PUSH_TEXT);
      expect(SEND_REQUEST_PUSH_TEXT).not.toMatch(/Ayse|Fikri/);
    }
  });
});

describe("a release takes the request once", () => {
  it("as written when the release is over the same letter; a second claim is refused", async () => {
    const t = build();
    const row = await t.ask();
    const out = await t.requests.claim({
      restaurantId: HOUSE,
      requestId: row.id,
      kind: "house_letter",
      releasedBy: MANAGER,
      releaseSealArgs: t.letter,
    });
    expect(out.asWritten).toBe(true);
    expect(out.row).toMatchObject({ state: "released", released_by: MANAGER, released_as_written: true });
    await expect(
      t.requests.claim({ restaurantId: HOUSE, requestId: row.id, kind: "house_letter", releasedBy: OWNER, releaseSealArgs: t.letter }),
    ).rejects.toThrow(/already released/);
  });

  it("two managers releasing at the same moment: exactly one takes it", async () => {
    const t = build();
    const row = await t.ask();
    const results = await Promise.allSettled([
      t.requests.claim({ restaurantId: HOUSE, requestId: row.id, kind: "house_letter", releasedBy: MANAGER, releaseSealArgs: t.letter }),
      t.requests.claim({ restaurantId: HOUSE, requestId: row.id, kind: "house_letter", releasedBy: OWNER, releaseSealArgs: t.letter }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((r) => r.status === "rejected")).toHaveLength(1);
  });

  it("a release over other words is recorded as not as written", async () => {
    const t = build();
    const row = await t.ask();
    const out = await t.requests.claim({
      restaurantId: HOUSE,
      requestId: row.id,
      kind: "house_letter",
      releasedBy: MANAGER,
      releaseSealArgs: { ...t.letter, body: "B, with changes" },
    });
    expect(out.asWritten).toBe(false);
  });

  it("another house's request is a 404; a failed read is an error, never an empty list", async () => {
    const t = build();
    const row = await t.ask();
    await expect(
      t.requests.claim({ restaurantId: "house-2", requestId: row.id, kind: "house_letter", releasedBy: MANAGER, releaseSealArgs: t.letter }),
    ).rejects.toThrow(/No such request in this house/);
    t.db.failures.vendor_send_requests = "permission denied";
    await expect(t.requests.waiting(HOUSE, "house_letter")).rejects.toThrow(/could not be read/);
  });

  it("a failed release gives the request back, but only for the person who took it", async () => {
    const t = build();
    const row = await t.ask();
    await t.requests.claim({ restaurantId: HOUSE, requestId: row.id, kind: "house_letter", releasedBy: MANAGER, releaseSealArgs: t.letter });
    await t.requests.unclaim(HOUSE, row.id, OWNER);
    expect(t.db.tables.vendor_send_requests[0].state).toBe("released");
    await t.requests.unclaim(HOUSE, row.id, MANAGER);
    expect(t.db.tables.vendor_send_requests[0]).toMatchObject({ state: "waiting", released_by: null, released_at: null });
  });
});
