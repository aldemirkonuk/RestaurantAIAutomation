import { ForbiddenException } from "@nestjs/common";
import {
  managerLeaveOwnerKey,
  TeamService,
  timeOffBellKey,
} from "./team.service";
import { asDatabaseService, makeStubDb, StubDb } from "./testing/supabase-stub";
import { LOGS_AWAY_ACTIONS_WITHHELD_FROM_STAFF } from "../logs/logs-timeline.service";

/**
 * F-1547, the rest (decision manager-leave, coordinator's call 2026-10-12):
 * a fellow manager may decide a manager's time off, nobody but an owner
 * decides their own, and the owners hear of every manager's leave — filed,
 * approved, turned down, re-marked paid/unpaid — with the days and paid or
 * unpaid, never an amount. A house with no owner row tells its managers.
 */

const RID = "restaurant-1";
const OWNER = "user-owner";
const MGR_A = "user-mgr-a";
const MGR_B = "user-mgr-b";
const MGR_C = "user-mgr-c";
const STAFF = "user-staff";
const WEEK = "2026-09-07";

function seed(opts: { owner?: boolean } = {}): StubDb {
  const owner = opts.owner ?? true;
  return makeStubDb({
    user_restaurant_access: [
      ...(owner
        ? [
            {
              id: "a0",
              user_id: OWNER,
              restaurant_id: RID,
              role: "owner",
              is_active: true,
            },
          ]
        : []),
      {
        id: "a1",
        user_id: MGR_A,
        restaurant_id: RID,
        role: "manager",
        is_active: true,
      },
      {
        id: "a2",
        user_id: MGR_B,
        restaurant_id: RID,
        role: "manager",
        is_active: true,
      },
      {
        id: "a3",
        user_id: MGR_C,
        restaurant_id: RID,
        role: "manager",
        is_active: true,
      },
      {
        id: "a4",
        user_id: STAFF,
        restaurant_id: RID,
        role: "staff",
        is_active: true,
      },
    ],
    team_members: [
      {
        id: "m-owner",
        restaurant_id: RID,
        user_id: OWNER,
        display_name: "Ada",
        hourly_wage: 40,
      },
      {
        id: "m-a",
        restaurant_id: RID,
        user_id: MGR_A,
        display_name: "Moe",
        hourly_wage: 31,
      },
      {
        id: "m-b",
        restaurant_id: RID,
        user_id: MGR_B,
        display_name: "Bea",
        hourly_wage: 32,
      },
      {
        id: "m-c",
        restaurant_id: RID,
        user_id: MGR_C,
        display_name: "Cem",
        hourly_wage: 33,
      },
      {
        id: "m-staff",
        restaurant_id: RID,
        user_id: STAFF,
        display_name: "Sam",
        hourly_wage: 20,
      },
    ],
    time_off_requests: [],
    notifications: [],
    system_audit_log: [],
    restaurants: [{ id: RID, country: "TR", currency: "TRY" }],
  });
}

const team = (db: StubDb) => new TeamService(asDatabaseService(db));
const file = (db: StubDb, by: string, memberId: string, leaveType?: string) =>
  team(db).createTimeOff(by, RID, {
    memberId,
    startDate: WEEK,
    endDate: WEEK,
    ...(leaveType ? { leaveType } : {}),
  } as any) as Promise<any>;
const asks = (db: StubDb) =>
  db.tables.notifications.filter(
    (n) => n.metadata?.action === "time_off_requested",
  );
const outcomes = (db: StubDb) =>
  db.tables.notifications.filter((n) =>
    String(n.metadata?.action ?? "").endsWith("_for_manager"),
  );

describe("F-1547 — a manager's leave: filed", () => {
  it("[REVERT-FAILS] a manager's own ask reaches every owner and every other manager", async () => {
    const db = seed();
    const req = await file(db, MGR_A, "m-a");
    expect(
      asks(db)
        .map((n) => n.user_id)
        .sort(),
    ).toEqual([MGR_B, MGR_C, OWNER].sort());
    expect(req.leadsTold).toBe(3);
    expect(asks(db)[0].group_key).toBe(timeOffBellKey(req.id));
  });

  it("[REVERT-FAILS] a manager filed for by a fellow manager reaches the owners, paid or unpaid said", async () => {
    const db = seed();
    const req = await file(db, MGR_A, "m-b", "paid");
    expect(asks(db).map((n) => n.user_id)).toEqual([OWNER]);
    expect(req.leadsTold).toBe(1);
    expect(asks(db)[0].message).toContain(", paid.");
    // Days and paid/unpaid only: no wage or amount on the line.
    expect(asks(db)[0].message).not.toMatch(/32|₺|TRY/);
  });

  it("[REVERT-FAILS] a house with no owner row tells its managers, never the manager it is about", async () => {
    const db = seed({ owner: false });
    await file(db, MGR_A, "m-b");
    expect(asks(db).map((n) => n.user_id)).toEqual([MGR_C]);
  });

  it("still tells nobody when a manager files for a staff member (control)", async () => {
    const db = seed();
    await file(db, MGR_A, "m-staff");
    expect(db.tables.notifications).toHaveLength(0);
  });
});

