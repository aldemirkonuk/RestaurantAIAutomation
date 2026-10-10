import { ConflictException } from "@nestjs/common";
import { ScheduleService, servesPeriod } from "./schedule.service";
import { TeamService } from "./team.service";
import { asDatabaseService, makeStubDb, StubDb } from "./testing/supabase-stub";

/**
 * One conflict check for every write that puts a person on a shift (F-377,
 * F-171), and coverage by Kind as well as start time (F-170).
 *
 * Before: only the leaving-person hand-over read approved leave and the
 * person's other shifts, so create, edit, a manager's cover, a staff claim and
 * copy-week scheduled over leave and double-booked with no word; and an
 * inactive person took an 11-hour shift and its wage. A shift set to
 * "evening" that started at 11:00 never filled an evening coverage rule.
 */

const RID = "restaurant-1";
const MANAGER = "user-manager";
const STAFF = "user-staff";
const FRI = "2026-10-09";
const WEEK = "2026-10-05"; // its Monday

function seed(opts: { doubleBooking?: boolean } = {}): StubDb {
  return makeStubDb({
    user_restaurant_access: [
      {
        id: "a1",
        user_id: MANAGER,
        restaurant_id: RID,
        role: "manager",
        is_active: true,
      },
      {
        id: "a2",
        user_id: STAFF,
        restaurant_id: RID,
        role: "staff",
        is_active: true,
      },
    ],
    users: [
      {
        user_id: MANAGER,
        restaurant_id: RID,
        role: "manager",
        email: "m@example.test",
      },
      {
        user_id: STAFF,
        restaurant_id: RID,
        role: "staff",
        email: "s@example.test",
      },
    ],
    team_members: [
      {
        id: "m-maya",
        restaurant_id: RID,
        user_id: STAFF,
        display_name: "Maya",
        status: "active",
        hourly_wage: 20,
      },
      {
        id: "m-lucas",
        restaurant_id: RID,
        user_id: null,
        display_name: "Lucas",
        status: "inactive",
        hourly_wage: 19.61,
      },
      {
        id: "m-deniz",
        restaurant_id: RID,
        user_id: null,
        display_name: "Deniz",
        status: "active",
        hourly_wage: 18,
      },
    ],
    team_settings: [
      { restaurant_id: RID, allow_double_booking: opts.doubleBooking === true },
    ],
    time_off_requests: [
      // Maya's approved leave, Fri and Sat.
      {
        id: "t1",
        restaurant_id: RID,
        member_id: "m-maya",
        start_date: FRI,
        end_date: "2026-10-10",
        status: "approved",
      },
      // Deniz asked, nobody answered yet: not leave.
      {
        id: "t2",
        restaurant_id: RID,
        member_id: "m-deniz",
        start_date: FRI,
        end_date: FRI,
        status: "pending",
      },
    ],
    schedules: [],
    shifts: [],
    shift_breaks: [],
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

const shift = (
  memberId: string | null,
  date = FRI,
  start = "17:00",
  end = "23:00",
) => ({
  memberId: memberId ?? undefined,
  shiftDate: date,
  startTime: start,
  endTime: end,
  role: "Floor",
});

describe("a shift never lands on approved leave, an inactive person or a clash", () => {
  it("refuses to create a shift on a day of the person's approved leave", async () => {
    const db = seed();
    const err = await service(db)
      .createShift(MANAGER, RID, shift("m-maya") as any)
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toBe(
      "This person has approved time off on Fri 9 Oct. Change their time off first, or give the shift to someone else. Nothing was saved.",
    );
    expect(db.tables.shifts).toHaveLength(0);
  });

  it("does not count a request nobody has answered as leave", async () => {
    const db = seed();
    await service(db).createShift(MANAGER, RID, shift("m-deniz") as any);
    expect(db.tables.shifts).toHaveLength(1);
  });

  it("refuses to give an inactive person a shift", async () => {
    const db = seed();
    const err = await service(db)
      .createShift(
        MANAGER,
        RID,
        shift("m-lucas", "2026-10-08", "11:00", "23:00") as any,
      )
      .catch((e) => e);
    expect(err).toBeInstanceOf(ConflictException);
    expect(err.message).toContain(
      "This person is set to inactive on the team.",
    );
    expect(db.tables.shifts).toHaveLength(0);
  });

  it("refuses a double booking when the house has it off, and allows it when on", async () => {
    const off = seed();
    off.tables.shifts.push({
      id: "x1",
      restaurant_id: RID,
      member_id: "m-deniz",
      shift_date: "2026-10-08",
      start_time: "18:00",
      end_time: "23:00",
      state: "scheduled",
      role: "Floor",
    });
    await expect(
      service(off).createShift(
        MANAGER,
        RID,
        shift("m-deniz", "2026-10-08", "20:00", "02:00") as any,
      ),
    ).rejects.toThrow(/already has a shift at that time on Thu 8 Oct/);

    const on = seed({ doubleBooking: true });
    on.tables.shifts.push({ ...off.tables.shifts[0] });
    await service(on).createShift(
      MANAGER,
      RID,
      shift("m-deniz", "2026-10-08", "20:00", "02:00") as any,
    );
    expect(on.tables.shifts).toHaveLength(2);
  });

  it("refuses an edit that moves a shift onto the person's leave, but lets an inactive person's times change", async () => {
    const db = seed();
    db.tables.shifts.push(
      {
        id: "s-maya",
        restaurant_id: RID,
        member_id: "m-maya",
        shift_date: "2026-10-08",
        start_time: "17:00",
        end_time: "23:00",
        state: "scheduled",
        role: "Floor",
      },
      {
        id: "s-lucas",
        restaurant_id: RID,
        member_id: "m-lucas",
        shift_date: "2026-10-07",
        start_time: "17:00",
        end_time: "23:00",
        state: "scheduled",
        role: "Floor",
      },
    );
    const svc = service(db);
    await expect(
      svc.updateShift(MANAGER, RID, "s-maya", { shiftDate: FRI } as any),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.tables.shifts.find((s) => s.id === "s-maya")!.shift_date).toBe(
      "2026-10-08",
    );

    // Handing an existing shift TO the inactive person is refused…
    await expect(
      svc.updateShift(MANAGER, RID, "s-maya", { memberId: "m-lucas" } as any),
    ).rejects.toThrow(/inactive/);
    // …but a shift they already hold can still have its times fixed.
    await svc.updateShift(MANAGER, RID, "s-lucas", { endTime: "22:00" } as any);
    expect(db.tables.shifts.find((s) => s.id === "s-lucas")!.end_time).toBe(
      "22:00",
    );
  });

  it("refuses a manager's cover and a staff claim over leave, in the reader's own words", async () => {
    // F-506/F-507: a staff claim needs a published week and a shift not yet over.
    jest.useFakeTimers({
      doNotFake: [
        "nextTick",
        "setImmediate",
        "setTimeout",
        "setInterval",
        "queueMicrotask",
      ],
      now: new Date("2026-10-01T12:00:00Z"),
    });
    const db = seed();
    db.tables.schedules.push({
      id: "sch-fri",
      restaurant_id: RID,
      week_start: "2026-10-05",
      status: "published",
    });
    db.tables.shifts.push({
      id: "open1",
      restaurant_id: RID,
      schedule_id: "sch-fri",
      member_id: null,
      shift_date: FRI,
      start_time: "17:00",
      end_time: "23:00",
      state: "open",
      shift_type: "open",
      role: "Floor",
    });
    const svc = service(db);
    await expect(
      svc.assignCover(MANAGER, RID, "open1", { memberId: "m-maya" } as any),
    ).rejects.toThrow(/^This person has approved time off on Fri 9 Oct/);
    await expect(
      svc.assignCover(STAFF, RID, "open1", { memberId: "m-maya" } as any),
    ).rejects.toThrow(
      "You have approved time off on Fri 9 Oct, so this shift cannot go to you. Nothing was saved.",
    );
    expect(db.tables.shifts[0].member_id).toBeNull();
    jest.useRealTimers();
  });

  it("copies a shift whose person is on leave or inactive as an open shift, and says how many", async () => {
    const db = seed();
    db.tables.schedules.push({
      id: "s-from",
      restaurant_id: RID,
      week_start: "2026-09-28",
      status: "published",
    });
    db.tables.shifts.push(
      // Last Friday: Maya (on leave this Friday), Lucas (inactive), Deniz.
      {
        id: "c1",
        restaurant_id: RID,
        schedule_id: "s-from",
        member_id: "m-maya",
        shift_date: "2026-10-02",
        start_time: "17:00",
        end_time: "23:00",
        state: "scheduled",
        shift_type: "pm",
        role: "Floor",
      },
      {
        id: "c2",
        restaurant_id: RID,
        schedule_id: "s-from",
        member_id: "m-lucas",
        shift_date: "2026-10-02",
        start_time: "11:00",
        end_time: "23:00",
        state: "scheduled",
        shift_type: "pm",
        role: "Floor",
      },
      {
        id: "c3",
        restaurant_id: RID,
        schedule_id: "s-from",
        member_id: "m-deniz",
        shift_date: "2026-10-02",
        start_time: "17:00",
        end_time: "23:00",
        state: "scheduled",
        shift_type: "pm",
        role: "Bar",
      },
    );

    const res: any = await service(db).copyWeek(MANAGER, RID, {
      fromWeekStart: "2026-09-28",
      toWeekStart: WEEK,
    } as any);

    expect(res.copied).toBe(3);
    expect(res.openedInstead).toBe(2);
    const copied = db.tables.shifts.filter((s) => s.shift_date === FRI);
    expect(
      copied.filter((s) => s.member_id === null && s.state === "open"),
    ).toHaveLength(2);
    expect(copied.find((s) => s.member_id === "m-deniz")?.state).toBe(
      "scheduled",
    );
    expect(
      copied.some((s) => s.member_id === "m-maya" || s.member_id === "m-lucas"),
    ).toBe(false);
  });
});

describe("coverage counts a shift by its Kind as well as its start (F-170)", () => {
  it("counts an 11:00–23:00 evening shift toward the evening", () => {
    const s = { start_time: "11:00", end_time: "23:00", shift_type: "pm" };
    expect(servesPeriod(s, "pm")).toBe(true);
    expect(servesPeriod(s, "am")).toBe(true);
  });

  it("counts a double toward both, including one that closes after midnight", () => {
    expect(
      servesPeriod(
        { start_time: "10:00", end_time: "01:00", shift_type: "double" },
        "pm",
      ),
    ).toBe(true);
  });

  it("does not read equal start and end times as a shift past midnight (F-874)", () => {
    expect(
      servesPeriod(
        { start_time: "10:00", end_time: "10:00", shift_type: "pm" },
        "pm",
      ),
    ).toBe(false);
  });

  it("does not count a morning shift left at the form's default Kind toward the evening", () => {
    expect(
      servesPeriod(
        { start_time: "09:00", end_time: "14:00", shift_type: "pm" },
        "pm",
      ),
    ).toBe(false);
    expect(
      servesPeriod(
        { start_time: "11:00", end_time: "23:00", shift_type: "am" },
        "pm",
      ),
    ).toBe(false);
  });

  it("fills the evening rule on the week read", async () => {
    const db = seed();
    db.tables.coverage_templates.push({
      id: "ct1",
      restaurant_id: RID,
      day_of_week: 5,
      role: "Floor",
      shift_period: "pm",
      min_staff: 1,
    });
    db.tables.schedules.push({
      id: "w",
      restaurant_id: RID,
      week_start: WEEK,
      status: "draft",
    });
    db.tables.shifts.push({
      id: "l1",
      restaurant_id: RID,
      schedule_id: "w",
      member_id: "m-deniz",
      shift_date: FRI,
      start_time: "11:00",
      end_time: "23:00",
      state: "scheduled",
      shift_type: "pm",
      role: "Floor",
    });
    const week: any = await service(db).getWeek(MANAGER, RID, WEEK);
    const friday = week.coverage.days.find((d: any) => d.date === FRI);
    expect(friday.gaps).toEqual([]);
  });
});
