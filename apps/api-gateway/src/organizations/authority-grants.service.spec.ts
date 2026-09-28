/**
 * The register of who may send to vendors (ADR 0112 F12, the grant row), and
 * the founder's rules for it:
 *
 *   2026-09-21, first answer: *"only an owner issues, any owner revokes, every
 *   grant/revocation told to all owners, 'granted by' shown where used."*
 *   2026-09-21, answers on the amendment's forks: (1) a grant whose owner is
 *   demoted or removed stops and waits for a CURRENT owner's re-approval, or an
 *   owner deletes it — *"no owner grant, no activation, or no going back once
 *   grant author gone"*; (2) managers see the register, an owner may mark a
 *   grant owner-only, staff see only their own; (4) issue, revoke and
 *   re-approve are sealed on the server and every grant event is on the
 *   security ledger, with the owners told.
 *
 * Real: AuthorityGrantsService, VendorSendAuthorityService and
 * SealChallengeService over one in-memory store. The grant functions the
 * service calls are modelled on the store (`testing/grant-ledger-fake.ts`;
 * the SQL is proven in PGlite). Stand-in: the bell, a recorder of what it was
 * asked to write, asserted on as the service's output.
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { AuthorityGrantsService } from "./authority-grants.service";
import { VendorSendAuthorityService } from "./vendor-send-authority.service";
import { SealChallengeService } from "../common/seal/seal-challenge.service";
import { FakeDb, fakeNotifications } from "../notifications/producers/testing/fake-db";
import { grantRow, installGrantLedger, latchGrantsOf } from "./testing/grant-ledger-fake";

const HOUSE = "house-1";
const OTHER_HOUSE = "house-2";
const OWNER = "u-owner";
const CO_OWNER = "u-co-owner";
const MANAGER = "u-manager";
const STAFF = "u-staff";

const ANSWERED = { limitAmount: null, limitCurrency: null, expiresAt: null };
const toStaff = (over: Record<string, unknown> = {}) =>
  ({ granteeUserId: STAFF, scope: "vendor_send", ...ANSWERED, ...over }) as any;

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
  db.tables.mcp_seal_challenges = [];
  installGrantLedger(db);
  const database = { supabase: db, client: db, getClient: () => db } as any;
  const notifications = fakeNotifications([OWNER, CO_OWNER, MANAGER, STAFF]);
  const authority = new VendorSendAuthorityService(database);
  const seal = new SealChallengeService(database);
  (seal as any).logger.warn = () => undefined;
  (seal as any).logger.error = () => undefined;
  const grants = new AuthorityGrantsService(database, authority, notifications as any, seal);
  /** The hold, then the act: what a page does. */
  const issue = async (who: string, dto: any) => {
    const { challenge } = await grants.issueSeal(who, HOUSE, dto);
    return grants.issue(who, HOUSE, dto, challenge);
  };
  const act = async (who: string, id: string, what: "revoke" | "reapprove" | "delete") => {
    const { challenge } = await grants.actSeal(who, HOUSE, id, what);
    return what === "revoke"
      ? grants.revoke(who, HOUSE, id, challenge)
      : what === "reapprove"
        ? grants.reapprove(who, HOUSE, id, challenge)
        : grants.remove(who, HOUSE, id, challenge);
  };
  const ledger = () => db.tables.security_events;
  const demote = (userId: string, role = "manager") => {
    for (const a of db.tables.user_restaurant_access) if (a.user_id === userId) a.role = role;
    for (const u of db.tables.users) if (u.user_id === userId) u.role = role;
    latchGrantsOf(db, userId, HOUSE);
  };
  const promote = (userId: string) => {
    for (const a of db.tables.user_restaurant_access) if (a.user_id === userId) a.role = "owner";
    for (const u of db.tables.users) if (u.user_id === userId) u.role = "owner";
  };
  return { db, grants, authority, notifications, issue, act, ledger, demote, promote };
}

