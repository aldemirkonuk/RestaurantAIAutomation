import { ConflictException, NotFoundException } from "@nestjs/common";
import { ScheduleService } from "./schedule.service";
import { TeamService } from "./team.service";
import { asDatabaseService, makeStubDb, StubDb } from "./testing/supabase-stub";

/**
 * /team schedule engine — ADR 0088.
 *
 * T1  `computeLabor` summed `Number(sh.labor_cost ?? 0)`, so a week with no
 *     priced member rendered $0 and a partly priced week rendered a partial
 *     sum as a total.
 * T6  `weekStartOfSchedule` selected a schedule by caller-supplied id with no
 *     restaurant filter and fell back to *this* Monday when it found nothing;
 *     `recomputeCostForMember` re-read the shift unscoped.
 * T7  copy-week DELETEd the whole target week and re-publish wiped every
 *     `schedule_receipts` row, both on one client click, with neither the
 *     request nor the response naming the destruction.
 */

const RID = "restaurant-1";
const OTHER_RID = "restaurant-2";
const MANAGER = "user-manager";

function seed(): StubDb {
  return makeStubDb({
    user_restaurant_access: [
      {
        id: "a2",
        user_id: MANAGER,
        restaurant_id: RID,
        role: "manager",
        is_active: true,
      },
    ],
    users: [
      {
        user_id: MANAGER,
        restaurant_id: RID,
        role: "manager",
        email: "moe@example.test",
      },
    ],
    team_members: [
      {
        id: "m-priced",
        restaurant_id: RID,
        user_id: null,
        display_name: "Priced",
        hourly_wage: 20,
      },
      {
        id: "m-unpriced",
        restaurant_id: RID,
        user_id: null,
        display_name: "Unpriced",
        hourly_wage: null,
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
    schedules: [],
    shifts: [],
    shift_breaks: [],
    schedule_receipts: [],
    coverage_templates: [],
    notifications: [],
    system_audit_log: [],
  });
}

function service(db: StubDb): ScheduleService {
  const team = new TeamService(asDatabaseService(db));
  const notifications = {
    persistForRestaurant: jest.fn(async () => ({ inserted: 0 })),
  } as any;
  const push = { sendToUsers: jest.fn(async () => undefined) } as any;
  return new ScheduleService(asDatabaseService(db), team, notifications, push);
}

const WEEK = "2026-09-07"; // a Monday

describe("ScheduleService — T1: a partial labour sum never presents itself as a total", () => {
  it("withholds the week total while any assigned shift is unpriced", async () => {
    const db = seed();
    db.tables.schedules.push({
      id: "s1",
      restaurant_id: RID,
      week_start: WEEK,
      status: "draft",
    });
    db.tables.shifts.push(
      {
        id: "sh1",
        restaurant_id: RID,
        schedule_id: "s1",
        member_id: "m-priced",
        shift_date: WEEK,
        start_time: "09:00",
        end_time: "17:00",
        state: "scheduled",
        labor_cost: 160,
      },
      {
        id: "sh2",
        restaurant_id: RID,
        schedule_id: "s1",
        member_id: "m-unpriced",
        shift_date: WEEK,
        start_time: "09:00",
        end_time: "17:00",
        state: "scheduled",
        labor_cost: null,
      },
    );

    const week = await service(db).getWeek(MANAGER, RID, WEEK);

    expect(week.labor.enabled).toBe(true);
    // 160 is the cost of one of two shifts. Rendering it as "the week" is the
    // fabrication moving rather than being removed.
    expect(week.labor.totalCost).toBeNull();
    expect(week.labor.costComplete).toBe(false);
    expect(week.labor.unpricedShifts).toBe(1);
    expect(week.labor.pricedShifts).toBe(1);
  });

  it("does not render an unpriced week as $0", async () => {
    const db = seed();
    db.tables.schedules.push({
      id: "s1",
      restaurant_id: RID,
      week_start: WEEK,
      status: "draft",
    });
    db.tables.shifts.push({
      id: "sh1",
      restaurant_id: RID,
      schedule_id: "s1",
      member_id: "m-unpriced",
      shift_date: WEEK,
      start_time: "09:00",
      end_time: "17:00",
      state: "scheduled",
      labor_cost: null,
    });

    const week = await service(db).getWeek(MANAGER, RID, WEEK);
    expect(week.labor.totalCost).toBeNull();
    expect(week.labor.unpricedShifts).toBe(1);
  });

  it("reports a real total once every assigned shift is priced", async () => {
    const db = seed();
    db.tables.schedules.push({
      id: "s1",
      restaurant_id: RID,
      week_start: WEEK,
      status: "draft",
    });
    db.tables.shifts.push(
      {
        id: "sh1",
        restaurant_id: RID,
        schedule_id: "s1",
        member_id: "m-priced",
        shift_date: WEEK,
        start_time: "09:00",
        end_time: "17:00",
        state: "scheduled",
        labor_cost: 160,
      },
      {
        id: "sh2",
        restaurant_id: RID,
        schedule_id: "s1",
        member_id: "m-priced",
        shift_date: WEEK,
        start_time: "09:00",
        end_time: "13:00",
        state: "scheduled",
        labor_cost: 80,
      },
    );

    const week = await service(db).getWeek(MANAGER, RID, WEEK);
    expect(week.labor.costComplete).toBe(true);
    expect(week.labor.totalCost).toBe(240);
    expect(week.labor.unpricedShifts).toBe(0);
  });

  it("passes through an unset target rather than defaulting it to 28", async () => {
    const db = seed();
    db.tables.team_settings.length = 0; // no row: nothing was ever configured
    db.tables.schedules.push({
      id: "s1",
      restaurant_id: RID,
      week_start: WEEK,
      status: "draft",
    });

    const week = await service(db).getWeek(MANAGER, RID, WEEK);
    expect(week.labor.targetPct).toBeNull();
  });
});

describe("ScheduleService — T6: a read is scoped to the tenant that asked", () => {
  it("refuses a scheduleId belonging to another restaurant instead of guessing a week", async () => {
    const db = seed();
    db.tables.schedules.push({
      id: "s-other",
      restaurant_id: OTHER_RID,
      week_start: "2026-01-05",
    });

    await expect(
      service(db).createShift(MANAGER, RID, {
        scheduleId: "s-other",
        shiftDate: WEEK,
        startTime: "09:00",
        endTime: "17:00",
      } as any),
    ).rejects.toBeInstanceOf(NotFoundException);

    // …and nothing was written into this restaurant's week as a consolation.
    expect(db.tables.shifts).toHaveLength(0);
  });

  it("re-reads a shift with its restaurant filter when repricing a cover", async () => {
    const db = seed();
    db.tables.schedules.push({
      id: "s1",
      restaurant_id: RID,
      week_start: WEEK,
      status: "published",
    });
    db.tables.shifts.push({
      id: "sh-open",
      restaurant_id: RID,
      schedule_id: "s1",
      member_id: null,
      shift_date: WEEK,
      start_time: "09:00",
      end_time: "17:00",
      state: "open",
      labor_cost: null,
    });

    await service(db).assignCover(MANAGER, RID, "sh-open", {
      memberId: "m-priced",
    } as any);

    const shiftReads = db
      .opsOn("shifts", "select")
      .filter((o) =>
        o.filters.some((f) => f.column === "id" && f.value === "sh-open"),
      );
    expect(shiftReads.length).toBeGreaterThan(0);
    for (const op of shiftReads) {
      expect(
        op.filters.some((f) => f.column === "restaurant_id" && f.value === RID),
      ).toBe(true);
    }
  });
});

describe("ScheduleService — T7: destruction is in the contract, not a side effect", () => {
  function twoWeeks(db: StubDb) {
    db.tables.schedules.push(
      {
        id: "s-from",
        restaurant_id: RID,
        week_start: "2026-08-31",
        status: "published",
      },
      { id: "s-to", restaurant_id: RID, week_start: WEEK, status: "draft" },
    );
    db.tables.shifts.push(
      {
        id: "src1",
        restaurant_id: RID,
        schedule_id: "s-from",
        member_id: "m-priced",
        shift_date: "2026-08-31",
        start_time: "09:00",
        end_time: "17:00",
        state: "scheduled",
        shift_type: "am",
        labor_cost: 160,
        role: "line",
      },
      {
        id: "tgt1",
        restaurant_id: RID,
        schedule_id: "s-to",
        member_id: "m-priced",
        shift_date: WEEK,
        start_time: "10:00",
        end_time: "18:00",
        state: "scheduled",
        shift_type: "am",
        labor_cost: 160,
        role: "line",
      },
    );
  }

  it("refuses to overwrite a target week that already has shifts", async () => {
    const db = seed();
    twoWeeks(db);

    await expect(
      service(db).copyWeek(MANAGER, RID, {
        fromWeekStart: "2026-08-31",
        toWeekStart: WEEK,
      } as any),
    ).rejects.toBeInstanceOf(ConflictException);

    // The shift that was already there is still there.
    expect(db.tables.shifts.some((s) => s.id === "tgt1")).toBe(true);
  });

  it("says how much it destroyed when the caller asked for a replacement", async () => {
    const db = seed();
    twoWeeks(db);

    const res: any = await service(db).copyWeek(MANAGER, RID, {
      fromWeekStart: "2026-08-31",
      toWeekStart: WEEK,
      replaceTarget: true,
    } as any);

    expect(res.deleted).toBe(1);
    expect(res.copied).toBe(1);
  });

  it("copies into an empty target week without needing the flag", async () => {
    const db = seed();
    db.tables.schedules.push({
      id: "s-from",
      restaurant_id: RID,
      week_start: "2026-08-31",
      status: "published",
    });
    db.tables.shifts.push({
      id: "src1",
      restaurant_id: RID,
      schedule_id: "s-from",
      member_id: "m-priced",
      shift_date: "2026-08-31",
      start_time: "09:00",
      end_time: "17:00",
      state: "scheduled",
      shift_type: "am",
      labor_cost: 160,
      role: "line",
    });

    const res: any = await service(db).copyWeek(MANAGER, RID, {
      fromWeekStart: "2026-08-31",
      toWeekStart: WEEK,
    } as any);
    expect(res.copied).toBe(1);
    expect(res.deleted).toBe(0);
  });

  it("refuses to erase read receipts on a re-publish unless the caller said so", async () => {
    const db = seed();
    db.tables.schedules.push({
      id: "s1",
      restaurant_id: RID,
      week_start: WEEK,
      status: "published",
      published_at: "2026-09-01T00:00:00.000Z",
    });
    db.tables.schedule_receipts.push({
      id: "r1",
      schedule_id: "s1",
      member_id: "m-priced",
      seen_at: "2026-09-01T10:00:00.000Z",
    });

    await expect(
      service(db).publish(MANAGER, RID, "s1", {} as any),
    ).rejects.toBeInstanceOf(ConflictException);

    // The record of who has seen the schedule survives the refusal.
    expect(db.tables.schedule_receipts).toHaveLength(1);
  });

  it("reports how many receipts it cleared when the caller confirmed", async () => {
    const db = seed();
    db.tables.schedules.push({
      id: "s1",
      restaurant_id: RID,
      week_start: WEEK,
      status: "published",
      published_at: "2026-09-01T00:00:00.000Z",
    });
    db.tables.schedule_receipts.push({
      id: "r1",
      schedule_id: "s1",
      member_id: "m-priced",
      seen_at: "2026-09-01T10:00:00.000Z",
    });

    const res: any = await service(db).publish(MANAGER, RID, "s1", {
      resetReceipts: true,
    } as any);
    expect(res.receiptsCleared).toBe(1);
    expect(db.tables.schedule_receipts).toHaveLength(0);
  });

  it("a first publish clears nothing and says so", async () => {
    const db = seed();
    db.tables.schedules.push({
      id: "s1",
      restaurant_id: RID,
      week_start: WEEK,
      status: "draft",
    });

    const res: any = await service(db).publish(MANAGER, RID, "s1", {} as any);
    expect(res.receiptsCleared).toBe(0);
    expect(res.schedule.status).toBe("published");
  });
});
