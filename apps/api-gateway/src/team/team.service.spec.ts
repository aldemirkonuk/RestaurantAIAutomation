import { ForbiddenException } from "@nestjs/common";
import { TeamService } from "./team.service";
import { asDatabaseService, makeStubDb, StubDb } from "./testing/supabase-stub";

/**
 * /team gateway — the four defects this suite pins (ADR 0088).
 *
 * T1  the server invented every wage in production (8 rows at $32.00, 3 at
 *     $28.00 on 2026-09-02 — exactly `role === "manager" ? 28 : 32`), and the
 *     labour figure summed `?? 0` over them.
 * T2  a removal revoked a person's access with no audit row and no notice.
 * T5  `assertAccess` fell back to `users.role`, whose column DEFAULT is
 *     'manager', so an untouched row was a manager of /team; and the whole
 *     credential file and every time-off reason were readable by any member.
 * T6  `listSwaps` read a table with no writer anywhere in the repo.
 */

const RID = "restaurant-1";
const OTHER_RID = "restaurant-2";

const OWNER = "user-owner";
const MANAGER = "user-manager";
const STAFF = "user-staff";
const LEGACY = "user-legacy"; // users.restaurant_id set, no user_restaurant_access row

function seed(): StubDb {
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
        user_id: MANAGER,
        restaurant_id: RID,
        role: "manager",
        is_active: true,
      },
      {
        id: "a3",
        user_id: STAFF,
        restaurant_id: RID,
        role: "staff",
        is_active: true,
      },
    ],
    users: [
      {
        user_id: OWNER,
        restaurant_id: RID,
        role: "owner",
        name: "Ada",
        email: "ada@example.test",
      },
      {
        user_id: MANAGER,
        restaurant_id: RID,
        role: "manager",
        name: "Moe",
        email: "moe@example.test",
      },
      {
        user_id: STAFF,
        restaurant_id: RID,
        role: "staff",
        name: "Sam",
        email: "sam@example.test",
      },
      // The shape measured in production on 2026-09-02: exactly one user reaches
      // /team through the users-table fallback, carrying role 'manager' — which
      // is the column DEFAULT and therefore indistinguishable from "unset".
      {
        user_id: LEGACY,
        restaurant_id: RID,
        role: "manager",
        name: "Lee",
        email: "lee@example.test",
      },
    ],
    team_members: [],
    team_certifications: [],
    time_off_requests: [],
    team_settings: [],
    system_audit_log: [],
    notifications: [],
  });
}

function service(db: StubDb): TeamService {
  return new TeamService(asDatabaseService(db));
}

describe("TeamService — T1: the server does not invent a wage", () => {
  it("backfills a roster row with an unknown wage, not a made-up one", async () => {
    const db = seed();
    await service(db).listMembers(OWNER, RID);

    const roster = db.tables.team_members;
    expect(roster).toHaveLength(3);
    for (const m of roster) {
      // Production carried 8 rows at 32 and 3 at 28 — 100% of the wage data in
      // the database, every value written by this backfill. A wage nobody
      // entered is unknown (ADR 0051), never a plausible number.
      expect(m.hourly_wage).toBeNull();
    }
  });

  it("still creates the roster row — the backfill is real work and stays", async () => {
    const db = seed();
    const members = await service(db).listMembers(OWNER, RID);
    expect(members.map((m: any) => m.user_id).sort()).toEqual(
      [MANAGER, OWNER, STAFF].sort(),
    );
  });
});

describe("TeamService — T1: an unconfigured restaurant is not given a target", () => {
  it("reports labour settings as unconfigured instead of inventing 28%", async () => {
    const db = seed();
    const settings = await service(db).getSettings(OWNER, RID);

    // `getSettings` returned {labor_tracking_enabled:true, wage_visible:true,
    // labor_target_pct:28} for a restaurant with no row, and the week payload
    // printed it as "target 28% of sales" — a number nobody chose.
    expect(settings.configured).toBe(false);
    expect(settings.labor_target_pct).toBeNull();
  });

  it("returns the stored row, marked configured, when one exists", async () => {
    const db = seed();
    db.tables.team_settings.push({
      restaurant_id: RID,
      labor_tracking_enabled: true,
      wage_visible: true,
      labor_target_pct: 31,
    });
    const settings = await service(db).getSettings(OWNER, RID);
    expect(settings.configured).toBe(true);
    expect(Number(settings.labor_target_pct)).toBe(31);
  });
});

