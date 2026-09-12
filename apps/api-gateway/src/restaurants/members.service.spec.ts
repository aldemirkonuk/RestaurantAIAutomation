import { MembersService } from "./members.service";
import {
  asDatabaseService,
  makeStubDb,
  StubDb,
} from "../team/testing/supabase-stub";

/**
 * T2 (second half) — ADR 0088. A role change is the other way a person's
 * visibility of wages and of the whole roster changes. It lived here, was
 * owner-gated, protected only the last-owner case, and then performed two bare
 * UPDATEs with no audit row, no notification and no before/after capture.
 */

const RID = "restaurant-1";
const OWNER = "user-owner";
const SECOND_OWNER = "user-owner-2";
const SAM = "user-sam";

function seed(): StubDb {
  return makeStubDb({
    user_restaurant_access: [
      { id: "a1", user_id: OWNER, restaurant_id: RID, role: "owner", is_active: true },
      { id: "a2", user_id: SECOND_OWNER, restaurant_id: RID, role: "owner", is_active: true },
      { id: "a3", user_id: SAM, restaurant_id: RID, role: "staff", is_active: true },
    ],
    users: [
      { user_id: OWNER, restaurant_id: RID, role: "owner", email: "ada@example.test" },
      { user_id: SECOND_OWNER, restaurant_id: RID, role: "owner", email: "bo@example.test" },
      { user_id: SAM, restaurant_id: RID, role: "staff", email: "sam@example.test" },
    ],
    notifications: [],
    system_audit_log: [],
  });
}

function service(db: StubDb): MembersService {
  return new MembersService(asDatabaseService(db));
}

describe("MembersService.updateMemberRole — the change files itself", () => {
  it("writes a system_audit_log row carrying the role before and after", async () => {
    const db = seed();
    await service(db).updateMemberRole(OWNER, RID, SAM, "manager");

    expect(db.tables.system_audit_log).toHaveLength(1);
    const row = db.tables.system_audit_log[0];
    expect(row.action).toBe("member_role_changed");
    expect(row.entity_type).toBe("restaurant_member");
    expect(row.entity_id).toBe(SAM);
    expect(row.restaurant_id).toBe(RID);
    // `public.users.user_id` — the id the JWT carries. `auth.users` is a
    // DISJOINT table in this database and an id from it would dangle.
    expect(row.actor_id).toBe(OWNER);
    expect(row.changes?.role).toEqual({ from: "staff", to: "manager" });
  });

  it("tells the person whose role changed", async () => {
    const db = seed();
    await service(db).updateMemberRole(OWNER, RID, SAM, "manager");

    expect(db.tables.notifications).toHaveLength(1);
    expect(db.tables.notifications[0].user_id).toBe(SAM);
    expect(String(db.tables.notifications[0].message)).toMatch(/manager/i);
  });

  it("still performs the change, and reports whether the record was written", async () => {
    const db = seed();
    const receipt: any = await service(db).updateMemberRole(
      OWNER,
      RID,
      SAM,
      "manager",
    );

    expect(
      db.tables.user_restaurant_access.find((r) => r.user_id === SAM)!.role,
    ).toBe("manager");
    expect(receipt).toMatchObject({ audited: true, notified: true });
  });

  it("records the change even when the notification cannot be written", async () => {
    const db = seed();
    db.errors["notifications:insert"] = { message: "notifications table down" };

    const receipt: any = await service(db).updateMemberRole(
      OWNER,
      RID,
      SAM,
      "manager",
    );
    expect(db.tables.system_audit_log).toHaveLength(1);
    expect(receipt.notified).toBe(false);
  });
});

/**
 * The roster read itself. `getMembers` ordered `user_restaurant_access` by
 * `granted_at` -- a column that table does not have (it is on `user_roles`) --
 * and swallowed the resulting 42703 into `[]`, so the Team page rendered an
 * empty roster for every tenant and looked healthy doing it.
 *
 * Measured against the live gateway before the fix:
 *   GET /api/v1/restaurants/550e8400-…/members -> 200 []
 *   PostgREST direct                            -> 3 rows
 */
describe("MembersService.getMembers — a failed read is not an empty roster", () => {
  function seedRoster(): StubDb {
    return makeStubDb({
      user_restaurant_access: [
        { id: "a2", user_id: SECOND_OWNER, restaurant_id: RID, role: "owner", is_active: true, created_at: "2026-02-01T00:00:00Z" },
        { id: "a1", user_id: OWNER, restaurant_id: RID, role: "owner", is_active: true, created_at: "2026-01-01T00:00:00Z" },
        { id: "a3", user_id: SAM, restaurant_id: RID, role: "staff", is_active: true, created_at: "2026-03-01T00:00:00Z" },
      ],
      users: [
        { user_id: OWNER, restaurant_id: RID, role: "owner", email: "ada@example.test" },
        { user_id: SECOND_OWNER, restaurant_id: RID, role: "owner", email: "bo@example.test" },
        { user_id: SAM, restaurant_id: RID, role: "staff", email: "sam@example.test" },
      ],
    });
  }

  it("returns the whole roster, oldest membership first", async () => {
    const members = await service(seedRoster()).getMembers(OWNER, RID);

    expect(members.map((m: any) => m.id)).toEqual(["a1", "a2", "a3"]);
    expect(members[0].users?.email).toBe("ada@example.test");
  });

  it("throws rather than reporting a dead read as a restaurant with no members", async () => {
    const db = seedRoster();
    db.errors["user_restaurant_access:select"] = { message: "read failed" };

    await expect(service(db).getMembers(OWNER, RID)).rejects.toThrow();
  });

  it("throws rather than handing back a roster of anonymous members", async () => {
    const db = seedRoster();
    db.errors["users:select"] = { message: "read failed" };

    // Live before the fix: the identity select named `avatar_url` and
    // `auth_provider`, neither of which `public.users` has, so PostgREST
    // answered 42703 and every member came back as `users: null`.
    await expect(service(db).getMembers(OWNER, RID)).rejects.toThrow();
  });

  it("throws rather than reporting a dead invite read as no pending invites", async () => {
    const db = seedRoster();
    db.tables.organization_invites = [];
    db.errors["organization_invites:select"] = { message: "read failed" };

    await expect(service(db).getInvites(OWNER, RID)).rejects.toThrow();
  });
});
