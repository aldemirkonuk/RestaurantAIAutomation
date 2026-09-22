import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
} from "@nestjs/common";
import { ScheduleService } from "./schedule.service";
import { TeamService } from "./team.service";
import {
  leaveInWeek,
  priceShift,
  WEEKLY_REVIEW_HOURS,
  workedHours,
} from "./pay-rules";
import { asDatabaseService, makeStubDb, StubDb } from "./testing/supabase-stub";

/**
 * /team pay defects — ADR 0215. The founder, 2026-09-21: "Fix /team first";
 * wages and labour cost "Owner only" (managers see hours but not money).
 *
 * 27 of these 34 cases fail against origin/main 9cfc4e96d (measured
 * 2026-09-21); the rest are controls (what must still work) and the pure rules
 * in `pay-rules.ts`, which main does not have. The defects:
 *
 *   W1  a manager's week carried every shift's `labor_cost`, and
 *       `labor_cost / hours` is the wage; `wage_visible` only blanked the
 *       roster, and switching it off hid wages from the owner too.
 *   W2  a manager could set any wage, their own included, with no record.
 *   H1  breaks were counted as work (4857 Art. 68).
 *   H2  the week's flag was `h > 40`, the US week; the Turkish week is 45, and
 *       over it is a review, never a price.
 *   H3  a called-out shift kept its cost beside the cover's.
 *   C1  copying a week carried the old `labor_cost` instead of re-pricing.
 *   L1  a person on paid leave has no shift, so the week read them as free.
 */

const RID = "restaurant-1";
const OWNER = "user-owner";
const MANAGER = "user-manager";
const STAFF = "user-staff";
const WEEK = "2026-09-07"; // a Monday

function seed(): StubDb {
  return makeStubDb({
    user_restaurant_access: [
      { id: "a1", user_id: OWNER, restaurant_id: RID, role: "owner", is_active: true },
      { id: "a2", user_id: MANAGER, restaurant_id: RID, role: "manager", is_active: true },
      { id: "a3", user_id: STAFF, restaurant_id: RID, role: "staff", is_active: true },
    ],
    users: [
      { user_id: OWNER, restaurant_id: RID, role: "owner", name: "Ada", email: "ada@example.test" },
      { user_id: MANAGER, restaurant_id: RID, role: "manager", name: "Moe", email: "moe@example.test" },
      { user_id: STAFF, restaurant_id: RID, role: "staff", name: "Sam", email: "sam@example.test" },
    ],
    team_members: [
      { id: "m-owner", restaurant_id: RID, user_id: OWNER, display_name: "Ada", hourly_wage: 40, created_at: "2026-01-01" },
      { id: "m-manager", restaurant_id: RID, user_id: MANAGER, display_name: "Moe", hourly_wage: 30, created_at: "2026-01-02" },
      { id: "m-staff", restaurant_id: RID, user_id: STAFF, display_name: "Sam", hourly_wage: 20, created_at: "2026-01-03" },
    ],
    team_settings: [
      // wage_visible: true is the case the old flag was supposed to cover.
      { restaurant_id: RID, labor_tracking_enabled: true, wage_visible: true, labor_target_pct: 30 },
    ],
    schedules: [{ id: "s1", restaurant_id: RID, week_start: WEEK, status: "draft" }],
    shifts: [],
    shift_breaks: [],
    schedule_receipts: [],
    coverage_templates: [],
    time_off_requests: [],
    notifications: [],
    system_audit_log: [],
  });
}

