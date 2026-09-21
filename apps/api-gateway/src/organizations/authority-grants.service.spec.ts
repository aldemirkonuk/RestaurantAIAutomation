/**
 * The owners' register of who may send to vendors (ADR 0112 F12, the grant
 * row; the founder's 2026-09-21 answer: *"only an owner issues, any owner
 * revokes, every grant/revocation told to all owners, 'granted by' shown where
 * used."*).
 *
 * Real: AuthorityGrantsService and VendorSendAuthorityService over one
 * in-memory store. Stand-in: the bell (a recorder of what it was asked to
 * write), asserted on as the service's output.
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { AuthorityGrantsService } from "./authority-grants.service";
import { VendorSendAuthorityService } from "./vendor-send-authority.service";
import { FakeDb, fakeNotifications } from "../notifications/producers/testing/fake-db";

const HOUSE = "house-1";
const OTHER_HOUSE = "house-2";
const OWNER = "u-owner";
const CO_OWNER = "u-co-owner";
const MANAGER = "u-manager";
const STAFF = "u-staff";

const ANSWERED = { limitAmount: null, limitCurrency: null, expiresAt: null };

function build() {
  const db = new FakeDb();
  db.tables.users = [
    { user_id: OWNER, name: "Olcay Owner", restaurant_id: HOUSE, role: "owner" },
    { user_id: CO_OWNER, name: "Cem Co-owner", restaurant_id: HOUSE, role: "owner" },
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
  const database = { supabase: db, client: db, getClient: () => db } as any;
  const notifications = fakeNotifications([OWNER, CO_OWNER, MANAGER, STAFF]);
  const authority = new VendorSendAuthorityService(database);
  const grants = new AuthorityGrantsService(database, authority, notifications as any);
  return { db, grants, authority, notifications };
}

describe("only an owner issues", () => {
  it("an owner names a staff member; the grant names its grantor and the owners and the grantee are told", async () => {
    const t = build();
    const out = await t.grants.issue(OWNER, HOUSE, { granteeUserId: STAFF, scope: "vendor_send", ...ANSWERED } as any);
    expect(out.grant).toMatchObject({
      grantee: { userId: STAFF, name: "Ayse Staff" },
      grantedBy: { userId: OWNER, name: "Olcay Owner" },
      state: "live",
      limitAmount: null,
      expiresAt: null,
    });
    const [call] = t.notifications.persistForRestaurant.calls;
    expect(call[2].onlyUserIds.sort()).toEqual([CO_OWNER, OWNER, STAFF].sort());
    expect(call[1].type).toBe("authority_grant_issued");
    expect(out.told).toBe(3);
    // And the gate now reads them as able to send.
    await expect(t.authority.standing(STAFF, HOUSE)).resolves.toMatchObject({ mode: "send", basis: "grant" });
  });

  it.each([MANAGER, STAFF])("refuses %s, and writes nothing", async (who) => {
    const t = build();
    await expect(
      t.grants.issue(who, HOUSE, { granteeUserId: STAFF === who ? MANAGER : STAFF, scope: "vendor_send", ...ANSWERED } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(t.db.tables.authority_grants).toHaveLength(0);
    expect(t.notifications.persistForRestaurant.calls).toHaveLength(0);
  });

  it.each(["limitAmount", "limitCurrency", "expiresAt"])(
    "refuses a grant that leaves %s unanswered — no default stands in for the owner",
    async (key) => {
      const t = build();
      const dto: Record<string, unknown> = { granteeUserId: STAFF, scope: "vendor_send", ...ANSWERED };
      delete dto[key];
      await expect(t.grants.issue(OWNER, HOUSE, dto as any)).rejects.toBeInstanceOf(BadRequestException);
      expect(t.db.tables.authority_grants).toHaveLength(0);
    },
  );

  it("refuses a limit without its currency", async () => {
    const t = build();
    await expect(
      t.grants.issue(OWNER, HOUSE, { granteeUserId: STAFF, scope: "vendor_send", limitAmount: 500, limitCurrency: null, expiresAt: null } as any),
    ).rejects.toThrow(/needs its currency/);
  });

  it("refuses an owner naming themself", async () => {
    const t = build();
    await expect(
      t.grants.issue(OWNER, HOUSE, { granteeUserId: OWNER, scope: "vendor_send", ...ANSWERED } as any),
    ).rejects.toThrow(/cannot name themself/);
  });

  it("refuses naming someone who already sends by role", async () => {
    const t = build();
    await expect(
      t.grants.issue(OWNER, HOUSE, { granteeUserId: MANAGER, scope: "vendor_send", ...ANSWERED } as any),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("refuses naming someone who is not in this house", async () => {
    const t = build();
    await expect(
      t.grants.issue(OWNER, HOUSE, { granteeUserId: "u-stranger", scope: "vendor_send", ...ANSWERED } as any),
    ).rejects.toThrow(/not a member of this house/);
  });

  it("refuses an end date already past", async () => {
    const t = build();
    await expect(
      t.grants.issue(OWNER, HOUSE, { granteeUserId: STAFF, scope: "vendor_send", limitAmount: null, limitCurrency: null, expiresAt: "2020-01-01T00:00:00Z" } as any),
    ).rejects.toThrow(/already passed/);
  });

  it("a role that could not be read is a 500, never a pass", async () => {
    const t = build();
    t.db.failures.user_restaurant_access = "permission denied";
    await expect(
      t.grants.issue(OWNER, HOUSE, { granteeUserId: STAFF, scope: "vendor_send", ...ANSWERED } as any),
    ).rejects.toThrow(/could not be read/);
    expect(t.db.tables.authority_grants).toHaveLength(0);
  });
});

describe("any owner revokes", () => {
  it("an owner who did NOT issue the grant revokes it, and every owner and the grantee are told", async () => {
    const t = build();
    const { grant } = await t.grants.issue(OWNER, HOUSE, { granteeUserId: STAFF, scope: "vendor_send", ...ANSWERED } as any);
    const out = await t.grants.revoke(CO_OWNER, HOUSE, grant.id);
    expect(out.grant).toMatchObject({ state: "revoked", revokedBy: { userId: CO_OWNER, name: "Cem Co-owner" } });
    const revokeCall = t.notifications.persistForRestaurant.calls[1];
    expect(revokeCall[1].type).toBe("authority_grant_revoked");
    expect(revokeCall[2].onlyUserIds.sort()).toEqual([CO_OWNER, OWNER, STAFF].sort());
    await expect(t.authority.standing(STAFF, HOUSE)).resolves.toMatchObject({ mode: "ask", reason: "grant_revoked" });
  });

  it("a manager cannot revoke", async () => {
    const t = build();
    const { grant } = await t.grants.issue(OWNER, HOUSE, { granteeUserId: STAFF, scope: "vendor_send", ...ANSWERED } as any);
    await expect(t.grants.revoke(MANAGER, HOUSE, grant.id)).rejects.toBeInstanceOf(ForbiddenException);
    expect(t.db.tables.authority_grants[0].revoked_at ?? null).toBeNull();
  });

  it("revoking twice is a 409 that changes nothing", async () => {
    const t = build();
    const { grant } = await t.grants.issue(OWNER, HOUSE, { granteeUserId: STAFF, scope: "vendor_send", ...ANSWERED } as any);
    await t.grants.revoke(OWNER, HOUSE, grant.id);
    await expect(t.grants.revoke(CO_OWNER, HOUSE, grant.id)).rejects.toBeInstanceOf(ConflictException);
    expect(t.db.tables.authority_grants[0].revoked_by_user_id).toBe(OWNER);
  });

  it("another house's grant is a 404, the answer a missing id gets", async () => {
    const t = build();
    t.db.tables.authority_grants.push({
      id: "foreign", restaurant_id: OTHER_HOUSE, grantor_user_id: "x", grantee_user_id: "y", scope: "vendor_send",
      limit_amount: null, limit_currency: null, expires_at: null, created_at: "2026-09-20T00:00:00Z", revoked_at: null,
    });
    await expect(t.grants.revoke(OWNER, HOUSE, "foreign")).rejects.toBeInstanceOf(NotFoundException);
    expect(t.db.tables.authority_grants[0].revoked_at).toBeNull();
  });
});

describe("the register", () => {
  it("an owner sees every grant; a staff member sees only their own", async () => {
    const t = build();
    await t.grants.issue(OWNER, HOUSE, { granteeUserId: STAFF, scope: "vendor_send", ...ANSWERED } as any);
    t.db.tables.authority_grants.push({
      id: "other", restaurant_id: HOUSE, grantor_user_id: OWNER, grantee_user_id: "u-someone", scope: "vendor_send",
      limit_amount: null, limit_currency: null, expires_at: null, created_at: "2026-09-19T00:00:00Z", revoked_at: null,
    });
    expect((await t.grants.list(OWNER, HOUSE)).grants).toHaveLength(2);
    const mine = await t.grants.list(STAFF, HOUSE);
    expect(mine.viewerIsOwner).toBe(false);
    expect(mine.grants.map((g) => g.grantee.userId)).toEqual([STAFF]);
  });

  it("a failed read is an error, not an empty register", async () => {
    const t = build();
    t.db.failures.authority_grants = "relation does not exist";
    await expect(t.grants.list(OWNER, HOUSE)).rejects.toThrow(/could not be read/);
  });

  it("says plainly when the owners could not be told, and the grant still stands", async () => {
    const t = build();
    const quiet = new AuthorityGrantsService(
      { supabase: t.db, client: t.db } as any,
      t.authority,
      fakeNotifications([], () => 0) as any,
    );
    const out = await quiet.issue(OWNER, HOUSE, { granteeUserId: STAFF, scope: "vendor_send", ...ANSWERED } as any);
    expect(out.told).toBe(0);
    expect(out.says).toMatch(/could not be told; tell them yourself/);
    expect(t.db.tables.authority_grants).toHaveLength(1);
  });
});