describe("F-1547 — a manager's leave: decided and re-marked", () => {
  it("lets a fellow manager decide it; nobody but an owner decides their own", async () => {
    const db = seed();
    const req = await file(db, MGR_A, "m-a");
    await expect(
      team(db).reviewTimeOff(MGR_A, RID, req.id, { status: "approved" } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      team(db).reviewTimeOff(MGR_A, RID, req.id, { status: "approved" } as any),
    ).rejects.toThrow("another manager or an owner decides it");
    const done: any = await team(db).reviewTimeOff(MGR_B, RID, req.id, {
      status: "approved",
      leaveType: "paid",
    } as any);
    expect(done).toMatchObject({ status: "approved", reviewed_by: MGR_B });
  });

  it("[REVERT-FAILS] tells the owners when a fellow manager approves it, under its own key, and files it", async () => {
    const db = seed();
    const req = await file(db, MGR_A, "m-a");
    const done: any = await team(db).reviewTimeOff(MGR_B, RID, req.id, {
      status: "approved",
      leaveType: "paid",
    } as any);
    expect(done.leadsTold).toBe(1);
    expect(done.audited).toBe(true);
    const [line] = outcomes(db);
    expect(line).toMatchObject({
      user_id: OWNER,
      group_key: managerLeaveOwnerKey(req.id),
      status: "unread",
    });
    expect(line.metadata.action).toBe("time_off_decided_for_manager");
    expect(line.message).toContain("Bea approved Moe's time off");
    expect(line.message).toContain("paid");
    expect(line.message).not.toMatch(/31|32|40|₺|TRY/);
    // The waiting line clears; the outcome line does not.
    expect(asks(db).every((n) => n.status === "read")).toBe(true);
    const audit = db.tables.system_audit_log.find(
      (r) => r.action === "time_off_decided_for_manager",
    );
    expect(audit).toMatchObject({ actor_id: MGR_B, entity_id: "m-a" });
    expect(audit!.changes.leave_type).toEqual({ from: "unknown", to: "paid" });
    expect(JSON.stringify(audit!.changes)).not.toMatch(/hourly_wage|amount/);
  });

  it("[REVERT-FAILS] tells the owners when it is turned down", async () => {
    const db = seed();
    const req = await file(db, MGR_A, "m-a");
    await team(db).reviewTimeOff(MGR_B, RID, req.id, {
      status: "denied",
    } as any);
    expect(outcomes(db).map((n) => n.message)).toEqual([
      expect.stringContaining("Bea turned down Moe's time off"),
    ]);
  });

  it("[REVERT-FAILS] tells the owners of a paid/unpaid re-mark, though the status stays", async () => {
    const db = seed();
    const req = await file(db, MGR_A, "m-a");
    await team(db).reviewTimeOff(MGR_B, RID, req.id, {
      status: "approved",
      leaveType: "paid",
    } as any);
    const again: any = await team(db).reviewTimeOff(MGR_C, RID, req.id, {
      status: "approved",
      leaveType: "unpaid",
    } as any);
    expect(again.requesterNotified).toBe(false);
    expect(again.leadsTold).toBe(1);
    const remark = outcomes(db).find(
      (n) => n.metadata.action === "time_off_remarked_for_manager",
    );
    expect(remark?.message).toContain("Cem changed Moe's time off");
    expect(remark?.message).toContain("from paid to unpaid");
    // The earlier decision line is still unread: the re-mark did not settle it.
    expect(outcomes(db).every((n) => n.status === "unread")).toBe(true);
  });

  it("[REVERT-FAILS] a house with no owner row tells its other managers of the decision", async () => {
    const db = seed({ owner: false });
    const req = await file(db, MGR_A, "m-a");
    await team(db).reviewTimeOff(MGR_B, RID, req.id, {
      status: "approved",
    } as any);
    expect(outcomes(db).map((n) => n.user_id)).toEqual([MGR_C]);
  });

  it("tells no owner when a staff member's leave is decided (control)", async () => {
    const db = seed();
    const req = await file(db, STAFF, "m-staff");
    const done: any = await team(db).reviewTimeOff(MGR_A, RID, req.id, {
      status: "approved",
      leaveType: "paid",
    } as any);
    expect(done.leadsTold).toBeUndefined();
    expect(outcomes(db)).toHaveLength(0);
  });

  it("refuses the decision when it cannot tell whose leave it is", async () => {
    const db = seed();
    const req = await file(db, STAFF, "m-staff");
    db.errors["user_restaurant_access:select"] = { message: "down" };
    const t = team(db);
    (t as any).assertAccess = async () => ({
      role: "manager",
      payAccess: false,
    });
    await expect(
      t.reviewTimeOff(MGR_A, RID, req.id, { status: "approved" } as any),
    ).rejects.toThrow("Could not check whose time off this is");
    expect(db.tables.time_off_requests[0].status).not.toBe("approved");
  });

  it("[REVERT-FAILS] keeps the outcome rows out of a staff reader's /logs", () => {
    expect(LOGS_AWAY_ACTIONS_WITHHELD_FROM_STAFF).toEqual(
      expect.arrayContaining([
        "time_off_decided_for_manager",
        "time_off_remarked_for_manager",
      ]),
    );
  });
});
