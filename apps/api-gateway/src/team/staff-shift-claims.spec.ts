import { ConflictException } from "@nestjs/common";
import { ScheduleService } from "./schedule.service";
import { TeamService } from "./team.service";
import { asDatabaseService, makeStubDb, StubDb } from "./testing/supabase-stub";

/**
 * What staff see of a week and which open shifts they may take.
 *
 * F-506 A week its manager had not published reached staff as their real
 *       shifts, and its open shifts could be taken.
 * F-507 An open shift that had already ended could be taken, writing hours
 *       and labour cost after the fact.
 */

const RID = "restaurant-1";
const STAFF = "user-staff";
const MANAGER = "user-manager";
const WEEK = "2026-09-07"; // a Monday

function seed(status: "draft" | "published"): StubDb {
  return makeStubDb({
    user_restaurant_access: [
      { id: "a1", user_id: STAFF, restaurant_id: RID, role: "staff", is_active: true },
      { id: "a2", user_id: MANAGER, restaurant_id: RID, role: "manager", is_active: true },
    ],
    users: [
      { user_id: STAFF, restaurant_id: RID, role: "staff" },
      { user_id: MANAGER, restaurant_id: RID, role: "manager" },
    ],
    restaurants: [{ id: RID, timezone: "America/Los_Angeles", country: "US" }],
    team_members: [
      { id: "m-staff", restaurant_id: RID, user_id: STAFF, display_name: "Sam", hourly_wage: 20 },
    ],
    team_settings: [{ restaurant_id: RID, labor_tracking_enabled: true }],
    schedules: [{ id: "s1", restaurant_id: RID, week_start: WEEK, status }],
    shifts: [
      {
        id: "sh-mine",
        restaurant_id: RID,
        schedule_id: "s1",
        member_id: "m-staff",
        shift_date: "2026-09-08",
        start_time: "09:00",
        end_time: "17:00",
        state: "scheduled",
      },
      {
        id: "sh-open",
        restaurant_id: RID,
        schedule_id: "s1",
        member_id: null,
        shift_date: "2026-09-10",
        start_time: "17:00",
        end_time: "23:00",
        state: "open",
      },
    ],
    shift_breaks: [],
    schedule_receipts: [],
    notifications: [],
    system_audit_log: [],
  });
}

function service(db: StubDb): ScheduleService {
  const team = new TeamService(asDatabaseService(db));
  return new ScheduleService(
    asDatabaseService(db),
    team,
    { persistForRestaurant: jest.fn(async () => ({ inserted: 0 })) } as any,
    { sendToUsers: jest.fn(async () => undefined) } as any,
  );
}

/** Wed 2026-09-09 12:00 in Los Angeles — before the open Thursday shift. */
const BEFORE_OPEN = new Date("2026-09-09T19:00:00Z");
/** Fri 2026-09-11 12:00 in Los Angeles — after it. */
const AFTER_OPEN = new Date("2026-09-11T19:00:00Z");

afterEach(() => jest.useRealTimers());

describe("F-506: a draft week is not out to staff", () => {
  it("gives staff the draft schedule row but none of its shifts", async () => {
    jest.useFakeTimers({ now: BEFORE_OPEN, doNotFake: ["nextTick", "setImmediate"] });
    const out = await service(seed("draft")).getMyWeek(STAFF, RID, WEEK);
    expect(out.schedule?.status).toBe("draft");
    expect(out.mine).toEqual([]);
    expect(out.open).toEqual([]);
  });

  it("gives staff their shifts once the week is published", async () => {
    jest.useFakeTimers({ now: BEFORE_OPEN, doNotFake: ["nextTick", "setImmediate"] });
    const out = await service(seed("published")).getMyWeek(STAFF, RID, WEEK);
    expect(out.mine.map((s: any) => s.id)).toEqual(["sh-mine"]);
    expect(out.open.map((s: any) => s.id)).toEqual(["sh-open"]);
  });

  it("leaves a manager's view of a draft week as it was", async () => {
    jest.useFakeTimers({ now: BEFORE_OPEN, doNotFake: ["nextTick", "setImmediate"] });
    const out = await service(seed("draft")).getMyWeek(MANAGER, RID, WEEK);
    expect(out.open.map((s: any) => s.id)).toEqual(["sh-open"]);
  });

  it("refuses a staff claim on a draft week, in words, and writes nothing", async () => {
    jest.useFakeTimers({ now: BEFORE_OPEN, doNotFake: ["nextTick", "setImmediate"] });
    const db = seed("draft");
    const claim = service(db).assignCover(STAFF, RID, "sh-open", { memberId: "m-staff" } as any);
    await expect(claim).rejects.toBeInstanceOf(ConflictException);
    await expect(claim).rejects.toThrow(/isn't out yet/);
    expect(db.opsOn("shifts", "update")).toHaveLength(0);
  });

  it("still lets staff take an open shift on a published week", async () => {
    jest.useFakeTimers({ now: BEFORE_OPEN, doNotFake: ["nextTick", "setImmediate"] });
    const db = seed("published");
    await service(db).assignCover(STAFF, RID, "sh-open", { memberId: "m-staff" } as any);
    expect(db.tables.shifts.find((s) => s.id === "sh-open")?.member_id).toBe("m-staff");
  });
});

describe("F-507: a shift that is over cannot be taken", () => {
  it("leaves an ended open shift out of the open list", async () => {
    jest.useFakeTimers({ now: AFTER_OPEN, doNotFake: ["nextTick", "setImmediate"] });
    const out = await service(seed("published")).getMyWeek(STAFF, RID, WEEK);
    expect(out.open).toEqual([]);
  });

  it("refuses a staff claim on an ended shift and writes nothing", async () => {
    jest.useFakeTimers({ now: AFTER_OPEN, doNotFake: ["nextTick", "setImmediate"] });
    const db = seed("published");
    const claim = service(db).assignCover(STAFF, RID, "sh-open", { memberId: "m-staff" } as any);
    await expect(claim).rejects.toBeInstanceOf(ConflictException);
    await expect(claim).rejects.toThrow(/already ended/);
    expect(db.opsOn("shifts", "update")).toHaveLength(0);
  });

  it("reads the end on the house's clock, not UTC", async () => {
    // 2026-09-11 01:00 UTC is still 18:00 on Thursday in Los Angeles: the
    // 17:00-23:00 shift is under way, not over.
    jest.useFakeTimers({
      now: new Date("2026-09-11T01:00:00Z"),
      doNotFake: ["nextTick", "setImmediate"],
    });
    const out = await service(seed("published")).getMyWeek(STAFF, RID, WEEK);
    expect(out.open.map((s: any) => s.id)).toEqual(["sh-open"]);
  });

  it("counts a shift past midnight as ending the next day", async () => {
    // Thu 23:30 in Los Angeles; the open shift runs 22:00-02:00.
    jest.useFakeTimers({
      now: new Date("2026-09-11T06:30:00Z"),
      doNotFake: ["nextTick", "setImmediate"],
    });
    const db = seed("published");
    Object.assign(db.tables.shifts.find((s) => s.id === "sh-open")!, {
      start_time: "22:00",
      end_time: "02:00",
    });
    const out = await service(db).getMyWeek(STAFF, RID, WEEK);
    expect(out.open.map((s: any) => s.id)).toEqual(["sh-open"]);
  });
});
