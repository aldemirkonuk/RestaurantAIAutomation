import * as fs from "fs";
import * as path from "path";
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
/**
 * The week's money is the owner's (ADR 0215), so the T1 cases — which are about
 * what the cost total may claim — are read as the owner. What a manager
 * receives is pinned in `team-pay.spec.ts`.
 */
const OWNER = "user-owner";

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

/** The inbox funnel of the service built by the last `service()` call. */
let lastNotifications: { persistForRestaurant: jest.Mock };

function service(db: StubDb): ScheduleService {
  const team = new TeamService(asDatabaseService(db));
  const notifications = {
    persistForRestaurant: jest.fn(async () => ({ inserted: 0 })),
  } as any;
  lastNotifications = notifications;
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

    const week = await service(db).getWeek(OWNER, RID, WEEK);

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

    const week = await service(db).getWeek(OWNER, RID, WEEK);
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

    const week = await service(db).getWeek(OWNER, RID, WEEK);
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

    const week = await service(db).getWeek(OWNER, RID, WEEK);
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

  it("refuses a replace when the week no longer holds the count the person was shown (F-1030)", async () => {
    const db = seed();
    twoWeeks(db);

    // A tab loaded while the week was empty says "all 0 shifts"; another
    // manager has since put tgt1 there.
    await expect(
      service(db).copyWeek(MANAGER, RID, {
        fromWeekStart: "2026-08-31",
        toWeekStart: WEEK,
        replaceTarget: true,
        expectShifts: 0,
      } as any),
    ).rejects.toThrow(/now has 1 shift\(s\), not the 0 you were shown/);
    expect(db.tables.shifts.some((s) => s.id === "tgt1")).toBe(true);
    expect(db.tables.shifts).toHaveLength(2);
  });

  it("lands one of two copies made at once, never both (F-1030)", async () => {
    const db = seed();
    db.tables.schedules.push(
      {
        id: "s-from",
        restaurant_id: RID,
        week_start: "2026-08-31",
        status: "published",
      },
      { id: "s-to", restaurant_id: RID, week_start: WEEK, status: "draft" },
    );
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
    const body = {
      fromWeekStart: "2026-08-31",
      toWeekStart: WEEK,
      expectShifts: 0,
    };

    const both = await Promise.allSettled([
      service(db).copyWeek(MANAGER, RID, { ...body } as any),
      service(db).copyWeek(MANAGER, RID, { ...body } as any),
    ]);

    expect(both.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const refused = both.find(
      (r) => r.status === "rejected",
    ) as PromiseRejectedResult;
    expect(refused.reason).toBeInstanceOf(ConflictException);
    expect(db.tables.shifts.filter((s) => s.shift_date === WEEK)).toHaveLength(
      1,
    );
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

/**
 * F-1082 — a publish that timed out after it landed, pressed again, must not
 * notify the whole crew a second time. A real change since it went live
 * still does.
 */
describe("ScheduleService — F-1082: a repeated publish does not notify twice", () => {
  const LIVE_AT = "2026-09-01T00:00:00.000Z";
  function liveWeek(db: StubDb) {
    db.tables.schedules.push({
      id: "s1",
      restaurant_id: RID,
      week_start: WEEK,
      status: "published",
      published_at: LIVE_AT,
    });
    db.tables.shifts.push({
      id: "sh1",
      restaurant_id: RID,
      schedule_id: "s1",
      member_id: "m-priced",
      shift_date: WEEK,
      start_time: "09:00",
      end_time: "17:00",
      state: "scheduled",
      updated_at: "2026-08-31T12:00:00.000Z",
    });
  }

  it("a second publish of an unchanged live week writes nothing and tells nobody", async () => {
    const db = seed();
    liveWeek(db);
    const res: any = await service(db).publish(MANAGER, RID, "s1", {} as any);
    expect(lastNotifications.persistForRestaurant).not.toHaveBeenCalled();
    expect(res.unchanged).toBe(true);
    expect(res.schedule.published_at).toBe(LIVE_AT);
    expect(db.tables.schedules[0].published_at).toBe(LIVE_AT);
  });

  it("still tells the crew when a shift was edited after the week went live", async () => {
    const db = seed();
    liveWeek(db);
    db.tables.shifts[0].updated_at = "2026-09-02T08:00:00.000Z";
    await service(db).publish(MANAGER, RID, "s1", {
      resetReceipts: true,
    } as any);
    expect(lastNotifications.persistForRestaurant).toHaveBeenCalledTimes(1);
  });

  it("still tells the crew when a shift of the week was deleted after it went live", async () => {
    const db = seed();
    liveWeek(db);
    db.tables.system_audit_log.push({
      id: "a1",
      restaurant_id: RID,
      action: "shift_deleted",
      entity_type: "shift",
      changes: { shift_date: WEEK },
      created_at: "2026-09-02T08:00:00.000Z",
    });
    await service(db).publish(MANAGER, RID, "s1", {
      resetReceipts: true,
    } as any);
    expect(lastNotifications.persistForRestaurant).toHaveBeenCalledTimes(1);
  });

  // F-1114: told nothing changed, the manager may still send the
  // announcement again on purpose; a lost notice is not lost for good.
  it("an explicit send-again of an unchanged live week tells the crew once", async () => {
    const db = seed();
    liveWeek(db);
    const res: any = await service(db).publish(MANAGER, RID, "s1", {
      resetReceipts: true,
    } as any);
    expect(lastNotifications.persistForRestaurant).toHaveBeenCalledTimes(1);
    expect(res.republished).toBe(true);
  });
});

/**
 * F-1148 — the inbox funnel answers 0 when its insert fails (it logs and
 * swallows the error). Publish hands that count back, so the page can say a
 * live week reached nobody instead of "published".
 */
describe("ScheduleService — F-1148: publish says how many were told", () => {
  function draftWeek(db: StubDb) {
    db.tables.schedules.push({
      id: "s1",
      restaurant_id: RID,
      week_start: WEEK,
      status: "draft",
      published_at: null,
    });
  }

  it("reports nobody told when the announcement did not land", async () => {
    const db = seed();
    draftWeek(db);
    const svc = service(db);
    lastNotifications.persistForRestaurant.mockResolvedValueOnce({
      inserted: 0,
      ids: [],
    });
    const res: any = await svc.publish(MANAGER, RID, "s1", {} as any);
    expect(db.tables.schedules[0].status).toBe("published");
    expect(res.notified).toBe(0);
  });

  it("reports how many were told, and how many were Away and held back", async () => {
    const db = seed();
    draftWeek(db);
    const svc = service(db);
    lastNotifications.persistForRestaurant.mockResolvedValueOnce({
      inserted: 4,
      ids: ["n1", "n2", "n3", "n4"],
      routing: {
        label: null,
        step: "house",
        alerted: 4,
        inboxOnly: 0,
        heldAway: 2,
        degraded: null,
      },
    });
    const res: any = await svc.publish(MANAGER, RID, "s1", {} as any);
    expect(res.notified).toBe(4);
    expect(res.heldAway).toBe(2);
  });
});

/**
 * T8 — the house's own voice carries no emoji into a stored row.
 *
 * Both of these titles used to be prefixed ("[calendar] Schedule published",
 * "[siren] Shift call-out — cover needed"). A picture written into a
 * `notifications` row is permanent, unstylable and restates nothing the row
 * does not already carry in `priority` and `type`; the inbox draws the
 * register's mark itself. See `notifications/notification-text-is-plain.spec.ts`
 * for the rule and its scan.
 */
describe("ScheduleService — T8: no emoji reaches the inbox", () => {
  const EMOJI = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/u;

  it("publishes a schedule under a plain title that still says what happened", async () => {
    const db = seed();
    db.tables.schedules.push({
      id: "s1",
      restaurant_id: RID,
      week_start: WEEK,
      status: "draft",
      published_at: null,
    });

    await service(db).publish(MANAGER, RID, "s1", {} as any);

    const payload = lastNotifications.persistForRestaurant.mock.calls[0][1];
    expect(payload.title).toBe("Schedule published");
    expect(payload.title).not.toMatch(EMOJI);
    expect(payload.message).not.toMatch(EMOJI);
  });

  /**
   * F-1150: the live-week notice printed the raw ISO date ("The week of
   * 2026-09-07 is live") to every phone in the house. It now names the week in
   * the house's hand; the deep link and metadata keep the ISO date.
   */
  it.each([
    [{ country: "TR", timezone: "Europe/Istanbul" }, "07.09.2026"],
    [{ country: "US", timezone: "America/New_York" }, "9/7/2026"],
    [{ country: null, timezone: null }, "Mon 7 Sept"],
  ])("names the live week in the house's hand (%o)", async (house, words) => {
    const db = seed();
    db.tables.restaurants = [{ id: RID, ...house }];
    db.tables.schedules.push({
      id: "s1",
      restaurant_id: RID,
      week_start: WEEK,
      status: "draft",
      published_at: null,
    });

    await service(db).publish(MANAGER, RID, "s1", {} as any);

    const payload = lastNotifications.persistForRestaurant.mock.calls[0][1];
    expect(payload.message).toBe(
      `The week of ${words} is live. Open it to see your shifts.`,
    );
    expect(payload.message).not.toContain(WEEK);
    expect(payload.actionUrl).toContain(`week=${WEEK}`);
  });

  it("links to the week by the one word /team reads (F-1151)", async () => {
    const db = seed();
    db.tables.schedules.push({
      id: "s1",
      restaurant_id: RID,
      week_start: WEEK,
      status: "draft",
      published_at: null,
    });

    await service(db).publish(MANAGER, RID, "s1", {} as any);

    const payload = lastNotifications.persistForRestaurant.mock.calls[0][1];
    expect(payload.actionUrl).toBe(`/team?week=${WEEK}`);
  });

  it("keeps the call-out's urgency in `priority`, not in a picture", async () => {
    const src = fs.readFileSync(
      path.join(__dirname, "schedule.service.ts"),
      "utf8",
    );
    // The urgency the siren emoji used to carry is carried by the row's own priority.
    expect(src).toContain('title: "Shift call-out — cover needed"');
    expect(src).toContain('priority: "critical"');
  });
});

describe("ScheduleService — F-348: two staff claiming one open shift", () => {
  // F-507 refuses a claim on a shift that has ended; WEEK is fixed, so the
  // house clock is pinned before it.
  beforeAll(() =>
    jest.useFakeTimers({
      doNotFake: [
        "nextTick",
        "setImmediate",
        "setTimeout",
        "setInterval",
        "queueMicrotask",
      ],
      now: new Date("2026-09-01T12:00:00Z"),
    }),
  );
  afterAll(() => jest.useRealTimers());
  const ALI = "user-ali";
  const BEA = "user-bea";

  function withTwoStaff(): StubDb {
    const db = seed();
    for (const [uid, mid, name] of [
      [ALI, "m-ali", "Ali"],
      [BEA, "m-bea", "Bea"],
    ]) {
      db.tables.user_restaurant_access.push({
        id: `a-${mid}`,
        user_id: uid,
        restaurant_id: RID,
        role: "staff",
        is_active: true,
      });
      db.tables.users.push({
        user_id: uid,
        restaurant_id: RID,
        role: "staff",
        email: `${name.toLowerCase()}@example.test`,
      });
      db.tables.team_members.push({
        id: mid,
        restaurant_id: RID,
        user_id: uid,
        display_name: name,
        hourly_wage: 20,
      });
    }
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
    return db;
  }

  it("the claim that loses the race gets a 409 naming who has it, and the winner keeps it", async () => {
    const db = withTwoStaff();
    const svc = service(db);
    // Bea's claim lands between Ali's read of the shift and Ali's write.
    const realFrom = db.supabase.from.bind(db.supabase);
    let shiftCalls = 0;
    (db.supabase as any).from = (t: string) => {
      if (t === "shifts" && ++shiftCalls === 3) {
        const row = db.tables.shifts.find((s) => s.id === "sh-open")!;
        row.member_id = "m-bea";
        row.state = "covered";
      }
      return realFrom(t);
    };

    const err = await svc
      .assignCover(ALI, RID, "sh-open", { memberId: "m-ali" } as any)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toBe("Bea has already taken this shift.");
    expect(db.tables.shifts.find((s) => s.id === "sh-open")?.member_id).toBe(
      "m-bea",
    );
  });

  // A read that fails after the lost claim must not pass for an answer.
  async function loseRaceThenFail(table: "shifts" | "team_members") {
    const db = withTwoStaff();
    const svc = service(db);
    const realFrom = db.supabase.from.bind(db.supabase);
    // Bea wins the race just as Ali's claim (the shifts UPDATE) is sent, and
    // every read after it fails. Keyed on the claim itself, not on a call
    // count, so a pre-claim read added elsewhere cannot move the race.
    let raced = false;
    (db.supabase as any).from = (t: string) => {
      const q = realFrom(t);
      if (t === "shifts" && !raced) {
        const update = q.update.bind(q);
        q.update = (payload: any) => {
          raced = true;
          const row = db.tables.shifts.find((s) => s.id === "sh-open")!;
          row.member_id = "m-bea";
          row.state = "covered";
          db.errors[`${table}:select`] = { message: "timeout" };
          return update(payload);
        };
      }
      return q;
    };
    return svc
      .assignCover(ALI, RID, "sh-open", { memberId: "m-ali" } as any)
      .catch((e) => e);
  }

  it("a lost claim whose holder cannot be read says the shift is gone, not who has it", async () => {
    const err = await loseRaceThenFail("shifts");
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toBe(
      "This shift is no longer open. Refresh to see who has it.",
    );
  });

  it("a lost claim whose holder's name cannot be read still says someone else has it", async () => {
    const err = await loseRaceThenFail("team_members");
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toBe("Someone else has already taken this shift.");
  });

  it("a stale screen claiming a covered shift is told who took it, not forbidden", async () => {
    const db = withTwoStaff();
    const svc = service(db);
    await svc.assignCover(BEA, RID, "sh-open", { memberId: "m-bea" } as any);

    const err = await svc
      .assignCover(ALI, RID, "sh-open", { memberId: "m-ali" } as any)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toBe("Bea has already taken this shift.");
    expect(db.tables.shifts.find((s) => s.id === "sh-open")?.member_id).toBe(
      "m-bea",
    );
  });

  it("a manager still assigns a covered shift to someone else", async () => {
    const db = withTwoStaff();
    const svc = service(db);
    await svc.assignCover(BEA, RID, "sh-open", { memberId: "m-bea" } as any);
    await svc.assignCover(MANAGER, RID, "sh-open", {
      memberId: "m-ali",
    } as any);
    expect(db.tables.shifts.find((s) => s.id === "sh-open")?.member_id).toBe(
      "m-ali",
    );
  });
});

/**
 * F-217 — a notice about one shift opens /team on the week that holds it.
 * /team reads `week`; `?shift=` alone opened on this week, whatever the date.
 */
describe("ScheduleService — F-217: a shift's link names its week", () => {
  it("a call-out's cover notice links the week of the shift", async () => {
    const db = seed();
    db.tables.schedules.push({
      id: "s1",
      restaurant_id: RID,
      week_start: WEEK,
      status: "published",
    });
    db.tables.shifts.push({
      id: "sh-fri",
      restaurant_id: RID,
      schedule_id: "s1",
      member_id: "m-priced",
      shift_date: "2026-09-11", // the Friday of WEEK
      start_time: "17:00",
      end_time: "23:00",
      role: "server",
      state: "assigned",
    });

    const res = await service(db).reportCallout(
      OWNER,
      RID,
      "sh-fri",
      {} as any,
    );

    const payload = lastNotifications.persistForRestaurant.mock.calls[0][1];
    expect(payload.actionUrl).toBe(
      `/team?shift=${(res.open as any).id}&week=${WEEK}`,
    );
  });
});

/**
 * F-1113 — "Tap to claim" goes only to a shift staff can claim.
 * F-1116 — a call-out is reported once: a second press or a retry opens no
 * second cover slot and sends no second alert.
 */
describe("ScheduleService — cover is offered and called out once (F-1113, F-1116)", () => {
  function heldShift(db: StubDb) {
    db.tables.schedules.push({
      id: "s1",
      restaurant_id: RID,
      week_start: WEEK,
      status: "published",
    });
    db.tables.shifts.push({
      id: "sh-held",
      restaurant_id: RID,
      schedule_id: "s1",
      member_id: "m-priced",
      shift_date: WEEK,
      start_time: "09:00",
      end_time: "17:00",
      role: "server",
      state: "assigned",
    });
  }
  function pushOf(svc: ScheduleService): jest.Mock {
    return (svc as any).push.sendToUsers;
  }

  it("refuses to offer a shift its person still holds, and pushes nothing", async () => {
    const db = seed();
    heldShift(db);
    const svc = service(db);
    const err = await svc
      .offerCover(MANAGER, RID, "sh-held", { memberIds: ["m-unpriced"] } as any)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(pushOf(svc)).not.toHaveBeenCalled();
  });

  it("refuses to offer the called-out row, and offers the cover slot it opened", async () => {
    const db = seed();
    heldShift(db);
    db.tables.team_members.push({
      id: "m-ali",
      restaurant_id: RID,
      user_id: "user-ali",
      display_name: "Ali",
      hourly_wage: 20,
    });
    const svc = service(db);
    const { open } = await svc.reportCallout(OWNER, RID, "sh-held", {} as any);

    const err = await svc
      .offerCover(MANAGER, RID, "sh-held", { memberIds: ["m-ali"] } as any)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(pushOf(svc)).not.toHaveBeenCalled();

    const res = await svc.offerCover(MANAGER, RID, (open as any).id, {
      memberIds: ["m-ali"],
    } as any);
    expect(res.notified).toBe(1);
    expect(pushOf(svc).mock.calls[0][1].data.shiftId).toBe((open as any).id);
    // F-1183: the offer names its house, so a two-house phone opens this one.
    expect(pushOf(svc).mock.calls[0][1].house).toBe(RID);
  });

  it("F-1158: never asks someone on approved leave or Away that day", async () => {
    const db = seed();
    heldShift(db);
    for (const [id, user] of [
      ["m-leave", "user-leave"],
      ["m-away", "user-away"],
      ["m-free", "user-free"],
      ["m-pending", "user-pending"],
    ]) {
      db.tables.team_members.push({
        id,
        restaurant_id: RID,
        user_id: user,
        display_name: id,
        hourly_wage: 20,
      });
    }
    db.tables.time_off_requests = [
      {
        id: "t1",
        restaurant_id: RID,
        member_id: "m-leave",
        start_date: "2026-09-06",
        end_date: WEEK,
        status: "approved",
      },
      // Asked for but not granted: still free to be asked.
      {
        id: "t2",
        restaurant_id: RID,
        member_id: "m-pending",
        start_date: WEEK,
        end_date: WEEK,
        status: "pending",
      },
    ];
    db.tables.house_away = [
      {
        restaurant_id: RID,
        user_id: "user-away",
        away_from: WEEK,
        away_until: "2026-09-09",
      },
      // Away in another house says nothing about this one.
      {
        restaurant_id: OTHER_RID,
        user_id: "user-free",
        away_from: WEEK,
        away_until: WEEK,
      },
    ];
    const svc = service(db);
    const { open } = await svc.reportCallout(OWNER, RID, "sh-held", {} as any);

    const res = await svc.offerCover(MANAGER, RID, (open as any).id, {
      memberIds: ["m-leave", "m-away", "m-free", "m-pending"],
    } as any);
    expect(pushOf(svc).mock.calls[0][0].sort()).toEqual([
      "user-free",
      "user-pending",
    ]);
    expect(res).toMatchObject({ offered: 2, notified: 2, setAside: 2 });
  });

  it("a second call-out of the same shift opens no second slot and alerts nobody again", async () => {
    const db = seed();
    heldShift(db);
    const svc = service(db);
    await svc.reportCallout(OWNER, RID, "sh-held", {} as any);
    const err = await svc
      .reportCallout(OWNER, RID, "sh-held", {} as any)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(db.tables.shifts.filter((s) => s.state === "open")).toHaveLength(1);
    expect(lastNotifications.persistForRestaurant).toHaveBeenCalledTimes(1);
  });

  it("two presses that both read the held shift land one call-out", async () => {
    const db = seed();
    heldShift(db);
    const svc = service(db);
    // The other press lands between this one's read and its write.
    const realFrom = db.supabase.from.bind(db.supabase);
    let raced = false;
    (db.supabase as any).from = (t: string) => {
      const q = realFrom(t);
      if (t === "shifts" && !raced) {
        const update = q.update.bind(q);
        q.update = (payload: any) => {
          raced = true;
          // A fresh row, as the database would hold: the read this press
          // made keeps what it saw.
          const i = db.tables.shifts.findIndex((s) => s.id === "sh-held");
          db.tables.shifts[i] = { ...db.tables.shifts[i], state: "callout" };
          return update(payload);
        };
      }
      return q;
    };
    const err = await svc
      .reportCallout(OWNER, RID, "sh-held", {} as any)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(db.tables.shifts.filter((s) => s.state === "open")).toHaveLength(0);
    expect(lastNotifications.persistForRestaurant).not.toHaveBeenCalled();
  });
});

describe("ScheduleService — a shift sheet saves what the editor saw (F-1032, F-1033)", () => {
  function oneShift(db: StubDb, over: Record<string, any> = {}) {
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
      member_id: "m-priced",
      shift_date: WEEK,
      start_time: "09:00",
      end_time: "17:00",
      state: "scheduled",
      shift_type: "am",
      role: "line",
      note: "Patio",
      labor_cost: 160,
      updated_at: "2026-09-01T10:00:00.123456+00:00",
      ...over,
    });
  }

  it("takes the person off and clears the role and note when they are sent as null", async () => {
    const db = seed();
    oneShift(db);

    const res: any = await service(db).updateShift(OWNER, RID, "sh1", {
      memberId: null,
      role: null,
      note: null,
      expectMemberId: "m-priced",
      expectUpdatedAt: "2026-09-01T10:00:00.123456+00:00",
    } as any);

    expect(res.member_id).toBeNull();
    expect(res.role).toBeNull();
    expect(res.note).toBeNull();
    // Nobody on it: an open shift for the crew to claim, priced as nobody's.
    expect(res.state).toBe("open");
    expect(res.labor_cost).toBeNull();
  });

  it("refuses a save from a sheet opened before someone else moved the shift", async () => {
    const db = seed();
    // Another manager moved it from m-priced to m-unpriced after this sheet opened.
    oneShift(db, { member_id: "m-unpriced" });

    await expect(
      service(db).updateShift(MANAGER, RID, "sh1", {
        memberId: "m-priced",
        endTime: "18:00",
        expectMemberId: "m-priced",
      } as any),
    ).rejects.toThrow(
      /Someone else changed or removed this shift after you opened it/,
    );
    const row = db.tables.shifts.find((s) => s.id === "sh1")!;
    expect(row.member_id).toBe("m-unpriced");
    expect(row.end_time).toBe("17:00");
  });

  it("refuses a save whose shift changed in any other way since the sheet opened", async () => {
    const db = seed();
    oneShift(db, { updated_at: "2026-09-02T08:00:00+00:00" });

    await expect(
      service(db).updateShift(MANAGER, RID, "sh1", {
        endTime: "18:00",
        expectMemberId: "m-priced",
        expectUpdatedAt: "2026-09-01T10:00:00.123456+00:00",
      } as any),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.tables.shifts.find((s) => s.id === "sh1")!.end_time).toBe(
      "17:00",
    );
  });

  it("saves when the shift is as the sheet saw it, whatever the timestamp's spelling", async () => {
    const db = seed();
    oneShift(db);

    const res: any = await service(db).updateShift(MANAGER, RID, "sh1", {
      endTime: "18:00",
      expectMemberId: "m-priced",
      expectUpdatedAt: "2026-09-01T10:00:00.123Z",
    } as any);
    expect(res.end_time).toBe("18:00");
    expect(res.member_id).toBe("m-priced");
  });
});