describe("TeamService — T2: a removal leaves a record and tells the person", () => {
  async function removeSam(db: StubDb) {
    db.tables.team_members.push({
      id: "m-sam",
      restaurant_id: RID,
      user_id: STAFF,
      display_name: "Sam",
      hourly_wage: null,
      status: "active",
    });
    return service(db).deleteMember(MANAGER, RID, "m-sam");
  }

  it("writes a system_audit_log row naming the actor, the target and the role lost", async () => {
    const db = seed();
    await removeSam(db);

    const rows = db.tables.system_audit_log;
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.action).toBe("team_member_removed");
    expect(row.entity_type).toBe("team_member");
    expect(row.entity_id).toBe("m-sam");
    expect(row.restaurant_id).toBe(RID);
    // The JWT carries `public.users.user_id`. `auth.users` and `public.users`
    // are DISJOINT in this database, so an actor id from the other table would
    // be a dangling reference CI cannot catch.
    expect(row.actor_id).toBe(MANAGER);
    expect(row.actor_type).toBe("user");
    expect(row.changes?.access_role).toEqual({ from: "staff", to: null });
    expect(row.changes?.user_id).toBe(STAFF);
  });

  it("notifies the person who lost access", async () => {
    const db = seed();
    await removeSam(db);

    const notes = db.tables.notifications;
    expect(notes).toHaveLength(1);
    expect(notes[0].user_id).toBe(STAFF);
    expect(notes[0].restaurant_id).toBe(RID);
    expect(String(notes[0].message)).toMatch(/access/i);
  });

  it("reports whether the record was written rather than returning void", async () => {
    const db = seed();
    const receipt: any = await removeSam(db);
    // A removal that silently failed to file itself is the same shape as one
    // that filed itself correctly, unless the response says which happened.
    expect(receipt).toMatchObject({
      removed: true,
      audited: true,
      notified: true,
    });
  });

  it("still records the removal when the notification cannot be written", async () => {
    const db = seed();
    db.errors["notifications:insert"] = { message: "notifications table down" };
    const receipt: any = await removeSam(db);

    expect(db.tables.system_audit_log).toHaveLength(1);
    expect(receipt.audited).toBe(true);
    expect(receipt.notified).toBe(false);
  });

  it("removal stays manager-gated — the decision was to record it, not restrict it", async () => {
    const db = seed();
    db.tables.team_members.push({
      id: "m-sam",
      restaurant_id: RID,
      user_id: STAFF,
      display_name: "Sam",
      status: "active",
    });
    await expect(
      service(db).deleteMember(MANAGER, RID, "m-sam"),
    ).resolves.toBeDefined();
  });
});

describe("TeamService — T5: an authorisation default must not escalate", () => {
  it("treats a users-table row as proof of membership, never of privilege", async () => {
    const db = seed();
    // `users.role` is `varchar(20) DEFAULT 'manager' NOT NULL`, so this value
    // cannot distinguish "an owner set this" from "nobody ever touched it".
    const { role } = await service(db).assertAccess(LEGACY, RID);
    expect(role).toBe("staff");
  });

  it("refuses a manager action to a caller who only has a users row", async () => {
    const db = seed();
    await expect(
      service(db).assertAccess(LEGACY, RID, "manager"),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("does not demote a real owner — the access register still decides", async () => {
    const db = seed();
    await expect(
      service(db).assertAccess(OWNER, RID, "owner"),
    ).resolves.toEqual({
      role: "owner",
    });
  });

  it("shows a staff member only their own certifications", async () => {
    const db = seed();
    db.tables.team_members.push(
      { id: "m-sam", restaurant_id: RID, user_id: STAFF, display_name: "Sam" },
      {
        id: "m-moe",
        restaurant_id: RID,
        user_id: MANAGER,
        display_name: "Moe",
      },
    );
    db.tables.team_certifications.push(
      {
        id: "c1",
        restaurant_id: RID,
        member_id: "m-sam",
        cert_type: "Food handler",
        expires_at: null,
      },
      {
        id: "c2",
        restaurant_id: RID,
        member_id: "m-moe",
        cert_type: "Alcohol server",
        expires_at: null,
      },
    );

    const asStaff = await service(db).listCertifications(STAFF, RID);
    expect(asStaff.map((c: any) => c.id)).toEqual(["c1"]);

    const asManager = await service(db).listCertifications(MANAGER, RID);
    expect(asManager.map((c: any) => c.id).sort()).toEqual(["c1", "c2"]);
  });

  it("shows a staff member only their own time-off requests and reasons", async () => {
    const db = seed();
    db.tables.team_members.push(
      { id: "m-sam", restaurant_id: RID, user_id: STAFF, display_name: "Sam" },
      {
        id: "m-moe",
        restaurant_id: RID,
        user_id: MANAGER,
        display_name: "Moe",
      },
    );
    db.tables.time_off_requests.push(
      {
        id: "t1",
        restaurant_id: RID,
        member_id: "m-sam",
        reason: "family",
        created_at: "2026-09-01",
      },
      {
        id: "t2",
        restaurant_id: RID,
        member_id: "m-moe",
        reason: "surgery",
        created_at: "2026-09-02",
      },
    );

    const asStaff = await service(db).listTimeOff(STAFF, RID);
    expect(asStaff.map((t: any) => t.id)).toEqual(["t1"]);
    expect(JSON.stringify(asStaff)).not.toContain("surgery");

    const asManager = await service(db).listTimeOff(MANAGER, RID);
    expect(asManager).toHaveLength(2);
  });
});

describe("TeamService — T6: a read nothing writes is not a feature", () => {
  it("no longer exposes listSwaps", () => {
    // `swap_requests` has no writer anywhere in the repository (grepped
    // apps/, services/, supabase/): the route could only ever answer `[]`,
    // which reads as "no swap requests" rather than "this does not exist".
    expect((service(seed()) as any).listSwaps).toBeUndefined();
  });
});

describe("TeamService — tenant scoping is not weakened by any of the above", () => {
  it("denies a caller with no access to the restaurant at all", async () => {
    const db = seed();
    await expect(
      service(db).assertAccess(STAFF, OTHER_RID),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