function teamOf(db: StubDb) {
  return new TeamService(asDatabaseService(db));
}
function scheduleOf(db: StubDb) {
  const team = teamOf(db);
  const notifications = { persistForRestaurant: jest.fn(async () => ({ inserted: 0 })) } as any;
  const push = { sendToUsers: jest.fn(async () => undefined) } as any;
  return new ScheduleService(asDatabaseService(db), team, notifications, push);
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

// ── W1: money is the owner's, on every response that carries it ──────────────

describe("W1 — a manager's week carries hours, never money", () => {
  function pricedWeek(db: StubDb) {
    db.tables.shifts.push(
      shift({ id: "sh1", member_id: "m-staff", labor_cost: 160 }),
      shift({ id: "sh2", member_id: "m-manager", labor_cost: 240 }),
    );
  }

  it("strips labor_cost from every shift a manager receives", async () => {
    const db = seed();
    pricedWeek(db);
    const week = await scheduleOf(db).getWeek(MANAGER, RID, WEEK);
    expect(week.shifts).toHaveLength(2);
    for (const s of week.shifts) expect("labor_cost" in s).toBe(false);
    // …including the manager's own shift: "including their own" was the leak.
    expect(week.shifts.find((s: any) => s.member_id === "m-manager")).toBeDefined();
  });

  it("gives a manager hours and no cost, no priced counts and no cost target", async () => {
    const db = seed();
    pricedWeek(db);
    const week = await scheduleOf(db).getWeek(MANAGER, RID, WEEK);
    expect(week.labor.moneyVisible).toBe(false);
    expect(week.labor.totalHours).toBe(16);
    for (const k of ["totalCost", "costComplete", "pricedShifts", "unpricedShifts", "targetPct", "leave"]) {
      expect(k in week.labor).toBe(false);
    }
  });

  it("gives the owner the money, whatever the retired flag says", async () => {
    const db = seed();
    pricedWeek(db);
    db.tables.team_settings[0].wage_visible = false; // used to hide it from the owner too
    const week = await scheduleOf(db).getWeek(OWNER, RID, WEEK);
    expect(week.labor.moneyVisible).toBe(true);
    expect(week.labor.totalCost).toBe(400);
    expect(week.shifts.map((s: any) => s.labor_cost).sort()).toEqual([160, 240]);
  });

  it("sends the owner the house's currency and country with the money, and a manager neither", async () => {
    const db = seed();
    db.tables.restaurants = [{ id: RID, currency: "TRY", country: "Türkiye" }];
    const owner = await scheduleOf(db).getWeek(OWNER, RID, WEEK);
    expect(owner.money).toEqual({ currency: "TRY", country: "Türkiye", readable: true });
    const manager = await scheduleOf(db).getWeek(MANAGER, RID, WEEK);
    expect("money" in manager).toBe(false);
  });

  it("does not return the retired wage_visible flag in the settings", async () => {
    const db = seed();
    const week = await scheduleOf(db).getWeek(OWNER, RID, WEEK);
    expect("wage_visible" in week.settings).toBe(false);
    expect(week.settings.moneyVisibleTo).toBe("owner");
  });

  it("strips hourly_wage from the roster for a manager even with wage_visible on", async () => {
    const db = seed();
    const roster = await teamOf(db).listMembers(MANAGER, RID);
    expect(roster).toHaveLength(3);
    for (const m of roster) expect("hourly_wage" in m).toBe(false);
  });

  it("shows the owner the roster's wages even with wage_visible off", async () => {
    const db = seed();
    db.tables.team_settings[0].wage_visible = false;
    const roster = await teamOf(db).listMembers(OWNER, RID);
    expect(roster.map((m: any) => m.hourly_wage).sort()).toEqual([20, 30, 40]);
  });

  it("strips labor_cost from the shift writers' replies to a manager", async () => {
    const db = seed();
    db.tables.shifts.push(shift({ id: "sh-open", member_id: null, state: "open", labor_cost: null }));
    const svc = scheduleOf(db);

    const created = await svc.createShift(MANAGER, RID, {
      memberId: "m-staff",
      shiftDate: WEEK,
      startTime: "09:00",
      endTime: "17:00",
    } as any);
    expect("labor_cost" in created).toBe(false);
    // …but the row itself is priced: the rule is about who is TOLD.
    expect(db.tables.shifts.find((s) => s.id === created.id)?.labor_cost).toBe(160);

    const updated = await svc.updateShift(MANAGER, RID, created.id, { endTime: "18:00" } as any);
    expect("labor_cost" in updated).toBe(false);

    const assigned = await svc.assignCover(MANAGER, RID, "sh-open", { memberId: "m-staff" } as any);
    expect("labor_cost" in assigned).toBe(false);

    const callout = await svc.reportCallout(MANAGER, RID, created.id, {} as any);
    expect("labor_cost" in callout.callout).toBe(false);
    expect("labor_cost" in callout.open).toBe(false);
  });

  it("returns labor_cost to the owner from the same writers", async () => {
    const db = seed();
    const created = await scheduleOf(db).createShift(OWNER, RID, {
      memberId: "m-staff",
      shiftDate: WEEK,
      startTime: "09:00",
      endTime: "17:00",
    } as any);
    expect(created.labor_cost).toBe(160);
  });
});

// ── W2: only an owner writes a wage, and each write names who ─────────────────

describe("W2 — a wage is written by an owner, with who in the same statement", () => {
  it("refuses a manager changing a colleague's wage, before any write", async () => {
    const db = seed();
    await expect(
      teamOf(db).updateMember(MANAGER, RID, "m-staff", { hourlyWage: 99 } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.opsOn("team_members", "update")).toHaveLength(0);
    expect(db.tables.team_members.find((m) => m.id === "m-staff")?.hourly_wage).toBe(20);
  });

  it("refuses a manager changing their OWN wage", async () => {
    const db = seed();
    await expect(
      teamOf(db).updateMember(MANAGER, RID, "m-manager", { hourlyWage: 999 } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.tables.team_members.find((m) => m.id === "m-manager")?.hourly_wage).toBe(30);
  });

  it("still lets a manager edit everything else about a person", async () => {
    const db = seed();
    const row = await teamOf(db).updateMember(MANAGER, RID, "m-staff", { position: "Bar" } as any);
    expect(row.position).toBe("Bar");
    expect("hourly_wage" in row).toBe(false);
    const [op] = db.opsOn("team_members", "update");
    expect("hourly_wage" in op.payload).toBe(false);
    expect("wage_changed_by" in op.payload).toBe(false);
  });

  it("writes an owner's wage change with the owner named in the same update", async () => {
    const db = seed();
    const row = await teamOf(db).updateMember(OWNER, RID, "m-staff", { hourlyWage: 25 } as any);
    expect(row.hourly_wage).toBe(25);
    const [op] = db.opsOn("team_members", "update");
    // One statement: the migration's trigger turns this into the change row
    // (old, new, who, when). Proved on PGlite, not here.
    expect(op.payload).toMatchObject({ hourly_wage: 25, wage_changed_by: OWNER });
  });

  it("refuses a manager adding a person WITH a wage, and adds nothing", async () => {
    const db = seed();
    await expect(
      teamOf(db).createMember(MANAGER, RID, { displayName: "New", hourlyWage: 18 } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.opsOn("team_members", "insert")).toHaveLength(0);
  });

  it("lets a manager add a person without a wage", async () => {
    const db = seed();
    const row = await teamOf(db).createMember(MANAGER, RID, { displayName: "New" } as any);
    expect(row.display_name).toBe("New");
    const [op] = db.opsOn("team_members", "insert");
    expect(op.payload.hourly_wage).toBeNull();
    expect("wage_changed_by" in op.payload).toBe(false);
  });

  it("names the owner on a wage set at creation", async () => {
    const db = seed();
    await teamOf(db).createMember(OWNER, RID, { displayName: "New", hourlyWage: 18 } as any);
    const [op] = db.opsOn("team_members", "insert");
    expect(op.payload).toMatchObject({ hourly_wage: 18, wage_changed_by: OWNER });
  });

  it("refuses the retired wage switch in words and saves nothing", async () => {
    const db = seed();
    await expect(
      teamOf(db).updateSettings(OWNER, RID, { wageVisible: false } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.opsOn("team_settings", "upsert")).toHaveLength(0);
  });

  it("does not hand the retired flag back from a settings save", async () => {
    const db = seed();
    // PostgREST's `upsert(...).select().single()` answers with EVERY column of
    // the row, the retired `wage_visible` included. The stub's upsert echoes
    // only the payload, so this answers the way the database does.
    const from = db.supabase.from;
    db.supabase.from = (table: string) =>
      table !== "team_settings"
        ? from(table)
        : {
            upsert: (patch: any) => ({
              select: () => ({
                single: async () => ({
                  data: { ...db.tables.team_settings[0], ...patch },
                  error: null,
                }),
              }),
            }),
          };
    const saved = await teamOf(db).updateSettings(OWNER, RID, {
      laborTrackingEnabled: false,
    } as any);
    expect(saved.labor_tracking_enabled).toBe(false);
    expect("wage_visible" in saved).toBe(false);
    expect(saved.moneyVisibleTo).toBe("owner");
  });
});

// ── H1-H3: hours are worked hours ────────────────────────────────────────────

describe("H1 — a break is not working time (4857 Art. 68)", () => {
  it("subtracts breaks from the week's hours and from the flag", async () => {
    const db = seed();
    // Five 10-hour shifts, each with a one-hour break: 45 worked hours, which
    // is the Turkish week and NOT over it. Counted as 50, it tripped the flag.
    for (let i = 0; i < 5; i++) {
      db.tables.shifts.push(
        shift({
          id: `sh${i}`,
          member_id: "m-staff",
          shift_date: `2026-09-${String(7 + i).padStart(2, "0")}`,
          start_time: "09:00",
          end_time: "19:00",
          labor_cost: 180,
          shift_breaks: [{ id: `b${i}`, duration_min: 60 }],
        }),
      );
    }
    const week = await scheduleOf(db).getWeek(MANAGER, RID, WEEK);
    expect(week.labor.totalHours).toBe(45);
    expect(week.labor.breakHours).toBe(5);
    expect(week.labor.overtime).toEqual([]);
  });

  it("prices a shift on its worked hours when it is re-priced", async () => {
    const db = seed();
    db.tables.shifts.push(
      shift({
        id: "sh1",
        member_id: "m-staff",
        start_time: "09:00",
        end_time: "18:00",
        labor_cost: 180,
        shift_breaks: [{ id: "b1", duration_min: 60 }],
      }),
    );
    await scheduleOf(db).updateShift(OWNER, RID, "sh1", { endTime: "19:00" } as any);
    // 10h span - 1h break = 9h x 20 = 180, not 200.
    expect(db.tables.shifts[0].labor_cost).toBe(180);
  });
});

describe("H2 — over 45 worked hours is a review, never a price", () => {
  function hoursFor(db: StubDb, perDay: string[]) {
    perDay.forEach((end, i) =>
      db.tables.shifts.push(
        shift({ id: `sh${i}`, member_id: "m-staff", shift_date: `2026-09-${String(7 + i).padStart(2, "0")}`, start_time: "09:00", end_time: end, labor_cost: 1 }),
      ),
    );
  }

  it("does not flag 44 hours, which the old 40-hour rule did", async () => {
    const db = seed();
    hoursFor(db, ["20:00", "20:00", "20:00", "20:00"]); // 4 x 11h = 44h
    const week = await scheduleOf(db).getWeek(MANAGER, RID, WEEK);
    expect(week.labor.overtime).toEqual([]);
    expect(week.labor.weeklyReviewHours).toBe(45);
  });

  it("flags 46 hours by person, with hours and no price", async () => {
    const db = seed();
    hoursFor(db, ["20:00", "20:00", "20:00", "20:00", "11:00"]); // 44 + 2 = 46h
    const week = await scheduleOf(db).getWeek(OWNER, RID, WEEK);
    expect(week.labor.overtime).toEqual([{ memberId: "m-staff", hours: 46 }]);
    expect(Object.keys(week.labor.overtime[0]).sort()).toEqual(["hours", "memberId"]);
  });

  it("keeps the review even when cost tracking is off: it is hours, not money", async () => {
    const db = seed();
    db.tables.team_settings[0].labor_tracking_enabled = false;
    hoursFor(db, ["20:00", "20:00", "20:00", "20:00", "11:00"]);
    const week = await scheduleOf(db).getWeek(MANAGER, RID, WEEK);
    expect(week.labor.enabled).toBe(false);
    expect(week.labor.overtime).toHaveLength(1);
  });
});

describe("H3 — a called-out shift is not worked", () => {
  it("leaves the called-out shift out of the hours and the cost", async () => {
    const db = seed();
    db.tables.shifts.push(
      shift({ id: "out", member_id: "m-manager", state: "callout", labor_cost: 240 }),
      shift({ id: "cover", member_id: "m-staff", state: "covered", labor_cost: 160 }),
    );
    const week = await scheduleOf(db).getWeek(OWNER, RID, WEEK);
    expect(week.labor.totalHours).toBe(8);
    expect(week.labor.totalCost).toBe(160);
  });
});

// ── C1: a copied week is priced at today's wage ──────────────────────────────

describe("C1 — copying a week re-prices it from the wage on file now", () => {
  function sourceWeek(db: StubDb) {
    db.tables.schedules.push({ id: "s-from", restaurant_id: RID, week_start: "2026-08-31", status: "published" });
    // Priced at 20/h last week. The wage is now 25.
    db.tables.shifts.push(
      shift({ id: "src1", schedule_id: "s-from", member_id: "m-staff", shift_date: "2026-08-31", labor_cost: 160 }),
    );
    db.tables.team_members.find((m) => m.id === "m-staff")!.hourly_wage = 25;
  }

  it("writes the copy at the current wage, not the source row's cost", async () => {
    const db = seed();
    sourceWeek(db);
    const r = await scheduleOf(db).copyWeek(MANAGER, RID, { fromWeekStart: "2026-08-31", toWeekStart: WEEK } as any);
    expect(r.copied).toBe(1);
    const copy = db.tables.shifts.find((s) => s.shift_date === WEEK);
    expect(copy?.labor_cost).toBe(200); // 8h x 25
  });

  it("copies nothing and deletes nothing when the wages cannot be read", async () => {
    const db = seed();
    sourceWeek(db);
    db.tables.shifts.push(shift({ id: "tgt1", member_id: "m-staff", labor_cost: 160 }));
    db.errors["team_members:select"] = { message: "boom" };
    await expect(
      scheduleOf(db).copyWeek(MANAGER, RID, { fromWeekStart: "2026-08-31", toWeekStart: WEEK, replaceTarget: true } as any),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(db.opsOn("shifts", "delete")).toHaveLength(0);
    expect(db.tables.shifts.find((s) => s.id === "tgt1")).toBeDefined();
  });
});

// ── L1: paid leave is not a free week ────────────────────────────────────────

describe("L1 — approved paid leave is counted beside the cost, in days", () => {
  it("tells the owner how many paid-leave days fall in the week", async () => {
    const db = seed();
    db.tables.shifts.push(shift({ id: "sh1", member_id: "m-manager", labor_cost: 240 }));
    db.tables.time_off_requests.push(
      // Two of these days fall in the week (Sat 12, Sun 13).
      { id: "t1", restaurant_id: RID, member_id: "m-staff", start_date: "2026-09-12", end_date: "2026-09-20", status: "approved", leave_type: "paid", reason: "private" },
      { id: "t2", restaurant_id: RID, member_id: "m-owner", start_date: WEEK, end_date: WEEK, status: "approved", leave_type: "unknown", reason: "private" },
      { id: "t3", restaurant_id: RID, member_id: "m-owner", start_date: WEEK, end_date: WEEK, status: "pending", leave_type: "paid", reason: "private" },
    );
    const week = await scheduleOf(db).getWeek(OWNER, RID, WEEK);
    expect(week.labor.totalCost).toBe(240);
    expect(week.labor.costCovers).toBe("scheduled_shifts");
    expect(week.labor.leave).toEqual({
      readable: true,
      paid: [{ memberId: "m-staff", days: 2 }],
      paidDays: 2,
      unknownTypeDays: 1,
    });
    // KVKK: the reason is never asked for.
    const [read] = db.opsOn("time_off_requests", "select");
    expect(read.columns).not.toMatch(/reason|\*/);
  });

  it("says the leave is unreadable rather than reading as nobody on leave", async () => {
    const db = seed();
    db.errors["time_off_requests:select"] = { message: "boom" };
    const week = await scheduleOf(db).getWeek(OWNER, RID, WEEK);
    expect(week.labor.leave.readable).toBe(false);
    expect(week.labor.leave.paidDays).toBeNull();
  });

  it("files and reviews a request with its type", async () => {
    const db = seed();
    const req = await teamOf(db).createTimeOff(STAFF, RID, {
      memberId: "m-staff",
      startDate: WEEK,
      endDate: WEEK,
      leaveType: "paid",
    } as any);
    expect(req.leave_type).toBe("paid");
    const reviewed = await teamOf(db).reviewTimeOff(MANAGER, RID, req.id, {
      status: "approved",
      leaveType: "unpaid",
    } as any);
    expect(reviewed.leave_type).toBe("unpaid");
  });
});

describe("a failed week read is an error, not an empty week", () => {
  it("refuses rather than reporting zero hours", async () => {
    const db = seed();
    db.errors["shifts:select"] = { message: "boom" };
    await expect(scheduleOf(db).getWeek(OWNER, RID, WEEK)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});

// ── the rules themselves ─────────────────────────────────────────────────────

describe("pay-rules", () => {
  it("works hours as the span minus breaks, never below zero", () => {
    expect(workedHours("09:00", "19:00", [{ duration_min: 60 }])).toBe(9);
    expect(workedHours("22:00", "02:00", [{ duration_min: 30 }])).toBe(3.5);
    expect(workedHours("09:00", "09:30", [{ duration_min: 60 }])).toBe(0);
    expect(workedHours("09:00", "17:00", null)).toBe(8);
  });

  it("prices an unpriced person as unknown, never as free", () => {
    expect(priceShift(null, "09:00", "17:00", [])).toBeNull();
    expect(priceShift(20, "09:00", "17:00", [{ duration_min: 30 }])).toBe(150);
  });

  it("the review line is the Turkish week", () => {
    expect(WEEKLY_REVIEW_HOURS).toBe(45);
  });

  it("counts only approved leave, clipped to the week", () => {
    const r = leaveInWeek(
      [
        { member_id: "a", start_date: "2026-09-01", end_date: "2026-09-08", status: "approved", leave_type: "paid" },
        { member_id: "b", start_date: "2026-09-09", end_date: "2026-09-09", status: "denied", leave_type: "paid" },
        { member_id: "c", start_date: "2026-09-10", end_date: "2026-09-10", status: "approved", leave_type: "unpaid" },
      ],
      WEEK,
    );
    expect(r).toEqual({ paid: [{ memberId: "a", days: 2 }], paidDays: 2, unknownTypeDays: 0 });
  });
});
