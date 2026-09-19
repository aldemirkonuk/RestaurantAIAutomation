import {
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
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

/**
 * ADR 0162 (founder, 2026-09-18): "Managers grant manager or staff", on both
 * doors. An owner adds any role, a manager a manager or staff and never an
 * owner, staff nobody. Until then this door refused a manager who added a
 * manager ("Managers can only add staff members") while the invitation door
 * let a manager mint an owner's invite; both now call one rule, `grantRefusal`.
 */
describe("MembersService.addMember — a manager adds a manager or staff, never an owner", () => {
  const ACTOR = "user-actor";
  const NEWCOMER = "user-newcomer";
  const NEW_EMAIL = "newcomer@example.test";

  function seedAdd(
    actorRole: string,
    via: "access" | "users" = "access",
  ): StubDb {
    return makeStubDb({
      user_restaurant_access:
        via === "access"
          ? [
              {
                id: "a1",
                user_id: ACTOR,
                restaurant_id: RID,
                role: actorRole,
                is_active: true,
              },
            ]
          : [],
      users: [
        {
          user_id: ACTOR,
          restaurant_id: RID,
          role: actorRole,
          email: "actor@example.test",
        },
        {
          user_id: NEWCOMER,
          restaurant_id: null,
          role: "manager",
          email: NEW_EMAIL,
        },
      ],
      restaurants: [{ id: RID, organization_id: "org-1" }],
      organization_members: [],
    });
  }

  const addedRows = (db: StubDb) =>
    db.tables.user_restaurant_access.filter((r) => r.user_id === NEWCOMER);

  it("lets a manager add a manager", async () => {
    const db = seedAdd("manager");
    await service(db).addMember(ACTOR, RID, NEW_EMAIL, "manager");

    expect(addedRows(db).map((r) => r.role)).toEqual(["manager"]);
  });

  it("refuses a manager who adds an owner, says what they may add, and writes nothing", async () => {
    const db = seedAdd("manager");
    const attempt = service(db).addMember(ACTOR, RID, NEW_EMAIL, "owner");

    await expect(attempt).rejects.toBeInstanceOf(ForbiddenException);
    await expect(attempt).rejects.toThrow(/manager or staff/);
    expect(addedRows(db)).toEqual([]);
    expect(db.opsOn("organization_members", "upsert")).toEqual([]);
  });

  it("refuses staff, whatever role they ask to add", async () => {
    for (const role of ["owner", "manager", "staff"] as const) {
      const db = seedAdd("staff");
      await expect(
        service(db).addMember(ACTOR, RID, NEW_EMAIL, role),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(addedRows(db)).toEqual([]);
    }
  });

  it("lets an owner add an owner", async () => {
    const db = seedAdd("owner");
    await service(db).addMember(ACTOR, RID, NEW_EMAIL, "owner");

    expect(addedRows(db).map((r) => r.role)).toEqual(["owner"]);
  });

  it("gives a role the rule does not know nothing to grant", async () => {
    // `users.role` has no CHECK constraint, and `assertMembership` still reads
    // it when there is no access row. "admin" and "constructor" both got past
    // `role === "manager"`, so either could add an owner.
    for (const actorRole of ["admin", "constructor"]) {
      const db = seedAdd(actorRole, "users");
      await expect(
        service(db).addMember(ACTOR, RID, NEW_EMAIL, "owner"),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(addedRows(db)).toEqual([]);
    }
  });
});

/**
 * Owners manage owners. The founder, 2026-09-18 (ADR 0162, dated addendum):
 * "an owner can degrade or give its status to someonelse". A manager may
 * remove a manager or staff, never an owner. Until then `removeMember` let any
 * owner-or-manager remove an owner as long as another owner remained.
 */
describe("MembersService.removeMember — a manager removes a manager or staff, never an owner", () => {
  const MANAGER = "user-manager";
  const MANAGER_2 = "user-manager-2";
  const LEGACY_OWNER = "user-legacy-owner";
  const LAPSED = "user-lapsed";
  const ELSEWHERE = "user-elsewhere";
  const OTHER_RID = "restaurant-2";

  function seedRemove(): StubDb {
    return makeStubDb({
      user_restaurant_access: [
        {
          id: "a1",
          user_id: OWNER,
          restaurant_id: RID,
          role: "owner",
          is_active: true,
        },
        {
          id: "a2",
          user_id: SECOND_OWNER,
          restaurant_id: RID,
          role: "owner",
          is_active: true,
        },
        {
          id: "a3",
          user_id: SAM,
          restaurant_id: RID,
          role: "staff",
          is_active: true,
        },
        {
          id: "a4",
          user_id: MANAGER,
          restaurant_id: RID,
          role: "manager",
          is_active: true,
        },
        {
          id: "a5",
          user_id: MANAGER_2,
          restaurant_id: RID,
          role: "manager",
          is_active: true,
        },
        // A row here that is no longer active, and a member of another house only.
        {
          id: "a6",
          user_id: LAPSED,
          restaurant_id: RID,
          role: "staff",
          is_active: false,
        },
        {
          id: "a7",
          user_id: ELSEWHERE,
          restaurant_id: OTHER_RID,
          role: "staff",
          is_active: true,
        },
      ],
      users: [
        {
          user_id: OWNER,
          restaurant_id: RID,
          role: "owner",
          email: "ada@example.test",
        },
        {
          user_id: SECOND_OWNER,
          restaurant_id: RID,
          role: "owner",
          email: "bo@example.test",
        },
        {
          user_id: SAM,
          restaurant_id: RID,
          role: "staff",
          email: "sam@example.test",
        },
        {
          user_id: MANAGER,
          restaurant_id: RID,
          role: "manager",
          email: "mo@example.test",
        },
        {
          user_id: MANAGER_2,
          restaurant_id: RID,
          role: "manager",
          email: "mia@example.test",
        },
        // A setup-era member: `users.restaurant_id` names the house, and no
        // access row was ever written for it.
        {
          user_id: LEGACY_OWNER,
          restaurant_id: RID,
          role: "owner",
          email: "leo@example.test",
        },
        {
          user_id: LAPSED,
          restaurant_id: null,
          role: "staff",
          email: "lu@example.test",
        },
        {
          user_id: ELSEWHERE,
          restaurant_id: OTHER_RID,
          role: "staff",
          email: "el@example.test",
        },
      ],
    });
  }

  const accessOf = (db: StubDb, userId: string) =>
    db.tables.user_restaurant_access.filter(
      (r) => r.user_id === userId && r.restaurant_id === RID,
    );
  const usersRowOf = (db: StubDb, userId: string) =>
    db.tables.users.find((u) => u.user_id === userId)!;

  it("refuses a manager who removes an owner, and removes nothing", async () => {
    const db = seedRemove();
    const attempt = service(db).removeMember(MANAGER, RID, SECOND_OWNER);

    await expect(attempt).rejects.toBeInstanceOf(ForbiddenException);
    await expect(attempt).rejects.toThrow(/Only an owner/);
    expect(accessOf(db, SECOND_OWNER)).toHaveLength(1);
    expect(usersRowOf(db, SECOND_OWNER).restaurant_id).toBe(RID);
    expect(db.opsOn("user_restaurant_access", "delete")).toEqual([]);
    expect(db.opsOn("users", "update")).toEqual([]);
  });

  it("refuses a manager who removes an owner known only by the users row", async () => {
    const db = seedRemove();
    await expect(
      service(db).removeMember(MANAGER, RID, LEGACY_OWNER),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(usersRowOf(db, LEGACY_OWNER).restaurant_id).toBe(RID);
    expect(db.opsOn("users", "update")).toEqual([]);
  });

  it("lets a manager remove a manager or staff", async () => {
    const db = seedRemove();
    await service(db).removeMember(MANAGER, RID, MANAGER_2);
    await service(db).removeMember(MANAGER, RID, SAM);

    expect(accessOf(db, MANAGER_2)).toEqual([]);
    expect(accessOf(db, SAM)).toEqual([]);
  });

  it("lets an owner remove another owner while one remains", async () => {
    const db = seedRemove();
    await service(db).removeMember(OWNER, RID, SECOND_OWNER);

    expect(accessOf(db, SECOND_OWNER)).toEqual([]);
  });

  it("still lets an owner leave while another owner remains", async () => {
    const db = seedRemove();
    await service(db).removeMember(SECOND_OWNER, RID, SECOND_OWNER);

    expect(accessOf(db, SECOND_OWNER)).toEqual([]);
  });

  // PR #393's fourth round: a target read with `.eq("is_active", true)` or
  // `.eq("restaurant_id", …)` deleted passed every test above, because every
  // row they seed is active and in this house.
  it("treats an inactive row here as no membership: 404, and deletes nothing", async () => {
    const db = seedRemove();
    await expect(
      service(db).removeMember(OWNER, RID, LAPSED),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(accessOf(db, LAPSED)).toHaveLength(1);
    expect(db.opsOn("user_restaurant_access", "delete")).toEqual([]);
    expect(db.opsOn("users", "update")).toEqual([]);
  });

  it("answers 404 for a member of another house only, and touches nothing", async () => {
    const db = seedRemove();
    await expect(
      service(db).removeMember(OWNER, RID, ELSEWHERE),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(usersRowOf(db, ELSEWHERE).restaurant_id).toBe(OTHER_RID);
    expect(db.opsOn("user_restaurant_access", "delete")).toEqual([]);
    expect(db.opsOn("users", "update")).toEqual([]);
  });
});

/**
 * The founder's owner rule, 2026-09-18: an owner "can make either a coowner or
 * make himself manager while making other manager owner (min:1,owner)". These
 * PIN what `updateMemberRole` already does; they were green before this PR's
 * third round and are here so the rule cannot drift unseen.
 */
describe("MembersService.updateMemberRole — owners hand over, and one owner always remains", () => {
  const MANAGER = "user-manager";

  function seedHandover(): StubDb {
    return makeStubDb({
      user_restaurant_access: [
        {
          id: "a1",
          user_id: OWNER,
          restaurant_id: RID,
          role: "owner",
          is_active: true,
        },
        {
          id: "a4",
          user_id: MANAGER,
          restaurant_id: RID,
          role: "manager",
          is_active: true,
        },
      ],
      users: [
        {
          user_id: OWNER,
          restaurant_id: RID,
          role: "owner",
          email: "ada@example.test",
        },
        {
          user_id: MANAGER,
          restaurant_id: RID,
          role: "manager",
          email: "mo@example.test",
        },
      ],
      notifications: [],
      system_audit_log: [],
    });
  }

  const roleOf = (db: StubDb, userId: string) =>
    db.tables.user_restaurant_access.find((r) => r.user_id === userId)!.role;

  it("lets an owner make a manager an owner, then step down to manager", async () => {
    const db = seedHandover();
    await service(db).updateMemberRole(OWNER, RID, MANAGER, "owner");
    await service(db).updateMemberRole(OWNER, RID, OWNER, "manager");

    expect(roleOf(db, MANAGER)).toBe("owner");
    expect(roleOf(db, OWNER)).toBe("manager");
  });

  it("refuses the only owner stepping down, and changes nothing", async () => {
    const db = seedHandover();
    await expect(
      service(db).updateMemberRole(OWNER, RID, OWNER, "manager"),
    ).rejects.toThrow(/only owner/);
    expect(roleOf(db, OWNER)).toBe("owner");
  });

  it("refuses a manager who changes anyone's role", async () => {
    const db = seedHandover();
    await expect(
      service(db).updateMemberRole(MANAGER, RID, MANAGER, "owner"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(roleOf(db, MANAGER)).toBe("manager");
  });

  it("lets an owner demote a co-owner, since the demoting owner remains", async () => {
    // The founder, 2026-09-18, asked whether one owner may demote or remove
    // another: "Yes, any owner". Owners are equals; one owner always remains.
    const db = seed();
    await service(db).updateMemberRole(OWNER, RID, SECOND_OWNER, "manager");

    expect(roleOf(db, SECOND_OWNER)).toBe("manager");
    expect(roleOf(db, OWNER)).toBe("owner");
  });
});

/**
 * A role change in one house changes the role in that house only. The
 * founder, 2026-09-18 (ADR 0162, answer A, "Only that house"): the target must
 * be a member of the house, read the way `assertMembership` reads one (an
 * active access row there, or with none a `users` row naming it), and the
 * global `users.role` is written only when the person's `users` row names that
 * same house. Until then `updateMemberRole` checked only the ACTOR, so an
 * owner of any house could set anyone's global `users.role`, and an audit row
 * and a notice said a member's role had changed (v3.0-TECH-DEBT 44.1p).
 */
describe("MembersService.updateMemberRole — a role changes in this house only", () => {
  const OTHER_RID = "restaurant-2";
  const OUTSIDER = "user-outsider";
  const TWO_HOUSES = "user-two-houses";
  const LEGACY = "user-legacy";
  const LAPSED = "user-lapsed";

  function seedScope(): StubDb {
    return makeStubDb({
      user_restaurant_access: [
        {
          id: "a1",
          user_id: OWNER,
          restaurant_id: RID,
          role: "owner",
          is_active: true,
        },
        {
          id: "a3",
          user_id: SAM,
          restaurant_id: RID,
          role: "staff",
          is_active: true,
        },
        // A manager of another house, with no row here.
        {
          id: "b1",
          user_id: OUTSIDER,
          restaurant_id: OTHER_RID,
          role: "manager",
          is_active: true,
        },
        // Staff here; manager in the house their users row names.
        {
          id: "a8",
          user_id: TWO_HOUSES,
          restaurant_id: RID,
          role: "staff",
          is_active: true,
        },
        {
          id: "b2",
          user_id: TWO_HOUSES,
          restaurant_id: OTHER_RID,
          role: "manager",
          is_active: true,
        },
        // A row here that is no longer active.
        {
          id: "a9",
          user_id: LAPSED,
          restaurant_id: RID,
          role: "staff",
          is_active: false,
        },
      ],
      users: [
        {
          user_id: OWNER,
          restaurant_id: RID,
          role: "owner",
          email: "ada@example.test",
        },
        {
          user_id: SAM,
          restaurant_id: RID,
          role: "staff",
          email: "sam@example.test",
        },
        {
          user_id: OUTSIDER,
          restaurant_id: OTHER_RID,
          role: "manager",
          email: "out@example.test",
        },
        {
          user_id: TWO_HOUSES,
          restaurant_id: OTHER_RID,
          role: "manager",
          email: "two@example.test",
        },
        // A setup-era member here: no access row, a users row naming this house.
        {
          user_id: LEGACY,
          restaurant_id: RID,
          role: "manager",
          email: "leg@example.test",
        },
        {
          user_id: LAPSED,
          restaurant_id: null,
          role: "staff",
          email: "lu@example.test",
        },
      ],
      notifications: [],
      system_audit_log: [],
    });
  }

  const usersRoleOf = (db: StubDb, userId: string) =>
    db.tables.users.find((u) => u.user_id === userId)!.role;
  const rowOf = (db: StubDb, userId: string, rid: string) =>
    db.tables.user_restaurant_access.find(
      (r) => r.user_id === userId && r.restaurant_id === rid,
    );

  it("refuses someone who is not a member of this house, and writes nothing", async () => {
    const db = seedScope();
    await expect(
      service(db).updateMemberRole(OWNER, RID, OUTSIDER, "staff"),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(usersRoleOf(db, OUTSIDER)).toBe("manager");
    expect(rowOf(db, OUTSIDER, OTHER_RID)!.role).toBe("manager");
    expect(db.opsOn("user_restaurant_access", "update")).toEqual([]);
    expect(db.opsOn("users", "update")).toEqual([]);
    expect(db.tables.system_audit_log).toEqual([]);
    expect(db.tables.notifications).toEqual([]);
  });

  it("refuses someone whose only row here is inactive, and writes nothing", async () => {
    const db = seedScope();
    await expect(
      service(db).updateMemberRole(OWNER, RID, LAPSED, "manager"),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(rowOf(db, LAPSED, RID)!.role).toBe("staff");
    expect(usersRoleOf(db, LAPSED)).toBe("staff");
    expect(db.tables.system_audit_log).toEqual([]);
  });

  it("changes a member's role here and leaves the global role their own house gave them", async () => {
    const db = seedScope();
    await service(db).updateMemberRole(OWNER, RID, TWO_HOUSES, "owner");

    expect(rowOf(db, TWO_HOUSES, RID)!.role).toBe("owner");
    expect(rowOf(db, TWO_HOUSES, OTHER_RID)!.role).toBe("manager");
    expect(usersRoleOf(db, TWO_HOUSES)).toBe("manager");
    expect(db.tables.system_audit_log[0].changes?.role).toEqual({
      from: "staff",
      to: "owner",
    });
  });

  it("writes the global role too when the member's users row names this house", async () => {
    const db = seedScope();
    await service(db).updateMemberRole(OWNER, RID, SAM, "manager");

    expect(rowOf(db, SAM, RID)!.role).toBe("manager");
    expect(usersRoleOf(db, SAM)).toBe("manager");
    // The write names this member alone. The owner's and a legacy member's
    // `users` rows name this house too, and keep their roles (an owner and a
    // manager: whatever role is written, one of the two would change).
    expect(usersRoleOf(db, OWNER)).toBe("owner");
    expect(usersRoleOf(db, LEGACY)).toBe("manager");
  });

  it("changes a legacy member's role through the users row naming this house, and records what it was", async () => {
    const db = seedScope();
    await service(db).updateMemberRole(OWNER, RID, LEGACY, "staff");

    expect(usersRoleOf(db, LEGACY)).toBe("staff");
    expect(db.tables.system_audit_log).toHaveLength(1);
    expect(db.tables.system_audit_log[0].changes?.role).toEqual({
      from: "manager",
      to: "staff",
    });
  });

  it("answers 500 and writes nothing when a legacy member's users row cannot be read", async () => {
    const db = seedScope();
    db.errors["users:select"] = { message: "connection reset" };

    await expect(
      service(db).updateMemberRole(OWNER, RID, LEGACY, "staff"),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(usersRoleOf(db, LEGACY)).toBe("manager");
    expect(db.opsOn("users", "update")).toEqual([]);
    expect(db.tables.system_audit_log).toEqual([]);
  });

  it("answers 500 and writes nothing when the target's access row cannot be read", async () => {
    const db = seedScope();
    db.errors["user_restaurant_access:select"] = {
      message: "connection reset",
    };

    // `assertMembership` discards this error and admits the owner through
    // their users row; the target read does not discard it.
    await expect(
      service(db).updateMemberRole(OWNER, RID, SAM, "manager"),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(rowOf(db, SAM, RID)!.role).toBe("staff");
    expect(db.opsOn("users", "update")).toEqual([]);
  });

  it("changes the role even when the users write fails, and records it, for a member with an access row", async () => {
    const db = seedScope();
    db.errors["users:update"] = { message: "connection reset" };

    const receipt: any = await service(db).updateMemberRole(
      OWNER,
      RID,
      SAM,
      "manager",
    );
    expect(rowOf(db, SAM, RID)!.role).toBe("manager");
    expect(receipt).toMatchObject({ audited: true });
  });

  it("answers 500 when the users write fails for a legacy member, whose role lives only there", async () => {
    const db = seedScope();
    db.errors["users:update"] = { message: "connection reset" };

    await expect(
      service(db).updateMemberRole(OWNER, RID, LEGACY, "staff"),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(db.tables.system_audit_log).toEqual([]);
  });
});