describe("only an owner issues, under the seal", () => {
  it("an owner names a staff member; the grant names its grantor, is on the ledger, and the owners and the grantee are told", async () => {
    const t = build();
    const out = await t.issue(OWNER, toStaff());
    expect(out.grant).toMatchObject({
      grantee: { userId: STAFF, name: "Ayse Staff" },
      grantedBy: { userId: OWNER, name: "Olcay Owner" },
      vouchedBy: { userId: OWNER },
      state: "live",
      ownerOnly: false,
      limitAmount: null,
      expiresAt: null,
    });
    const [call] = t.notifications.persistForRestaurant.calls;
    expect(call[2].onlyUserIds.sort()).toEqual([CO_OWNER, OWNER, STAFF].sort());
    expect(call[1].type).toBe("authority_grant_issued");
    expect(out.told).toBe(3);
    expect(t.ledger().map((e) => [e.kind, e.actor_user_id, e.subject_id])).toEqual([["grant_issued", OWNER, out.grant.id]]);
    // The seal's own id is carried onto the ledger row: the event names the hold it spent.
    expect(t.ledger()[0].detail.sealId).toBe(t.db.tables.mcp_seal_challenges[0].id);
    await expect(t.authority.standing(STAFF, HOUSE)).resolves.toMatchObject({ mode: "send", basis: "grant" });
  });

  it("an issue without a seal writes nothing", async () => {
    const t = build();
    await expect(t.grants.issue(OWNER, HOUSE, toStaff(), undefined)).rejects.toBeInstanceOf(ForbiddenException);
    expect(t.db.tables.authority_grants).toHaveLength(0);
    expect(t.ledger()).toHaveLength(0);
  });

  it("a seal minted for one grantee does not issue a grant to another", async () => {
    const t = build();
    t.db.tables.users.push({ user_id: "u-staff-2", name: "Deniz", restaurant_id: HOUSE, role: "staff" });
    t.db.tables.user_restaurant_access.push({ user_id: "u-staff-2", restaurant_id: HOUSE, role: "staff", is_active: true });
    const { challenge } = await t.grants.issueSeal(OWNER, HOUSE, toStaff());
    await expect(
      t.grants.issue(OWNER, HOUSE, toStaff({ granteeUserId: "u-staff-2" }), challenge),
    ).rejects.toThrow(/changed after the seal was issued/);
    expect(t.db.tables.authority_grants).toHaveLength(0);
  });

  it.each([MANAGER, STAFF])("refuses %s before any seal is minted, and writes nothing", async (who) => {
    const t = build();
    await expect(
      t.grants.issueSeal(who, HOUSE, toStaff({ granteeUserId: STAFF === who ? MANAGER : STAFF })),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(t.db.tables.mcp_seal_challenges).toHaveLength(0);
    expect(t.db.tables.authority_grants).toHaveLength(0);
    expect(t.notifications.persistForRestaurant.calls).toHaveLength(0);
  });

  it.each(["limitAmount", "limitCurrency", "expiresAt"])(
    "refuses a grant that leaves %s unanswered — no default stands in for the owner",
    async (key) => {
      const t = build();
      const dto: Record<string, unknown> = { granteeUserId: STAFF, scope: "vendor_send", ...ANSWERED };
      delete dto[key];
      await expect(t.grants.issueSeal(OWNER, HOUSE, dto as any)).rejects.toBeInstanceOf(BadRequestException);
      expect(t.db.tables.authority_grants).toHaveLength(0);
    },
  );

  it("refuses a limit without its currency", async () => {
    const t = build();
    await expect(t.grants.issueSeal(OWNER, HOUSE, toStaff({ limitAmount: 500, limitCurrency: null }))).rejects.toThrow(
      /needs its currency/,
    );
  });

  it("refuses an owner naming themself", async () => {
    const t = build();
    await expect(t.grants.issueSeal(OWNER, HOUSE, toStaff({ granteeUserId: OWNER }))).rejects.toThrow(/cannot name themself/);
  });

  it("refuses naming someone who already sends by role", async () => {
    const t = build();
    await expect(t.grants.issueSeal(OWNER, HOUSE, toStaff({ granteeUserId: MANAGER }))).rejects.toBeInstanceOf(ConflictException);
  });

  it("refuses naming someone who is not in this house", async () => {
    const t = build();
    await expect(t.grants.issueSeal(OWNER, HOUSE, toStaff({ granteeUserId: "u-stranger" }))).rejects.toThrow(
      /not a member of this house/,
    );
  });

  it("refuses an end date already past", async () => {
    const t = build();
    await expect(t.grants.issueSeal(OWNER, HOUSE, toStaff({ expiresAt: "2020-01-01T00:00:00Z" }))).rejects.toThrow(/already passed/);
  });

  it("a role that could not be read is a 500, never a pass", async () => {
    const t = build();
    t.db.failures.user_restaurant_access = "permission denied";
    await expect(t.grants.issueSeal(OWNER, HOUSE, toStaff())).rejects.toThrow(/could not be read/);
    expect(t.db.tables.authority_grants).toHaveLength(0);
  });
});

describe("any owner revokes, under the seal", () => {
  it("an owner who did NOT issue the grant revokes it; the ledger and every owner and the grantee are told", async () => {
    const t = build();
    const { grant } = await t.issue(OWNER, toStaff());
    const out = await t.act(CO_OWNER, grant.id, "revoke");
    expect(out.grant).toMatchObject({ state: "revoked", revokedBy: { userId: CO_OWNER, name: "Cem Co-owner" } });
    const revokeCall = t.notifications.persistForRestaurant.calls[1];
    expect(revokeCall[1].type).toBe("authority_grant_revoked");
    expect(revokeCall[2].onlyUserIds.sort()).toEqual([CO_OWNER, OWNER, STAFF].sort());
    expect(t.ledger().map((e) => e.kind)).toEqual(["grant_issued", "grant_revoked"]);
    await expect(t.authority.standing(STAFF, HOUSE)).resolves.toMatchObject({ mode: "ask", reason: "grant_revoked" });
  });

  it("a revoke without a seal changes nothing", async () => {
    const t = build();
    const { grant } = await t.issue(OWNER, toStaff());
    await expect(t.grants.revoke(OWNER, HOUSE, grant.id, null)).rejects.toBeInstanceOf(ForbiddenException);
    expect(t.db.tables.authority_grants[0].revoked_at ?? null).toBeNull();
    expect(t.ledger()).toHaveLength(1);
  });

  it("a seal minted to revoke does not delete, and one minted for another grant does not revoke this one", async () => {
    const t = build();
    const { grant } = await t.issue(OWNER, toStaff());
    const { challenge } = await t.grants.actSeal(OWNER, HOUSE, grant.id, "revoke");
    t.db.tables.authority_grants.push(grantRow({ id: "g-2", restaurant_id: HOUSE, grantor_user_id: OWNER, grantee_user_id: STAFF }));
    await expect(t.grants.revoke(OWNER, HOUSE, "g-2", challenge)).rejects.toThrow(/different send grant/);
    expect(t.db.tables.authority_grants.every((g) => !g.revoked_at)).toBe(true);
  });

  it("a manager cannot revoke", async () => {
    const t = build();
    const { grant } = await t.issue(OWNER, toStaff());
    await expect(t.grants.actSeal(MANAGER, HOUSE, grant.id, "revoke")).rejects.toBeInstanceOf(ForbiddenException);
    expect(t.db.tables.authority_grants[0].revoked_at ?? null).toBeNull();
  });

  it("revoking twice is a 409 that changes nothing", async () => {
    const t = build();
    const { grant } = await t.issue(OWNER, toStaff());
    await t.act(OWNER, grant.id, "revoke");
    await expect(t.grants.actSeal(CO_OWNER, HOUSE, grant.id, "revoke")).rejects.toBeInstanceOf(ConflictException);
    expect(t.db.tables.authority_grants[0].revoked_by_user_id).toBe(OWNER);
  });

  it("another house's grant is a 404, the answer a missing id gets", async () => {
    const t = build();
    t.db.tables.authority_grants.push(
      grantRow({ id: "foreign", restaurant_id: OTHER_HOUSE, grantor_user_id: "x", grantee_user_id: "y" }),
    );
    await expect(t.grants.actSeal(OWNER, HOUSE, "foreign", "revoke")).rejects.toBeInstanceOf(NotFoundException);
    expect(t.db.tables.authority_grants[0].revoked_at).toBeNull();
  });
});

describe("a grant whose owner goes stops, and waits for a CURRENT owner (founder, 2026-09-21)", () => {
  it("demoting the owner stops the grant at once; the row stays, reading 'awaiting re-approval'", async () => {
    const t = build();
    const { grant } = await t.issue(OWNER, toStaff());
    t.demote(OWNER);
    await expect(t.authority.standing(STAFF, HOUSE)).resolves.toMatchObject({ mode: "ask", reason: "grant_orphaned" });
    const reg = await t.grants.list(CO_OWNER, HOUSE);
    expect(reg.grants).toHaveLength(1);
    expect(reg.grants[0]).toMatchObject({ id: grant.id, state: "awaiting_reapproval", awaitingReason: "voucher_no_longer_owner" });
  });

  it("promoting the same person back does NOT bring the grant back: nothing re-activates by itself", async () => {
    const t = build();
    const { grant } = await t.issue(OWNER, toStaff());
    t.demote(OWNER);
    t.promote(OWNER);
    await expect(t.authority.standing(STAFF, HOUSE)).resolves.toMatchObject({ mode: "ask", reason: "grant_orphaned" });
    expect((await t.grants.list(OWNER, HOUSE)).grants[0]).toMatchObject({ id: grant.id, state: "awaiting_reapproval" });
  });

  it("even with the latch missed, a grant resting on a non-owner does not send", async () => {
    const t = build();
    await t.issue(OWNER, toStaff());
    for (const a of t.db.tables.user_restaurant_access) if (a.user_id === OWNER) a.role = "manager";
    await expect(t.authority.standing(STAFF, HOUSE)).resolves.toMatchObject({ mode: "ask", reason: "grant_orphaned" });
  });

  it("a current owner re-approves under the seal; it then rests on them, the ledger says so, and everyone is told", async () => {
    const t = build();
    const { grant } = await t.issue(OWNER, toStaff());
    t.demote(OWNER);
    const out = await t.act(CO_OWNER, grant.id, "reapprove");
    expect(out.grant).toMatchObject({ state: "live", grantedBy: { userId: OWNER }, vouchedBy: { userId: CO_OWNER } });
    expect(t.ledger().map((e) => e.kind)).toEqual(["grant_issued", "grant_suspended", "grant_reapproved"]);
    const standing = await t.authority.standing(STAFF, HOUSE);
    expect(standing).toMatchObject({ mode: "send", basis: "grant" });
    // "granted by" is the owner it rests on NOW, not the one who left.
    expect((standing as any).grant.grantorUserId).toBe(CO_OWNER);
    const last = t.notifications.persistForRestaurant.calls.at(-1)!;
    expect(last[1].type).toBe("authority_grant_reapproved");
    expect(last[2].onlyUserIds).toContain(STAFF);
  });

  it("the demoted owner cannot re-approve their own former grant", async () => {
    const t = build();
    const { grant } = await t.issue(OWNER, toStaff());
    t.demote(OWNER);
    await expect(t.grants.actSeal(OWNER, HOUSE, grant.id, "reapprove")).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("a live grant is not re-approved and not deleted", async () => {
    const t = build();
    const { grant } = await t.issue(OWNER, toStaff());
    await expect(t.grants.actSeal(CO_OWNER, HOUSE, grant.id, "reapprove")).rejects.toThrow(/not waiting/);
    await expect(t.grants.actSeal(CO_OWNER, HOUSE, grant.id, "delete")).rejects.toThrow(/revoked, not deleted/);
  });

  it("a re-approve without a seal changes nothing", async () => {
    const t = build();
    const { grant } = await t.issue(OWNER, toStaff());
    t.demote(OWNER);
    await expect(t.grants.reapprove(CO_OWNER, HOUSE, grant.id, "")).rejects.toBeInstanceOf(ForbiddenException);
    expect(t.db.tables.authority_grants[0].suspended_at).not.toBeNull();
  });

  it("an owner deletes a waiting grant under the seal; it leaves the register and the ledger keeps it", async () => {
    const t = build();
    const { grant } = await t.issue(OWNER, toStaff());
    t.demote(OWNER);
    const out = await t.act(CO_OWNER, grant.id, "delete");
    expect(out.says).toMatch(/security ledger keeps its history/);
    expect((await t.grants.list(CO_OWNER, HOUSE)).grants).toHaveLength(0);
    expect(t.ledger().map((e) => e.kind)).toEqual(["grant_issued", "grant_suspended", "grant_deleted"]);
    await expect(t.authority.standing(STAFF, HOUSE)).resolves.toMatchObject({ mode: "ask" });
  });
});

describe("the register, by who reads it (founder, 2026-09-21)", () => {
  it("an owner sees every grant; a manager sees all but owner-only ones; staff see only their own", async () => {
    const t = build();
    await t.issue(OWNER, toStaff());
    t.db.tables.authority_grants.push(
      grantRow({ id: "hidden", restaurant_id: HOUSE, grantor_user_id: OWNER, grantee_user_id: "u-someone", owner_only: true, created_at: "2026-09-19T00:00:00Z" }),
    );
    expect((await t.grants.list(OWNER, HOUSE)).grants).toHaveLength(2);
    const mgr = await t.grants.list(MANAGER, HOUSE);
    expect(mgr.viewer).toBe("manager");
    expect(mgr.grants.map((g) => g.grantee.userId)).toEqual([STAFF]);
    const mine = await t.grants.list(STAFF, HOUSE);
    expect(mine.viewerIsOwner).toBe(false);
    expect(mine.viewer).toBe("other");
    expect(mine.grants.map((g) => g.grantee.userId)).toEqual([STAFF]);
  });

  it("an owner marks a grant owner-only: managers stop seeing it, the ledger and the owners are told, the grantee is not", async () => {
    const t = build();
    const { grant } = await t.issue(OWNER, toStaff());
    const out = await t.grants.setOwnerOnly(OWNER, HOUSE, grant.id, true);
    expect(out.grant.ownerOnly).toBe(true);
    expect((await t.grants.list(MANAGER, HOUSE)).grants).toHaveLength(0);
    expect((await t.grants.list(STAFF, HOUSE)).grants).toHaveLength(1);
    expect(t.ledger().at(-1)).toMatchObject({ kind: "grant_visibility_changed", actor_user_id: OWNER });
    const last = t.notifications.persistForRestaurant.calls.at(-1)!;
    expect(last[2].onlyUserIds.sort()).toEqual([CO_OWNER, OWNER].sort());
  });

  it("an owner-only grant can be issued that way from the start", async () => {
    const t = build();
    await t.issue(OWNER, toStaff({ ownerOnly: true }));
    expect((await t.grants.list(MANAGER, HOUSE)).grants).toHaveLength(0);
  });

  it("a manager cannot change who sees a grant", async () => {
    const t = build();
    const { grant } = await t.issue(OWNER, toStaff());
    await expect(t.grants.setOwnerOnly(MANAGER, HOUSE, grant.id, true)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("a failed read is an error, not an empty register", async () => {
    const t = build();
    t.db.failures.authority_grants = "relation does not exist";
    await expect(t.grants.list(OWNER, HOUSE)).rejects.toThrow(/could not be read/);
  });

  it("says plainly when the owners could not be told, and the grant still stands", async () => {
    const t = build();
    const seal = new SealChallengeService({ supabase: t.db, client: t.db } as any);
    const quiet = new AuthorityGrantsService(
      { supabase: t.db, client: t.db } as any,
      t.authority,
      fakeNotifications([], () => 0) as any,
      seal,
    );
    const { challenge } = await quiet.issueSeal(OWNER, HOUSE, toStaff());
    const out = await quiet.issue(OWNER, HOUSE, toStaff(), challenge);
    expect(out.told).toBe(0);
    expect(out.says).toMatch(/could not be told; tell them yourself/);
    expect(t.db.tables.authority_grants).toHaveLength(1);
  });

  it("the service never writes the grants table itself: every change goes through a ledgered function", async () => {
    const t = build();
    const writes: string[] = [];
    const from = t.db.from.bind(t.db);
    (t.db as any).from = (table: string) => {
      const q = from(table);
      if (table === "authority_grants") {
        for (const m of ["insert", "update", "upsert", "delete"]) {
          const orig = (q as any)[m].bind(q);
          (q as any)[m] = (...args: any[]) => {
            writes.push(m);
            return orig(...args);
          };
        }
      }
      return q;
    };
    const { grant } = await t.issue(OWNER, toStaff());
    t.demote(OWNER);
    await t.act(CO_OWNER, grant.id, "reapprove");
    await t.grants.setOwnerOnly(CO_OWNER, HOUSE, grant.id, true);
    await t.act(CO_OWNER, grant.id, "revoke");
    expect(writes).toEqual([]);
    expect(t.ledger().map((e) => e.kind)).toEqual([
      "grant_issued",
      "grant_suspended",
      "grant_reapproved",
      "grant_visibility_changed",
      "grant_revoked",
    ]);
  });
});
