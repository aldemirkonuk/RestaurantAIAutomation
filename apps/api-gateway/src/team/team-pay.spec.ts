import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
} from "@nestjs/common";
import { ScheduleService } from "./schedule.service";
import { TeamService } from "./team.service";
import {
  art68BreakForWork,
  art68MinimumBreak,
  breakCounted,
  labourSettingsRefusal,
  leaveInWeek,
  priceShift,
  WEEKLY_REVIEW_HOURS,
  workedHours,
} from "./pay-rules";
import {
  WAGE_RETENTION_CRON,
  WageRecordRetentionService,
} from "./wage-record-retention.service";
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
 *
 * Round 2 (the founder's "Take all five", same day) adds B1, S1, L3 and R1 at
 * the end of this file. Those cases were not counted against 48df6d91b one by
 * one: this file imports rules that tree does not have, so there it does not
 * compile at all. Each is instead held by a killed mutation (ADR 0215,
 * Evidence).
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
    // Two 8-hour shifts with no break on record: each is counted with the
    // Art. 68 minimum, 30 minutes (founder 2026-09-21), so 15 worked hours.
    expect(week.labor.totalHours).toBe(15);
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
    // …but the row itself is priced: the rule is about who is TOLD. 8h with
    // no break recorded is 7.5h worked (the assumed Art. 68 minimum) x 20.
    expect(db.tables.shifts.find((s) => s.id === created.id)?.labor_cost).toBe(150);

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
    expect(created.labor_cost).toBe(150); // 7.5 worked hours (assumed break) x 20
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
            // The save reads the settings first, for the record it writes.
            select: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: { ...db.tables.team_settings[0] },
                  error: null,
                }),
              }),
            }),
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
        // Recorded as no break taken (0), so the hours are the spans and the
        // case stays about the 45-hour line, not about the assumed break.
        shift({ id: `sh${i}`, member_id: "m-staff", shift_date: `2026-09-${String(7 + i).padStart(2, "0")}`, start_time: "09:00", end_time: end, labor_cost: 1, recorded_break_min: 0 }),
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
      shift({ id: "out", member_id: "m-manager", state: "callout", labor_cost: 240, recorded_break_min: 0 }),
      shift({ id: "cover", member_id: "m-staff", state: "covered", labor_cost: 160, recorded_break_min: 0 }),
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
      shift({ id: "src1", schedule_id: "s-from", member_id: "m-staff", shift_date: "2026-08-31", labor_cost: 160, recorded_break_min: 0 }),
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
  const at = (start_time: string, end_time: string, over: Record<string, any> = {}) => ({
    start_time,
    end_time,
    ...over,
  });

  it("works hours as the span minus the break on record, never below zero", () => {
    expect(workedHours(at("09:00", "19:00", { shift_breaks: [{ duration_min: 60 }] }))).toBe(9);
    expect(workedHours(at("22:00", "02:00", { shift_breaks: [{ duration_min: 30 }] }))).toBe(3.5);
    expect(workedHours(at("09:00", "09:30", { shift_breaks: [{ duration_min: 60 }] }))).toBe(0);
    // Recorded as no break taken: the whole span is worked.
    expect(workedHours(at("09:00", "17:00", { recorded_break_min: 0 }))).toBe(8);
  });

  it("prices an unpriced person as unknown, never as free", () => {
    expect(priceShift(null, at("09:00", "17:00"))).toBeNull();
    expect(priceShift(20, at("09:00", "17:00", { shift_breaks: [{ duration_min: 30 }] }))).toBe(150);
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

// ── Round 2: the founder's five answers, 2026-09-21 ("Take all five") ────────
//
//   B1  a shift over 4 hours with no break recorded is counted with the 4857
//       Art. 68 minimum, shown as assumed; whoever edits the shift records the
//       real one.
//   R1  a wage record is kept five years after its person leaves the roster,
//       then deleted (the rule is the database's; the job only calls it).
//   S1  only the owner switches labour-cost tracking off or changes the target.
//   L2  paid leave stays as days (L1 above: the leave block carries days only).
//   L3  whoever approves leave marks it paid or unpaid; staff may say so on
//       their own request.

describe("B1 — the Art. 68 minimum, keyed on worked time", () => {
  it("owes 15 / 30 / 60 minutes by the length of the WORK", () => {
    expect(art68BreakForWork(240)).toBe(15); // (a) 4 hours or less
    expect(art68BreakForWork(241)).toBe(30); // (b) over 4 hours ...
    expect(art68BreakForWork(450)).toBe(30); // ... up to and including 7.5
    expect(art68BreakForWork(451)).toBe(60); // (c) over 7.5 hours
  });

  it("gives a shift the least statutory break its remaining work allows", () => {
    expect(art68MinimumBreak(241)).toBe(15); // 3h46m of work
    expect(art68MinimumBreak(255)).toBe(15); // 4h of work: (a)
    expect(art68MinimumBreak(256)).toBe(30); // 15 would leave 4h01m: (b)
    expect(art68MinimumBreak(480)).toBe(30); // an 8-hour shift is 7.5h of work
    expect(art68MinimumBreak(481)).toBe(60); // 30 would leave 7h31m: (c)
    expect(art68MinimumBreak(600)).toBe(60);
  });

  it("assumes a break only over 4 hours, and only with nothing on record", () => {
    const at = (start_time: string, end_time: string, over: Record<string, any> = {}) => ({ start_time, end_time, ...over });
    expect(breakCounted(at("09:00", "13:00"))).toEqual({ minutes: 0, assumed: false });
    expect(breakCounted(at("09:00", "13:01"))).toEqual({ minutes: 15, assumed: true });
    expect(breakCounted(at("09:00", "17:00"))).toEqual({ minutes: 30, assumed: true });
    expect(breakCounted(at("22:00", "07:00"))).toEqual({ minutes: 60, assumed: true }); // overnight 9h
    expect(breakCounted(at("09:00", "19:00", { recorded_break_min: 0 }))).toEqual({ minutes: 0, assumed: false });
    expect(breakCounted(at("09:00", "19:00", { recorded_break_min: 45 }))).toEqual({ minutes: 45, assumed: false });
    expect(breakCounted(at("09:00", "19:00", { shift_breaks: [{ duration_min: 20 }] }))).toEqual({ minutes: 20, assumed: false });
    // The editor's record is the latest word and wins over planned rows.
    expect(
      breakCounted(at("09:00", "19:00", { shift_breaks: [{ duration_min: 20 }], recorded_break_min: 50 })),
    ).toEqual({ minutes: 50, assumed: false });
  });

  it("counts the week with the assumed breaks and says how much is assumed", async () => {
    const db = seed();
    db.tables.shifts.push(
      shift({ id: "a", member_id: "m-staff", labor_cost: 150 }), // 8h, nothing recorded
      shift({ id: "b", member_id: "m-manager", end_time: "19:00", recorded_break_min: 45, labor_cost: 277.5 }),
    );
    for (const who of [MANAGER, OWNER]) {
      const week = await scheduleOf(db).getWeek(who, RID, WEEK);
      expect(week.labor.totalHours).toBe(16.8); // 7.5 + 9.25, rounded to a tenth
      expect(week.labor.breakHours).toBe(1.3); // 0.5 assumed + 0.75 recorded
      expect(week.labor.assumedBreakHours).toBe(0.5);
      expect(week.labor.assumedBreakShifts).toBe(1);
    }
  });

  it("records the break a writer gives and prices the shift on it", async () => {
    const db = seed();
    const created = await scheduleOf(db).createShift(OWNER, RID, {
      memberId: "m-staff",
      shiftDate: WEEK,
      startTime: "09:00",
      endTime: "18:00",
      breakMinutes: 45,
    } as any);
    const row = db.tables.shifts.find((s) => s.id === created.id)!;
    expect(row.recorded_break_min).toBe(45);
    expect(row.labor_cost).toBe(165); // (9h - 45m) x 20
  });

  it("records nothing when the writer says nothing, and prices on the assumed minimum", async () => {
    const db = seed();
    const created = await scheduleOf(db).createShift(OWNER, RID, {
      memberId: "m-staff",
      shiftDate: WEEK,
      startTime: "09:00",
      endTime: "19:00",
    } as any);
    const row = db.tables.shifts.find((s) => s.id === created.id)!;
    expect("recorded_break_min" in row).toBe(false);
    expect(row.labor_cost).toBe(180); // (10h - 60m assumed) x 20
  });

  it("refuses a break as long as the shift, in words, and writes nothing", async () => {
    const db = seed();
    db.tables.schedules.length = 0;
    await expect(
      scheduleOf(db).createShift(OWNER, RID, {
        memberId: "m-staff",
        shiftDate: WEEK,
        startTime: "09:00",
        endTime: "13:00",
        breakMinutes: 240,
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.opsOn("shifts", "insert")).toHaveLength(0);
    expect(db.opsOn("schedules", "insert")).toHaveLength(0);
  });

  it("lets whoever edits the shift record, zero, and clear the break", async () => {
    const db = seed();
    db.tables.shifts.push(shift({ id: "e1", member_id: "m-staff", end_time: "19:00", labor_cost: 180 }));
    const svc = scheduleOf(db);
    const row = () => db.tables.shifts.find((s) => s.id === "e1")!;

    await svc.updateShift(MANAGER, RID, "e1", { breakMinutes: 30 } as any);
    expect(row().recorded_break_min).toBe(30);
    expect(row().labor_cost).toBe(190); // 9.5h x 20

    await svc.updateShift(MANAGER, RID, "e1", { breakMinutes: 0 } as any);
    expect(row().recorded_break_min).toBe(0);
    expect(row().labor_cost).toBe(200); // no break taken: 10h x 20

    // A time change says nothing about the break: the record stays.
    await svc.updateShift(MANAGER, RID, "e1", { endTime: "18:00" } as any);
    expect(row().recorded_break_min).toBe(0);
    expect(row().labor_cost).toBe(180); // 9h x 20

    // Cleared: counted with the assumed minimum again.
    await svc.updateShift(MANAGER, RID, "e1", { breakMinutes: null } as any);
    expect(row().recorded_break_min).toBeNull();
    expect(row().labor_cost).toBe(160); // (9h - 60m assumed) x 20
  });

  it("refuses new times the break on record no longer fits, and writes nothing", async () => {
    const db = seed();
    db.tables.shifts.push(
      shift({ id: "e3", member_id: "m-staff", end_time: "19:00", recorded_break_min: 60, labor_cost: 180 }),
    );
    const svc = scheduleOf(db);
    await expect(
      svc.updateShift(MANAGER, RID, "e3", { endTime: "10:00" } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.opsOn("shifts", "update")).toHaveLength(0);
    // A shorter shift the break still fits is a plain edit.
    await svc.updateShift(MANAGER, RID, "e3", { endTime: "10:01" } as any);
    expect(db.tables.shifts.find((s) => s.id === "e3")?.labor_cost).toBe(0.33); // 1 min x 20
  });

  it("answers a failed shift read with an error, not 'not found', and changes nothing", async () => {
    const db = seed();
    db.tables.shifts.push(shift({ id: "e2", member_id: "m-staff", labor_cost: 150 }));
    db.errors["shifts:select"] = { message: "boom" };
    await expect(
      scheduleOf(db).updateShift(MANAGER, RID, "e2", { breakMinutes: 30 } as any),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(db.opsOn("shifts", "update")).toHaveLength(0);
  });

  it("copies the break on record, and leaves nothing on record as nothing", async () => {
    const db = seed();
    db.tables.schedules.push({ id: "s-from", restaurant_id: RID, week_start: "2026-08-31", status: "published" });
    db.tables.shifts.push(
      shift({ id: "c1", schedule_id: "s-from", member_id: "m-staff", shift_date: "2026-08-31", end_time: "19:00", recorded_break_min: 45 }),
      shift({ id: "c2", schedule_id: "s-from", member_id: "m-staff", shift_date: "2026-09-01", end_time: "19:00" }),
      // Planned breaks only: their minutes become the copy's recorded break.
      shift({ id: "c3", schedule_id: "s-from", member_id: "m-staff", shift_date: "2026-09-02", end_time: "19:00", shift_breaks: [{ duration_min: 20 }] }),
    );
    await scheduleOf(db).copyWeek(MANAGER, RID, { fromWeekStart: "2026-08-31", toWeekStart: WEEK } as any);
    const one = db.tables.shifts.find((s) => s.shift_date === WEEK)!;
    const two = db.tables.shifts.find((s) => s.shift_date === "2026-09-08")!;
    expect(one.recorded_break_min).toBe(45);
    expect(one.labor_cost).toBe(185); // 9.25h x 20
    expect(two.recorded_break_min).toBeNull();
    expect(two.labor_cost).toBe(180); // (10h - 60m assumed) x 20
    const three = db.tables.shifts.find((s) => s.shift_date === "2026-09-09")!;
    expect(three.recorded_break_min).toBe(20);
    expect(three.labor_cost).toBe(193.33); // (10h - 20m) x 20
  });

  it("opens a call-out's cover slot with the break on record for the slot", async () => {
    const db = seed();
    db.tables.shifts.push(shift({ id: "co", member_id: "m-staff", end_time: "19:00", recorded_break_min: 20, labor_cost: 193.33 }));
    const r = await scheduleOf(db).reportCallout(MANAGER, RID, "co", {} as any);
    expect(db.tables.shifts.find((s) => s.id === r.open.id)?.recorded_break_min).toBe(20);
  });

  it("prices a cover on the break on record, and a failed read of it assigns nothing", async () => {
    const db = seed();
    db.tables.shifts.push(
      shift({ id: "sh-open", member_id: null, state: "open", end_time: "19:00", recorded_break_min: 20, labor_cost: null }),
    );
    const svc = scheduleOf(db);
    // The second read of `shifts` is the one that prices the cover; fail only it.
    const realFrom = db.supabase.from.bind(db.supabase);
    let shiftReads = 0;
    (db.supabase as any).from = (t: string) => {
      if (t === "shifts" && ++shiftReads === 2) db.errors["shifts:select"] = { message: "boom" };
      return realFrom(t);
    };
    await expect(
      svc.assignCover(OWNER, RID, "sh-open", { memberId: "m-staff" } as any),
    ).rejects.toThrow(/Could not read this shift to price the cover/);
    const row = db.tables.shifts.find((s) => s.id === "sh-open");
    expect(row?.member_id).toBeNull();
    expect(row?.labor_cost).toBeNull();

    // And read, it is priced on the break on record: (10h - 20m) x 20.
    delete db.errors["shifts:select"];
    (db.supabase as any).from = realFrom;
    await svc.assignCover(OWNER, RID, "sh-open", { memberId: "m-staff" } as any);
    expect(db.tables.shifts.find((s) => s.id === "sh-open")?.labor_cost).toBe(193.33);
  });
});

describe("S1 — only the owner switches tracking off or changes the target", () => {
  it("refuses a manager switching tracking off, before any write", async () => {
    const db = seed();
    await expect(
      teamOf(db).updateSettings(MANAGER, RID, { laborTrackingEnabled: false } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.opsOn("team_settings", "upsert")).toHaveLength(0);
    expect(db.opsOn("system_audit_log", "insert")).toHaveLength(0);
  });

  it("refuses a manager changing the target, before any write", async () => {
    const db = seed();
    await expect(
      teamOf(db).updateSettings(MANAGER, RID, { laborTargetPct: 25 } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.opsOn("team_settings", "upsert")).toHaveLength(0);
  });

  it("lets a manager switch tracking on (not named in the pick; returned as a question)", async () => {
    const db = seed();
    db.tables.team_settings[0].labor_tracking_enabled = false;
    const saved = await teamOf(db).updateSettings(MANAGER, RID, { laborTrackingEnabled: true } as any);
    expect(saved.labor_tracking_enabled).toBe(true);
  });

  it("lets the owner switch tracking off and change the target, and records who did", async () => {
    const db = seed();
    await teamOf(db).updateSettings(OWNER, RID, { laborTrackingEnabled: false, laborTargetPct: 25 } as any);
    const [audit] = db.opsOn("system_audit_log", "insert");
    expect(audit.payload).toMatchObject({
      actor_id: OWNER,
      action: "team_labour_settings_changed",
      entity_type: "team_settings",
      restaurant_id: RID,
      changes: {
        role: "owner",
        labor_tracking_enabled: { from: true, to: false },
        labor_target_pct: { from: 30, to: 25 },
      },
    });
  });

  it("records nothing for a save that moved nothing", async () => {
    const db = seed();
    const saved = await teamOf(db).updateSettings(OWNER, RID, { laborTargetPct: 30 } as any);
    expect(saved.audited).toBeNull();
    expect(db.opsOn("system_audit_log", "insert")).toHaveLength(0);
  });

  it("saves nothing when the current settings cannot be read", async () => {
    const db = seed();
    db.errors["team_settings:select"] = { message: "boom" };
    await expect(
      teamOf(db).updateSettings(OWNER, RID, { laborTargetPct: 25 } as any),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(db.opsOn("team_settings", "upsert")).toHaveLength(0);
  });

  it("tells each viewer what they may change", async () => {
    const db = seed();
    expect((await teamOf(db).getSettings(OWNER, RID)).mayChange).toEqual({ trackingOff: true, trackingOn: true, target: true });
    expect((await teamOf(db).getSettings(MANAGER, RID)).mayChange).toEqual({ trackingOff: false, trackingOn: true, target: false });
    expect((await teamOf(db).getSettings(STAFF, RID)).mayChange).toEqual({ trackingOff: false, trackingOn: false, target: false });
  });

  it("the rule, on its own", () => {
    expect(labourSettingsRefusal("owner", { laborTrackingEnabled: false, laborTargetPct: 1 })).toBeNull();
    expect(labourSettingsRefusal("manager", { laborTrackingEnabled: false })).toMatch(/Only the owner/);
    expect(labourSettingsRefusal("manager", { laborTargetPct: 30 })).toMatch(/Only the owner/);
    expect(labourSettingsRefusal("manager", { laborTrackingEnabled: true })).toBeNull();
  });
});

describe("L3 — whoever approves marks leave paid or unpaid; staff may say so", () => {
  it("keeps what the person said when the approver says nothing", async () => {
    const db = seed();
    const req = await teamOf(db).createTimeOff(STAFF, RID, {
      memberId: "m-staff",
      startDate: WEEK,
      endDate: WEEK,
      leaveType: "unpaid",
    } as any);
    const reviewed = await teamOf(db).reviewTimeOff(OWNER, RID, req.id, { status: "approved" } as any);
    expect(reviewed.leave_type).toBe("unpaid");
  });

  it("does not let staff state it for someone else, nor review their own", async () => {
    const db = seed();
    await expect(
      teamOf(db).createTimeOff(STAFF, RID, { memberId: "m-manager", startDate: WEEK, endDate: WEEK, leaveType: "paid" } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
    const req = await teamOf(db).createTimeOff(STAFF, RID, { memberId: "m-staff", startDate: WEEK, endDate: WEEK } as any);
    await expect(
      teamOf(db).reviewTimeOff(STAFF, RID, req.id, { status: "approved", leaveType: "paid" } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.tables.time_off_requests.find((r) => r.id === req.id)?.leave_type).toBeUndefined();
  });
});

describe("R1 — the wage record's retention job", () => {
  const svcWith = (rpc: jest.Mock) =>
    new WageRecordRetentionService({ supabase: { rpc } } as any);

  it("calls the database's purge and reports its counts", async () => {
    const rpc = jest.fn(async () => ({ data: [{ wage_rows_deleted: 3, departures_deleted: 1 }], error: null }));
    const run = await svcWith(rpc).purgeExpired();
    expect(rpc).toHaveBeenCalledWith("purge_expired_wage_records");
    expect(run).toMatchObject({ ok: true, wageRowsDeleted: 3, departuresDeleted: 1 });
  });

  it("reports a failed purge as failed, never as nothing due", async () => {
    const rpc = jest.fn(async () => ({ data: null, error: { message: "boom" } }));
    const run = await svcWith(rpc).purgeExpired();
    expect(run).toMatchObject({ ok: false, wageRowsDeleted: null, departuresDeleted: null, error: "boom" });
  });

  it("reports an answer without its counts as failed, not as 0 deleted", async () => {
    const rpc = jest.fn(async () => ({ data: [{}], error: null }));
    const run = await svcWith(rpc).purgeExpired();
    expect(run.ok).toBe(false);
    expect(run.wageRowsDeleted).toBeNull();
  });

  it("reports a thrown call as failed", async () => {
    const rpc = jest.fn(async () => {
      throw new Error("network");
    });
    const run = await svcWith(rpc).purgeExpired();
    expect(run).toMatchObject({ ok: false, error: "network" });
  });

  it("reads null counts as no answer, not as 0 deleted", async () => {
    // Number(null) is 0: without the guard this run would report "0 deleted".
    const rpc = jest.fn(async () => ({
      data: [{ wage_rows_deleted: null, departures_deleted: null }],
      error: null,
    }));
    const run = await svcWith(rpc).purgeExpired();
    expect(run).toMatchObject({ ok: false, wageRowsDeleted: null, departuresDeleted: null });
  });

  it("is scheduled nightly, and the scheduled run is the purge", async () => {
    const opts = Reflect.getMetadata(
      "SCHEDULE_CRON_OPTIONS",
      WageRecordRetentionService.prototype.scheduled,
    );
    expect(opts?.cronTime).toBe(WAGE_RETENTION_CRON);
    expect(WAGE_RETENTION_CRON).toBe("23 3 * * *");
    const rpc = jest.fn(async () => ({ data: [{ wage_rows_deleted: 0, departures_deleted: 0 }], error: null }));
    await svcWith(rpc).scheduled();
    expect(rpc).toHaveBeenCalledWith("purge_expired_wage_records");
  });
});
