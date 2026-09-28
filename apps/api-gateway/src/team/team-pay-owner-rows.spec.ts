import {
  ForbiddenException,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { MembersService } from "../restaurants/members.service";
import { ScheduleService } from "./schedule.service";
import { TeamService } from "./team.service";
import { asDatabaseService, makeStubDb, StubDb } from "./testing/supabase-stub";

/**
 * /team, ADR 0215 round 6 — founder item 71 (2026-09-27), verbatim: "if owner
 * taking money, manager can't see it". An owner's wage is invisible to
 * managers — not shown, not settable, even with pay access.
 *
 * `team-pay-round4.spec.ts` R6 pins the pure rules (`seesMoneyOf`,
 * `wageWriteRefusal`) with hand-built viewers, and its one fail-closed case
 * replaces `ownerMemberIds` with a function returning `null`. That leaves the
 * layer that decides WHICH rows are an owner's — the two reads inside
 * `TeamService.ownerMemberIds`, and `assertAccess` turning their answer into a
 * viewer — tested only incidentally (the security review of PR #440 at
 * 42c43d1bf named this gap). This file drives it end to end:
 *
 *   - no viewer is built by hand and no method is replaced: every caller goes
 *     through the public service method, `assertAccess`, and the real
 *     `ownerMemberIds` over the stub's filtered tables;
 *   - the house has a real owner row (an owner membership whose account is
 *     linked to a roster row), a manager whose owner-set `team_pay_access` is
 *     on, and a person who owns ANOTHER house but is staff here;
 *   - the three surfaces the review named: the roster list, the per-person
 *     replies (the member save, the shift writers and the week — /team has no
 *     separate GET for one person), and the wage history (the owner's
 *     former-staff history, the only reader of `team_member_wage_changes`);
 *   - each of the two reads failing for real, at the database, withholds pay
 *     from the manager altogether rather than guessing whose it is.
 */

const RID = "restaurant-1";
const OTHER = "restaurant-2";
const OWNER = "user-owner";
const MANAGER = "user-manager";
const STAFF = "user-staff";
// Owns another house; here they are staff, and their pay is a colleague's.
const DUAL = "user-dual";
const WEEK = "2026-09-07"; // a Monday
const GONE = "m-gone";

function house(
  opts: { managerPay?: boolean; ownerActive?: boolean } = {},
): StubDb {
  return makeStubDb({
    user_restaurant_access: [
      {
        id: "a1",
        user_id: OWNER,
        restaurant_id: RID,
        role: "owner",
        is_active: opts.ownerActive !== false,
        team_pay_access: false,
      },
      {
        id: "a2",
        user_id: MANAGER,
        restaurant_id: RID,
        role: "manager",
        is_active: true,
        team_pay_access: opts.managerPay !== false,
      },
      {
        id: "a3",
        user_id: STAFF,
        restaurant_id: RID,
        role: "staff",
        is_active: true,
        team_pay_access: false,
      },
      {
        id: "a4",
        user_id: DUAL,
        restaurant_id: RID,
        role: "staff",
        is_active: true,
        team_pay_access: false,
      },
      {
        id: "a5",
        user_id: DUAL,
        restaurant_id: OTHER,
        role: "owner",
        is_active: true,
        team_pay_access: false,
      },
      // The owner here is a manager elsewhere: nothing about that house counts.
      {
        id: "a6",
        user_id: OWNER,
        restaurant_id: OTHER,
        role: "manager",
        is_active: true,
        team_pay_access: true,
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
      {
        user_id: DUAL,
        restaurant_id: OTHER,
        role: "owner",
        name: "Dee",
        email: "dee@example.test",
      },
    ],
    team_members: [
      {
        id: "m-owner",
        restaurant_id: RID,
        user_id: OWNER,
        display_name: "Ada",
        hourly_wage: 40,
        created_at: "2026-01-01",
      },
      {
        id: "m-manager",
        restaurant_id: RID,
        user_id: MANAGER,
        display_name: "Moe",
        hourly_wage: 30,
        created_at: "2026-01-02",
      },
      {
        id: "m-staff",
        restaurant_id: RID,
        user_id: STAFF,
        display_name: "Sam",
        hourly_wage: 20,
        created_at: "2026-01-03",
      },
      {
        id: "m-dual",
        restaurant_id: RID,
        user_id: DUAL,
        display_name: "Dee",
        hourly_wage: 25,
        created_at: "2026-01-04",
      },
      // The other house's rows: never this house's owner rows.
      {
        id: "m2-dual",
        restaurant_id: OTHER,
        user_id: DUAL,
        display_name: "Dee",
        hourly_wage: 99,
        created_at: "2026-01-05",
      },
      {
        id: "m2-owner",
        restaurant_id: OTHER,
        user_id: OWNER,
        display_name: "Ada",
        hourly_wage: 77,
        created_at: "2026-01-06",
      },
    ],
    team_settings: [
      {
        restaurant_id: RID,
        labor_tracking_enabled: true,
        wage_visible: true,
        labor_target_pct: 30,
      },
    ],
    restaurants: [{ id: RID, currency: "TRY", country: "TR" }],
    schedules: [
      { id: "s1", restaurant_id: RID, week_start: WEEK, status: "draft" },
    ],
    shifts: [
      shift({ id: "sh-owner", member_id: "m-owner", labor_cost: 300 }),
      shift({ id: "sh-staff", member_id: "m-staff", labor_cost: 150 }),
      shift({ id: "sh-dual", member_id: "m-dual", labor_cost: 187.5 }),
    ],
    shift_breaks: [],
    schedule_receipts: [],
    coverage_templates: [],
    time_off_requests: [],
    team_certifications: [],
    team_member_departures: [],
    team_member_wage_changes: [],
    notifications: [],
    system_audit_log: [],
  });
}

function shift(over: Record<string, any>) {
  return {
    restaurant_id: RID,
    schedule_id: "s1",
    shift_date: WEEK,
    start_time: "09:00",
    end_time: "17:00",
    state: "scheduled",
    shift_breaks: [],
    ...over,
  };
}

const teamOf = (db: StubDb) => new TeamService(asDatabaseService(db));
function scheduleOf(db: StubDb) {
  const notifications = {
    persistForRestaurant: jest.fn(async () => ({ inserted: 0 })),
  } as any;
  const push = { sendToUsers: jest.fn(async () => undefined) } as any;
  return new ScheduleService(
    asDatabaseService(db),
    teamOf(db),
    notifications,
    push,
  );
}

/** The first read: this house's owner memberships. */
const isOwnersRead = (table: string, filters: any[]) =>
  table === "user_restaurant_access" &&
  filters.some(
    (f) => f.kind === "eq" && f.column === "role" && f.value === "owner",
  );
/** The second read: the owners' roster rows here. */
const isOwnerRowsRead = (table: string, filters: any[]) =>
  table === "team_members" &&
  filters.some((f) => f.kind === "in" && f.column === "user_id");

/**
 * Make one read fail AT THE DATABASE — the stub answers `{ data: null, error }`
 * for exactly the matching query, and every other read on the same table still
 * answers. `db.errors` is per table and operation, which would also break the
 * membership read `assertAccess` makes first, so it cannot isolate these two.
 */
function failRead(
  db: StubDb,
  which: (table: string, filters: any[]) => boolean,
) {
  const from = db.supabase.from;
  db.supabase.from = (table: string) => {
    const b = from(table);
    const then = b.then.bind(b);
    b.then = (ok: any, ko: any) =>
      which(table, b.filters)
        ? Promise.resolve({ data: null, error: { message: "boom" } }).then(
            ok,
            ko,
          )
        : then(ok, ko);
    return b;
  };
}

const by = (rows: any[], id: string) => rows.find((r: any) => r.id === id);

describe("item 71 end to end — ownerMemberIds decides whose pay a pay-access manager is shown", () => {
  it("reads this house's owners by any membership, then only their roster rows here", async () => {
    const db = house();
    await teamOf(db).listMembers(MANAGER, RID);

    const owners = db
      .opsOn("user_restaurant_access", "select")
      .filter((o) => isOwnersRead(o.table, o.filters));
    expect(owners).toHaveLength(1);
    expect(owners[0].filters).toEqual(
      expect.arrayContaining([
        { kind: "eq", column: "restaurant_id", value: RID },
        { kind: "eq", column: "role", value: "owner" },
      ]),
    );
    // An inactive owner's pay is still an owner's: no is_active filter.
    expect(owners[0].filters.some((f) => f.column === "is_active")).toBe(false);

    const rows = db
      .opsOn("team_members", "select")
      .filter((o) => isOwnerRowsRead(o.table, o.filters));
    expect(rows).toHaveLength(1);
    expect(rows[0].filters).toEqual(
      expect.arrayContaining([
        { kind: "eq", column: "restaurant_id", value: RID },
        // DUAL owns the other house, not this one.
        { kind: "in", column: "user_id", value: [OWNER] },
      ]),
    );
  });

  it("list: every wage but the owner's, which says whose it is; the other house's owner is staff here", async () => {
    const db = house();
    const rows = await teamOf(db).listMembers(MANAGER, RID);
    expect(rows.map((r: any) => r.id).sort()).toEqual([
      "m-dual",
      "m-manager",
      "m-owner",
      "m-staff",
    ]);
    expect("hourly_wage" in by(rows, "m-owner")).toBe(false);
    expect(by(rows, "m-owner").pay_withheld).toBe("owner");
    expect(by(rows, "m-manager").hourly_wage).toBe(30);
    expect(by(rows, "m-staff").hourly_wage).toBe(20);
    expect(by(rows, "m-dual").hourly_wage).toBe(25);
    expect("pay_withheld" in by(rows, "m-dual")).toBe(false);
    expect(JSON.stringify(rows)).not.toMatch(/\b40\b/);
  });

  it("list: an owner whose membership here is inactive still has their pay withheld", async () => {
    const db = house({ ownerActive: false });
    // Someone must still own the house for a manager to reach it at all.
    db.tables.user_restaurant_access.push({
      id: "a7",
      user_id: "user-owner-2",
      restaurant_id: RID,
      role: "owner",
      is_active: true,
      team_pay_access: false,
    });
    const rows = await teamOf(db).listMembers(MANAGER, RID);
    expect("hourly_wage" in by(rows, "m-owner")).toBe(false);
    expect(by(rows, "m-staff").hourly_wage).toBe(20);
  });

  it("list: the owner sees every wage, the owner's own included, and nothing is marked withheld", async () => {
    const db = house();
    const rows = await teamOf(db).listMembers(OWNER, RID);
    expect(by(rows, "m-owner").hourly_wage).toBe(40);
    for (const r of rows) expect("pay_withheld" in r).toBe(false);
  });

  it("a manager without pay access is shown no wage at all, and the owner set is never read", async () => {
    const db = house({ managerPay: false });
    const rows = await teamOf(db).listMembers(MANAGER, RID);
    for (const r of rows) expect("hourly_wage" in r).toBe(false);
    expect(db.ops.filter((o) => isOwnersRead(o.table, o.filters))).toHaveLength(
      0,
    );
  });

  it("detail: the member save replies without the owner's wage, and with a colleague's", async () => {
    const db = house();
    const team = teamOf(db);
    const ownerReply = await team.updateMember(MANAGER, RID, "m-owner", {
      phone: "555",
    } as any);
    expect(ownerReply.phone).toBe("555");
    expect("hourly_wage" in ownerReply).toBe(false);
    expect(ownerReply.pay_withheld).toBe("owner");

    const staffReply = await team.updateMember(MANAGER, RID, "m-staff", {
      phone: "556",
    } as any);
    expect(staffReply.hourly_wage).toBe(20);
    const dualReply = await team.updateMember(MANAGER, RID, "m-dual", {
      phone: "557",
    } as any);
    expect(dualReply.hourly_wage).toBe(25);
  });

  it("detail: the owner's wage is not settable by the manager — refused before any write; a colleague's is", async () => {
    const db = house();
    const team = teamOf(db);
    const writesBefore = db.opsOn("team_members", "update").length;
    await expect(
      team.updateMember(MANAGER, RID, "m-owner", { hourlyWage: 45 } as any),
    ).rejects.toThrow(/Only an owner can set or change an owner's pay/);
    expect(db.opsOn("team_members", "update")).toHaveLength(writesBefore);
    expect(by(db.tables.team_members, "m-owner").hourly_wage).toBe(40);

    const saved = await team.updateMember(MANAGER, RID, "m-dual", {
      hourlyWage: 26,
    } as any);
    expect(saved.hourly_wage).toBe(26);
    expect(by(db.tables.team_members, "m-dual").wage_changed_by).toBe(MANAGER);
  });

  it("detail: the week and a shift written onto the owner carry no owner cost; the total leaves it out", async () => {
    const db = house();
    const svc = scheduleOf(db);
    const week = await svc.getWeek(MANAGER, RID, WEEK);
    expect(week.labor.moneyVisible).toBe(true);
    expect("labor_cost" in by(week.shifts, "sh-owner")).toBe(false);
    expect(by(week.shifts, "sh-owner").pay_withheld).toBe("owner");
    expect(by(week.shifts, "sh-staff").labor_cost).toBe(150);
    expect(by(week.shifts, "sh-dual").labor_cost).toBe(187.5);
    expect(week.labor.totalCost).toBe(337.5);
    expect(week.labor.ownerShiftsLeftOut).toBe(1);

    const created = await svc.createShift(MANAGER, RID, {
      memberId: "m-owner",
      shiftDate: WEEK,
      startTime: "09:00",
      endTime: "17:00",
    } as any);
    expect("labor_cost" in created).toBe(false);
    expect(created.pay_withheld).toBe("owner");
  });

  it("wage history: the former-staff history (the only reader of wage changes) is the owner's, not a pay-access manager's", async () => {
    const db = house();
    db.tables.team_member_departures.push({
      restaurant_id: RID,
      member_id: GONE,
      left_at: "2026-09-10T12:00:00.000Z",
    });
    db.tables.team_member_wage_changes.push(
      {
        restaurant_id: RID,
        member_id: GONE,
        old_wage: null,
        new_wage: 20,
        currency: "TRY",
        changed_by: OWNER,
        changed_by_role: "owner",
        changed_at: "2026-01-05T00:00:00.000Z",
      },
      {
        restaurant_id: RID,
        member_id: "m-owner",
        old_wage: 35,
        new_wage: 40,
        currency: "TRY",
        changed_by: OWNER,
        changed_by_role: "owner",
        changed_at: "2026-02-01T00:00:00.000Z",
      },
    );
    await expect(
      teamOf(db).listFormerStaff(MANAGER, RID),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.opsOn("team_member_wage_changes")).toHaveLength(0);

    const res = await teamOf(db).listFormerStaff(OWNER, RID);
    expect(res.people.map((p: any) => p.memberId)).toEqual([GONE]);
    expect(res.people[0].wageChanges).toEqual([
      {
        old_wage: null,
        new_wage: 20,
        currency: "TRY",
        changed_by_role: "owner",
        changed_at: "2026-01-05T00:00:00.000Z",
      },
    ]);
  });

  describe.each([
    ["the owners' memberships", isOwnersRead],
    ["the owners' roster rows", isOwnerRowsRead],
  ])("fail closed: %s unreadable at the database", (_label, which) => {
    it("list, detail and week show the manager no pay at all — not everyone's but the owner's", async () => {
      const db = house();
      failRead(db, which);
      const team = teamOf(db);
      const rows = await team.listMembers(MANAGER, RID);
      expect(rows).toHaveLength(4);
      for (const r of rows) expect("hourly_wage" in r).toBe(false);

      const reply = await team.updateMember(MANAGER, RID, "m-staff", {
        phone: "555",
      } as any);
      expect("hourly_wage" in reply).toBe(false);

      const week = await scheduleOf(db).getWeek(MANAGER, RID, WEEK);
      expect(week.labor.moneyVisible).toBe(false);
      for (const s of week.shifts) expect("labor_cost" in s).toBe(false);
    });

    it("no wage is written — the owner's or a colleague's", async () => {
      const db = house();
      failRead(db, which);
      const team = teamOf(db);
      for (const id of ["m-owner", "m-staff"]) {
        await expect(
          team.updateMember(MANAGER, RID, id, { hourlyWage: 50 } as any),
        ).rejects.toBeInstanceOf(ForbiddenException);
      }
      expect(db.opsOn("team_members", "update")).toHaveLength(0);
      expect(by(db.tables.team_members, "m-owner").hourly_wage).toBe(40);
      expect(by(db.tables.team_members, "m-staff").hourly_wage).toBe(20);
    });

    it("the owner is unaffected: they never read the owner set", async () => {
      const db = house();
      failRead(db, which);
      const rows = await teamOf(db).listMembers(OWNER, RID);
      expect(by(rows, "m-owner").hourly_wage).toBe(40);
    });
  });
});

/**
 * The ADR 0090 audit of PR #440 at ea4cc38d0: a co-owner REMOVED by
 * `deleteMember` (both their access row and roster row deleted, not made
 * inactive) keeps their shifts (item 20, migration 20261116000200 dropped the
 * foreign key), but `ownerMemberIds` is a live read and no longer names the
 * gone roster row — so `seesMoneyOf` read the kept shift as a colleague's.
 * The by-id shift routes checked no roster, so a switched-on manager's
 * note-only PATCH answered with the owner's stored cost, and any manager could
 * delete a record kept five years. A removed person's kept rows are owner-only
 * former-staff history (round 4 item 19): no by-id route reaches them.
 */
describe("item 71 + item 20 — a removed owner's kept shift is not reachable by id", () => {
  const OWNER2 = "user-owner-2";

  async function afterRemoval() {
    const db = house();
    db.tables.user_restaurant_access.push({
      id: "a8",
      user_id: OWNER2,
      restaurant_id: RID,
      role: "owner",
      is_active: true,
      team_pay_access: false,
    });
    db.tables.users.push({
      user_id: OWNER2,
      restaurant_id: RID,
      role: "owner",
      name: "Oz",
      email: "oz@example.test",
    });
    db.tables.team_members.push({
      id: "m-owner-2",
      restaurant_id: RID,
      user_id: OWNER2,
      display_name: "Oz",
      hourly_wage: 50,
      created_at: "2026-01-07",
    });
    db.tables.time_off_requests.push(
      {
        id: "to-owner",
        restaurant_id: RID,
        member_id: "m-owner",
        status: "pending",
      },
      {
        id: "to-staff",
        restaurant_id: RID,
        member_id: "m-staff",
        status: "pending",
      },
    );
    // The real removal, by the other owner.
    await teamOf(db).deleteMember(OWNER2, RID, "m-owner");
    // It is a removal, not a deactivation: both rows are gone, the shift and
    // the leave request are kept.
    expect(by(db.tables.team_members, "m-owner")).toBeUndefined();
    expect(
      db.tables.user_restaurant_access.some(
        (a: any) => a.user_id === OWNER && a.restaurant_id === RID,
      ),
    ).toBe(false);
    expect(by(db.tables.shifts, "sh-owner").labor_cost).toBe(300);
    expect(by(db.tables.time_off_requests, "to-owner")).toBeDefined();
    const push = { sendToUsers: jest.fn(async () => undefined) } as any;
    const notifications = {
      persistForRestaurant: jest.fn(async () => ({ inserted: 0 })),
    } as any;
    const svc = new ScheduleService(
      asDatabaseService(db),
      teamOf(db),
      notifications,
      push,
    );
    db.ops.length = 0;
    return { db, svc, push, notifications };
  }

  const kept = (db: StubDb) => by(db.tables.shifts, "sh-owner");
  const shiftWrites = (db: StubDb) =>
    db.ops.filter((o) => o.table === "shifts" && o.op !== "select");

  it("a note-only PATCH by a switched-on manager answers 404, with no cost and no write", async () => {
    const { db, svc } = await afterRemoval();
    const reply = svc.updateShift(MANAGER, RID, "sh-owner", {
      note: "x",
    } as any);
    await expect(reply).rejects.toBeInstanceOf(NotFoundException);
    await expect(reply).rejects.not.toHaveProperty("response.labor_cost");
    expect(shiftWrites(db)).toHaveLength(0);
    expect(kept(db).note).toBeUndefined();
    expect(kept(db).labor_cost).toBe(300);
  });

  it("delete answers 404 and keeps the record, for a manager and for the remaining owner", async () => {
    const { db, svc } = await afterRemoval();
    for (const who of [MANAGER, OWNER2]) {
      await expect(
        svc.deleteShift(who, RID, "sh-owner"),
      ).rejects.toBeInstanceOf(NotFoundException);
    }
    expect(db.opsOn("shifts", "delete")).toHaveLength(0);
    expect(kept(db)).toBeDefined();
  });

  it("call-out, offer and assign answer 404: nothing opened, nobody pushed, nothing reassigned", async () => {
    const { db, svc, push, notifications } = await afterRemoval();
    await expect(
      svc.reportCallout(MANAGER, RID, "sh-owner", {} as any),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      svc.offerCover(MANAGER, RID, "sh-owner", {
        memberIds: ["m-staff"],
      } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      svc.assignCover(MANAGER, RID, "sh-owner", { memberId: "m-staff" } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(shiftWrites(db)).toHaveLength(0);
    expect(push.sendToUsers).not.toHaveBeenCalled();
    expect(notifications.persistForRestaurant).not.toHaveBeenCalled();
    expect(kept(db).member_id).toBe("m-owner");
    expect(kept(db).state).toBe("scheduled");
  });

  it("the remaining owner cannot edit it by id either: it is history, read in former staff", async () => {
    const { db, svc } = await afterRemoval();
    await expect(
      svc.updateShift(OWNER2, RID, "sh-owner", { note: "x" } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(shiftWrites(db)).toHaveLength(0);
  });

  it("the removed person's kept leave request is not reviewed by id; a colleague's is", async () => {
    const { db } = await afterRemoval();
    const team = teamOf(db);
    await expect(
      team.reviewTimeOff(MANAGER, RID, "to-owner", {
        status: "approved",
      } as any),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(by(db.tables.time_off_requests, "to-owner").status).toBe("pending");
    const ok = await team.reviewTimeOff(MANAGER, RID, "to-staff", {
      status: "approved",
    } as any);
    expect(ok.status).toBe("approved");
  });

  it("a colleague's live shift is unchanged: PATCHed with its cost, deleted, an open shift assigned", async () => {
    const { db, svc } = await afterRemoval();
    const reply = await svc.updateShift(MANAGER, RID, "sh-staff", {
      note: "y",
    } as any);
    expect(reply.labor_cost).toBe(150);
    db.tables.shifts.push(
      shift({
        id: "sh-open",
        member_id: null,
        state: "open",
        labor_cost: null,
      }),
    );
    const assigned = await svc.assignCover(MANAGER, RID, "sh-open", {
      memberId: "m-staff",
    } as any);
    expect(assigned.member_id).toBe("m-staff");
    await svc.deleteShift(MANAGER, RID, "sh-staff");
    expect(by(db.tables.shifts, "sh-staff")).toBeUndefined();
  });

  it("delete says what happened: a missing shift is 404, a failed read or delete is 500, never done", async () => {
    const { db, svc } = await afterRemoval();
    await expect(
      svc.deleteShift(MANAGER, RID, "sh-nope"),
    ).rejects.toBeInstanceOf(NotFoundException);
    db.errors["shifts:delete"] = { message: "boom" };
    await expect(
      svc.deleteShift(MANAGER, RID, "sh-staff"),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    delete db.errors["shifts:delete"];
    db.errors["shifts:select"] = { message: "boom" };
    await expect(
      svc.deleteShift(MANAGER, RID, "sh-staff"),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(db.opsOn("shifts", "delete")).toHaveLength(1); // the failed one
    expect(by(db.tables.shifts, "sh-staff")).toBeDefined();
  });

  it("an unreadable roster refuses, never passes the kept shift through", async () => {
    const { db, svc } = await afterRemoval();
    failRead(
      db,
      (table, filters) =>
        table === "team_members" &&
        filters.length === 1 &&
        filters[0].column === "restaurant_id",
    );
    await expect(
      svc.updateShift(MANAGER, RID, "sh-owner", { note: "x" } as any),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(shiftWrites(db)).toHaveLength(0);
  });
});

/**
 * Residual (t), ADR 0215 — PINNED AS BUILT, NOT DECIDED. Found by the ADR 0090
 * audit of PR #440 at 78125580a: `MembersService.updateMemberRole` lets one
 * owner change another owner's role in place (only the last owner's
 * SELF-demotion is refused), and `ownerMemberIds` reads the owner set live on
 * `role = 'owner'`. So the moment an owner is made a manager, their roster
 * row is a colleague's to a pay-access manager: their wage and the stored
 * cost of shifts worked while they owned the house are shown. Whether a
 * former owner's pay stays the owners' (and which part of it: the owner-period
 * shifts, the wage, or both) is the founder's call, returned as "Open, for the
 * founder" question 8. These cases fail the day it is answered and built —
 * flip them to the answer then, as R6 was flipped for question 7.
 */
describe("residual (t), pinned as built — an owner demoted to manager in place", () => {
  const OWNER2 = "user-owner-2";

  async function afterDemotion() {
    const db = house();
    db.tables.user_restaurant_access.push({
      id: "a8",
      user_id: OWNER2,
      restaurant_id: RID,
      role: "owner",
      is_active: true,
      team_pay_access: false,
    });
    db.tables.users.push({
      user_id: OWNER2,
      restaurant_id: RID,
      role: "owner",
      name: "Oz",
      email: "oz@example.test",
    });
    // Before: the owner's pay is withheld from the switched-on manager.
    const before = await teamOf(db).listMembers(MANAGER, RID);
    expect("hourly_wage" in by(before, "m-owner")).toBe(false);
    // The real role change, by the other owner: an ordinary, allowed action.
    await new MembersService(asDatabaseService(db)).updateMemberRole(
      OWNER2,
      RID,
      OWNER,
      "manager",
    );
    expect(
      db.tables.user_restaurant_access.find(
        (a: any) => a.user_id === OWNER && a.restaurant_id === RID,
      ).role,
    ).toBe("manager");
    return db;
  }

  it("the former owner's wage is shown to a pay-access manager, unmarked", async () => {
    const db = await afterDemotion();
    const rows = await teamOf(db).listMembers(MANAGER, RID);
    expect(by(rows, "m-owner").hourly_wage).toBe(40);
    expect("pay_withheld" in by(rows, "m-owner")).toBe(false);
  });

  it("a shift priced while they owned the house carries its cost, and the total holds it", async () => {
    const db = await afterDemotion();
    const week = await scheduleOf(db).getWeek(MANAGER, RID, WEEK);
    expect(by(week.shifts, "sh-owner").labor_cost).toBe(300);
    expect(week.labor.totalCost).toBe(637.5);
    expect(week.labor.ownerShiftsLeftOut ?? 0).toBe(0);
  });

  it("a manager without pay access still sees none of it", async () => {
    const db = await afterDemotion();
    const acc = db.tables.user_restaurant_access.find(
      (a: any) => a.user_id === MANAGER && a.restaurant_id === RID,
    );
    acc.team_pay_access = false;
    const rows = await teamOf(db).listMembers(MANAGER, RID);
    for (const r of rows) expect("hourly_wage" in r).toBe(false);
  });
});
