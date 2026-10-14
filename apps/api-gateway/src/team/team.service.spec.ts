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

describe("TeamService — F-352: an owner's 28 is a target, the column's 28 is not", () => {
  function withDefaultRow(db: StubDb) {
    // A row created by switching something else: the target is the column
    // DEFAULT 28, which nobody chose.
    db.tables.team_settings.push({
      restaurant_id: RID,
      labor_tracking_enabled: true,
      labor_target_pct: 28,
    });
  }

  it("a stored 28 nobody set is not marked chosen", async () => {
    const db = seed();
    withDefaultRow(db);
    const settings = await service(db).getSettings(OWNER, RID);
    expect(settings.labor_target_chosen).toBe(false);
  });

  it("an unconfigured restaurant has not chosen a target", async () => {
    const settings = await service(seed()).getSettings(OWNER, RID);
    expect(settings.labor_target_chosen).toBe(false);
  });

  it("the owner typing the 28 already stored is recorded, and then reads as chosen", async () => {
    const db = seed();
    withDefaultRow(db);
    const saved = await service(db).updateSettings(OWNER, RID, {
      laborTargetPct: 28,
    } as any);
    expect(saved.labor_target_chosen).toBe(true);
    const filed = db.tables.system_audit_log.filter(
      (r: any) => r.action === "team_labour_settings_changed",
    );
    expect(filed).toHaveLength(1);
    expect(filed[0].changes.labor_target_pct).toEqual({ from: 28, to: 28 });
    const settings = await service(db).getSettings(OWNER, RID);
    expect(settings.labor_target_chosen).toBe(true);
  });

  it("switching tracking alone does not make the stored 28 a choice", async () => {
    const db = seed();
    withDefaultRow(db);
    await service(db).updateSettings(OWNER, RID, {
      laborTrackingEnabled: false,
    } as any);
    const settings = await service(db).getSettings(OWNER, RID);
    expect(settings.labor_target_chosen).toBe(false);
  });

  it("a chosen 28 saved again records nothing new", async () => {
    const db = seed();
    withDefaultRow(db);
    await service(db).updateSettings(OWNER, RID, { laborTargetPct: 28 } as any);
    await service(db).updateSettings(OWNER, RID, { laborTargetPct: 28 } as any);
    expect(
      db.tables.system_audit_log.filter(
        (r: any) => r.action === "team_labour_settings_changed",
      ),
    ).toHaveLength(1);
  });

  it("an unreadable record answers unknown, not 'nobody chose it'", async () => {
    const db = seed();
    withDefaultRow(db);
    db.errors["system_audit_log:select"] = { message: "boom" };
    const settings = await service(db).getSettings(OWNER, RID);
    expect(settings.labor_target_chosen).toBeNull();
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

describe("TeamService — F-1545: removing a 'no account yet' person cancels their invite", () => {
  const LATER = new Date(Date.now() + 7 * 86_400_000).toISOString();

  function withInvitedStandIn(
    db: StubDb,
    inviteOverrides: Record<string, unknown> = {},
  ) {
    db.tables.organization_invites = [
      {
        id: "inv-1",
        restaurant_id: RID,
        invited_by: OWNER,
        role: "staff",
        used_at: null,
        expires_at: LATER,
        ...inviteOverrides,
      },
    ];
    db.tables.team_members.push({
      id: "m-new",
      restaurant_id: RID,
      user_id: null,
      invite_id: "inv-1",
      display_name: "New cook",
      status: "active",
    });
  }

  it("expires the unused invite the roster row stood in for, so it cannot be accepted later", async () => {
    const db = seed();
    withInvitedStandIn(db);
    const receipt: any = await service(db).deleteMember(MANAGER, RID, "m-new");

    const invite = db.tables.organization_invites[0];
    expect(new Date(String(invite.expires_at)).getTime()).toBeLessThanOrEqual(
      Date.now(),
    );
    expect(invite.used_at).toBeNull();
    expect(
      db.tables.team_members.find((m) => m.id === "m-new"),
    ).toBeUndefined();
    expect(receipt.inviteCancelled).toBe(true);
    expect(db.tables.system_audit_log[0].changes?.invite_cancelled).toBe(true);
  });

  it("refuses the removal, keeping the row, when the invite cannot be cancelled", async () => {
    const db = seed();
    withInvitedStandIn(db);
    db.errors["organization_invites:update"] = { message: "invites down" };

    await expect(
      service(db).deleteMember(MANAGER, RID, "m-new"),
    ).rejects.toThrow("Failed to remove member");
    expect(db.tables.team_members.find((m) => m.id === "m-new")).toBeDefined();
    expect(db.tables.organization_invites[0].expires_at).toBe(LATER);
  });

  it("F-1555: expires every live invite this house made to the row's address, not only the newest", async () => {
    const db = seed();
    withInvitedStandIn(db, { target_email: "cook@example.test" });
    db.tables.organization_invites.push(
      // The earlier invite a re-invite left behind: the roster row no
      // longer points at it.
      {
        id: "inv-0",
        restaurant_id: RID,
        invited_by: OWNER,
        role: "staff",
        target_email: "cook@example.test",
        used_at: null,
        expires_at: LATER,
      },
      {
        id: "inv-other-address",
        restaurant_id: RID,
        invited_by: OWNER,
        role: "staff",
        target_email: "someone@example.test",
        used_at: null,
        expires_at: LATER,
      },
      {
        id: "inv-other-house",
        restaurant_id: OTHER_RID,
        invited_by: OWNER,
        role: "staff",
        target_email: "cook@example.test",
        used_at: null,
        expires_at: LATER,
      },
    );
    db.tables.team_members.find((m) => m.id === "m-new")!.email =
      " Cook@Example.test ";

    const receipt: any = await service(db).deleteMember(MANAGER, RID, "m-new");

    const expiresAt = (id: string) =>
      db.tables.organization_invites.find((i) => i.id === id)!.expires_at;
    for (const id of ["inv-0", "inv-1"])
      expect(new Date(String(expiresAt(id))).getTime()).toBeLessThanOrEqual(
        Date.now(),
      );
    expect(expiresAt("inv-other-address")).toBe(LATER);
    expect(expiresAt("inv-other-house")).toBe(LATER);
    expect(receipt.inviteCancelled).toBe(true);
  });

  it("leaves an invite that was already used alone", async () => {
    const db = seed();
    withInvitedStandIn(db, { used_at: "2026-10-01T10:00:00.000Z" });
    const receipt: any = await service(db).deleteMember(MANAGER, RID, "m-new");

    expect(db.tables.organization_invites[0].expires_at).toBe(LATER);
    expect(receipt.inviteCancelled).toBe(false);
  });
});

describe("TeamService — F-1580: removing a person with an account cancels invites emailed to them", () => {
  const LATER = new Date(Date.now() + 7 * 86_400_000).toISOString();

  // Sam joined with a code handed over in person; the invite emailed to his
  // address earlier was never used and is still good.
  function withSamAndEmailedInvite(db: StubDb, email: string | null) {
    db.tables.organization_invites = [
      {
        id: "inv-emailed",
        restaurant_id: RID,
        invited_by: OWNER,
        role: "staff",
        target_email: "sam@example.test",
        used_at: null,
        expires_at: LATER,
      },
      {
        id: "inv-other-house",
        restaurant_id: OTHER_RID,
        invited_by: OWNER,
        role: "staff",
        target_email: "sam@example.test",
        used_at: null,
        expires_at: LATER,
      },
      {
        id: "inv-other-address",
        restaurant_id: RID,
        invited_by: OWNER,
        role: "staff",
        target_email: "someone@example.test",
        used_at: null,
        expires_at: LATER,
      },
    ];
    db.tables.team_members.push({
      id: "m-sam",
      restaurant_id: RID,
      user_id: STAFF,
      email,
      display_name: "Sam",
      status: "active",
    });
  }

  const expiresAt = (db: StubDb, id: string) =>
    db.tables.organization_invites.find((i) => i.id === id)!.expires_at;

  it("expires the live emailed invite to their address in this house only", async () => {
    const db = seed();
    withSamAndEmailedInvite(db, " Sam@Example.test ");
    const receipt: any = await service(db).deleteMember(MANAGER, RID, "m-sam");

    expect(
      new Date(String(expiresAt(db, "inv-emailed"))).getTime(),
    ).toBeLessThanOrEqual(Date.now());
    expect(expiresAt(db, "inv-other-house")).toBe(LATER);
    expect(expiresAt(db, "inv-other-address")).toBe(LATER);
    expect(receipt.inviteCancelled).toBe(true);
    expect(db.tables.system_audit_log[0].changes?.invite_cancelled).toBe(true);
  });

  it("reads the address from their account when the roster row has none", async () => {
    const db = seed();
    withSamAndEmailedInvite(db, null);
    await service(db).deleteMember(MANAGER, RID, "m-sam");

    expect(
      new Date(String(expiresAt(db, "inv-emailed"))).getTime(),
    ).toBeLessThanOrEqual(Date.now());
  });

  it("refuses the removal, keeping their access, when the invite cannot be cancelled", async () => {
    const db = seed();
    withSamAndEmailedInvite(db, "sam@example.test");
    db.errors["organization_invites:update"] = { message: "invites down" };

    await expect(
      service(db).deleteMember(MANAGER, RID, "m-sam"),
    ).rejects.toThrow("Failed to remove member");
    expect(db.tables.team_members.find((m) => m.id === "m-sam")).toBeDefined();
    expect(
      db.tables.user_restaurant_access.find((a) => a.user_id === STAFF),
    ).toBeDefined();
    expect(expiresAt(db, "inv-emailed")).toBe(LATER);
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
      // The pay switch is a manager's; an owner has none and sees pay anyway
      // (ADR 0215, round 4 item 19).
      payAccess: false,
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
