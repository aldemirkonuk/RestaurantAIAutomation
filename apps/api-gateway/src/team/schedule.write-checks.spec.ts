import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
} from "@nestjs/common";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import { ScheduleService } from "./schedule.service";
import { TeamService } from "./team.service";
import { TeamController } from "./team.controller";
import {
  BroadcastDto,
  CreateShiftDto,
  CreateTeamMemberDto,
} from "./dto/team.dto";
import { isCalendarDate, timeOffRefusal, weekStartFromQuery } from "./shift-input";
import { asDatabaseService, makeStubDb, StubDb } from "./testing/supabase-stub";

/** QA round 4 team items: what a /team write checks before it saves. */

const RID = "restaurant-1";
const OWNER = "user-owner";
const MANAGER = "user-manager";
const SAM = "user-sam";
const KIM = "user-kim";
const WEEK = "2099-01-05"; // a Monday, never in the past
const DAY2 = "2099-01-06";

function seed(opts: { weekStatus?: string; doubleBooking?: boolean } = {}): StubDb {
  return makeStubDb({
    user_restaurant_access: [
      { id: "a1", user_id: OWNER, restaurant_id: RID, role: "owner", is_active: true },
      { id: "a2", user_id: MANAGER, restaurant_id: RID, role: "manager", is_active: true },
      { id: "a3", user_id: SAM, restaurant_id: RID, role: "staff", is_active: true },
      { id: "a4", user_id: KIM, restaurant_id: RID, role: "staff", is_active: true },
    ],
    users: [
      { user_id: OWNER, restaurant_id: RID, role: "owner", email: "ada@example.test" },
      { user_id: MANAGER, restaurant_id: RID, role: "manager", email: "moe@example.test" },
      { user_id: SAM, restaurant_id: RID, role: "staff", email: "sam@example.test" },
      { user_id: KIM, restaurant_id: RID, role: "staff", email: "kim@example.test" },
    ],
    team_members: [
      { id: "m-sam", restaurant_id: RID, user_id: SAM, display_name: "Sam", hourly_wage: 20 },
      { id: "m-kim", restaurant_id: RID, user_id: KIM, display_name: "Kim", hourly_wage: 20 },
    ],
    team_settings: [
      {
        restaurant_id: RID,
        labor_tracking_enabled: true,
        wage_visible: true,
        labor_target_pct: 30,
        allow_double_booking: opts.doubleBooking === true,
      },
    ],
    restaurants: [{ id: RID, currency: "TRY", country: "TR" }],
    schedules: [
      { id: "s1", restaurant_id: RID, week_start: WEEK, status: opts.weekStatus ?? "published" },
    ],
    shifts: [
      {
        id: "sh-sam",
        restaurant_id: RID,
        schedule_id: "s1",
        member_id: "m-sam",
        shift_date: WEEK,
        start_time: "09:00",
        end_time: "17:00",
        role: "server",
        shift_type: "am",
        state: "scheduled",
        note: null,
        recorded_break_min: null,
      },
      {
        id: "sh-open",
        restaurant_id: RID,
        schedule_id: "s1",
        member_id: null,
        shift_date: DAY2,
        start_time: "18:00",
        end_time: "23:00",
        role: "server",
        shift_type: "open",
        state: "open",
        note: null,
        recorded_break_min: null,
      },
    ],
    shift_breaks: [],
    time_off_requests: [],
    coverage_templates: [],
    notifications: [],
    system_audit_log: [],
  });
}

function build(db: StubDb) {
  const team = new TeamService(asDatabaseService(db));
  const notifications = {
    persistForRestaurant: jest.fn(async () => ({ inserted: 0 })),
  } as any;
  const push = { sendToUsers: jest.fn(async () => undefined) } as any;
  return {
    team,
    notifications,
    svc: new ScheduleService(asDatabaseService(db), team, notifications, push),
  };
}

/**
 * Make two writers race for real: every guarded write on `table` waits until
 * `reads` single-row reads of it have landed, so both callers have read the
 * row before either writes. Reads answer copies, as PostgREST does, so a
 * write cannot reach back into a row a caller already holds.
 */
function race(db: StubDb, table: string, reads: number): void {
  const realFrom = db.supabase.from.bind(db.supabase);
  let seen = 0;
  let open!: () => void;
  const gate = new Promise<void>((resolve) => {
    open = resolve;
    setTimeout(resolve, 200); // never hang a spec on a miscount
  });
  (db.supabase as any).from = (t: string) => {
    const b: any = realFrom(t);
    if (t !== table) return b;
    const realMaybe = b.maybeSingle.bind(b);
    b.maybeSingle = async () => {
      if (b.op === "update") await gate;
      const r = await realMaybe();
      if (b.op === "select" && ++seen >= reads) open();
      return { ...r, data: r.data ? { ...r.data } : r.data };
    };
    return b;
  };
}

const shiftsOn = (db: StubDb, date: string) =>
  db.tables.shifts.filter((s) => s.shift_date === date);

describe("B4 — a call-out happens once", () => {
  it("a second call-out is refused: one cover shift, one notice", async () => {
    const db = seed();
    const { svc, notifications } = build(db);
    await svc.reportCallout(MANAGER, RID, "sh-sam", {} as any);
    await expect(
      svc.reportCallout(MANAGER, RID, "sh-sam", {} as any),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(shiftsOn(db, WEEK).filter((s) => s.state === "open")).toHaveLength(1);
    expect(notifications.persistForRestaurant).toHaveBeenCalledTimes(1);
  });

  it("two call-outs at once mark the shift once", async () => {
    const db = seed();
    race(db, "shifts", 2);
    const { svc, notifications } = build(db);
    const results = await Promise.allSettled([
      svc.reportCallout(MANAGER, RID, "sh-sam", {} as any),
      svc.reportCallout(MANAGER, RID, "sh-sam", {} as any),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(shiftsOn(db, WEEK).filter((s) => s.state === "open")).toHaveLength(1);
    expect(notifications.persistForRestaurant).toHaveBeenCalledTimes(1);
  });

  it("an open shift has no one to call out", async () => {
    const db = seed();
    await expect(
      build(db).svc.reportCallout(MANAGER, RID, "sh-open", {} as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("when the cover shift cannot be opened, the call-out mark is undone", async () => {
    const db = seed();
    db.errors["shifts:insert"] = { message: "insert failed" };
    const { svc, notifications } = build(db);
    await expect(
      svc.reportCallout(MANAGER, RID, "sh-sam", {} as any),
    ).rejects.toThrow(/call-out was not recorded/);
    expect(db.tables.shifts.find((s) => s.id === "sh-sam")?.state).toBe("scheduled");
    expect(notifications.persistForRestaurant).not.toHaveBeenCalled();
  });

  it("a failed read of the shift is said, not a missing shift", async () => {
    const db = seed();
    db.errors["shifts:select"] = { message: "timeout" };
    await expect(
      build(db).svc.reportCallout(MANAGER, RID, "sh-sam", {} as any),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});

describe("S4 — the cover shift names who called out, not their id", () => {
  const coverNote = (db: StubDb) =>
    shiftsOn(db, WEEK).find((s) => s.state === "open")?.note;

  it("the open cover shift says the person's name", async () => {
    const db = seed();
    await build(db).svc.reportCallout(MANAGER, RID, "sh-sam", {} as any);
    expect(coverNote(db)).toBe("Cover for Sam, who called out");
    expect(coverNote(db)).not.toContain("m-sam");
  });

  it("the reason stays on the called-out row; the cover note does not copy it", async () => {
    const db = seed();
    await build(db).svc.reportCallout(MANAGER, RID, "sh-sam", { reason: "fever" } as any);
    expect(coverNote(db)).toBe("Cover for Sam, who called out");
    expect(db.tables.shifts.find((s) => s.id === "sh-sam")?.note).toBe("Call-out: fever");
  });

  it("the name is read from this house's roster only", async () => {
    const db = seed();
    // The same member id in another house, listed first: an unscoped read
    // would print its name (or fail on two rows).
    const sam = db.tables.team_members.find((m) => m.id === "m-sam")!;
    db.tables.team_members.unshift({ ...sam, restaurant_id: "other-house", display_name: "Elsewhere" });
    await build(db).svc.reportCallout(MANAGER, RID, "sh-sam", {} as any);
    expect(coverNote(db)).toBe("Cover for Sam, who called out");
  });

  it("a blank name reads as a plain call-out", async () => {
    const db = seed();
    db.tables.team_members.find((m) => m.id === "m-sam")!.display_name = "   ";
    await build(db).svc.reportCallout(MANAGER, RID, "sh-sam", {} as any);
    expect(coverNote(db)).toBe("Cover for a call-out");
  });

  it("a failed name read still records the call-out, in plain words", async () => {
    const db = seed();
    const realFrom = db.supabase.from.bind(db.supabase);
    (db.supabase as any).from = (t: string) => {
      const b: any = realFrom(t);
      if (t !== "team_members") return b;
      const realMaybe = b.maybeSingle.bind(b);
      b.maybeSingle = async () =>
        b.columns === "display_name"
          ? { data: null, error: { message: "timeout" } }
          : realMaybe();
      return b;
    };
    const { svc, notifications } = build(db);
    await svc.reportCallout(MANAGER, RID, "sh-sam", {} as any);
    expect(coverNote(db)).toBe("Cover for a call-out");
    expect(db.tables.shifts.find((s) => s.id === "sh-sam")?.state).toBe("callout");
    expect(notifications.persistForRestaurant).toHaveBeenCalledTimes(1);
  });
});

describe("B5 — an open shift is claimed once, by rules", () => {
  it("two staff taking the same open shift at once: one gets it, the other is told", async () => {
    const db = seed();
    // Each claim reads the shift, then reads it again to price it.
    race(db, "shifts", 4);
    const { svc } = build(db);
    const [sam, kim] = await Promise.allSettled([
      svc.assignCover(SAM, RID, "sh-open", { memberId: "m-sam" } as any),
      svc.assignCover(KIM, RID, "sh-open", { memberId: "m-kim" } as any),
    ]);
    const won = [sam, kim].filter((r) => r.status === "fulfilled");
    const lost = [sam, kim].filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(won).toHaveLength(1);
    expect(lost).toHaveLength(1);
    expect(lost[0].reason).toBeInstanceOf(ConflictException);
    const row = db.tables.shifts.find((s) => s.id === "sh-open");
    expect(row?.member_id).toBe(sam.status === "fulfilled" ? "m-sam" : "m-kim");
  });

  it("staff cannot claim a shift on a day that has passed", async () => {
    const db = seed();
    Object.assign(db.tables.shifts.find((s) => s.id === "sh-open")!, { shift_date: "2020-01-07" });
    await expect(
      build(db).svc.assignCover(SAM, RID, "sh-open", { memberId: "m-sam" } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("staff cannot claim from a week that is not published", async () => {
    const db = seed({ weekStatus: "draft" });
    await expect(
      build(db).svc.assignCover(SAM, RID, "sh-open", { memberId: "m-sam" } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.tables.shifts.find((s) => s.id === "sh-open")?.member_id).toBeNull();
  });

  it("staff cannot claim a shift that overlaps their own, unless the owner allows it", async () => {
    const db = seed();
    Object.assign(db.tables.shifts.find((s) => s.id === "sh-open")!, {
      shift_date: WEEK,
      start_time: "16:00",
      end_time: "22:00",
    });
    await expect(
      build(db).svc.assignCover(SAM, RID, "sh-open", { memberId: "m-sam" } as any),
    ).rejects.toBeInstanceOf(ConflictException);
    db.tables.team_settings[0].allow_double_booking = true;
    const got = await build(db).svc.assignCover(SAM, RID, "sh-open", { memberId: "m-sam" } as any);
    expect(got.member_id).toBe("m-sam");
  });
});

describe("B6 — a hand-written shift has clock times and one person at a time", () => {
  const create = (svc: ScheduleService, over: Record<string, unknown>) =>
    svc.createShift(MANAGER, RID, {
      memberId: "m-sam",
      shiftDate: WEEK,
      startTime: "18:00",
      endTime: "22:00",
      ...over,
    } as any);

  it("refuses times that are not clock times, and a shift of no length", async () => {
    const db = seed();
    const { svc } = build(db);
    for (const bad of [{ startTime: "banana" }, { endTime: "25:99" }, { startTime: "18:00", endTime: "18:00" }]) {
      await expect(create(svc, bad)).rejects.toBeInstanceOf(BadRequestException);
    }
    expect(shiftsOn(db, WEEK)).toHaveLength(1);
  });

  it("refuses a second shift that overlaps the person's own, and writes nothing", async () => {
    const db = seed();
    await expect(
      create(build(db).svc, { startTime: "16:00", endTime: "20:00" }),
    ).rejects.toThrow(/already works 2099-01-05 09:00–17:00/);
    expect(shiftsOn(db, WEEK)).toHaveLength(1);
  });

  it("allows it when the owner allows double booking", async () => {
    const db = seed({ doubleBooking: true });
    await create(build(db).svc, { startTime: "16:00", endTime: "20:00" });
    expect(shiftsOn(db, WEEK)).toHaveLength(2);
  });

  it("a shift that starts as the other ends is not an overlap", async () => {
    const db = seed();
    await create(build(db).svc, { startTime: "17:00", endTime: "22:00" });
    expect(shiftsOn(db, WEEK)).toHaveLength(2);
  });

  it("a closing shift past midnight overlaps the next morning", async () => {
    const db = seed();
    const { svc } = build(db);
    await create(svc, { startTime: "18:00", endTime: "02:00" });
    await expect(
      create(svc, { shiftDate: DAY2, startTime: "01:00", endTime: "05:00" }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("a called-out shift is not worked, so it does not count", async () => {
    const db = seed();
    db.tables.shifts.find((s) => s.id === "sh-sam")!.state = "callout";
    await create(build(db).svc, { startTime: "09:00", endTime: "17:00" });
    expect(shiftsOn(db, WEEK)).toHaveLength(2);
  });

  it("moving a shift onto the person's other shift is refused", async () => {
    const db = seed();
    const { svc } = build(db);
    const evening = await create(svc, { startTime: "18:00", endTime: "22:00" });
    await expect(
      svc.updateShift(MANAGER, RID, evening.id, { startTime: "16:00" } as any),
    ).rejects.toBeInstanceOf(ConflictException);
    // Changing only its note is not a move.
    await svc.updateShift(MANAGER, RID, evening.id, { note: "bar" } as any);
  });

  it("an edit judges the times it sends, not an older row's untouched time", async () => {
    const db = seed();
    const legacy = db.tables.shifts.find((s) => s.id === "sh-sam")!;
    legacy.start_time = "9:00"; // a text column; written before any check
    const { svc } = build(db);
    await svc.updateShift(MANAGER, RID, "sh-sam", { endTime: "16:00" } as any);
    await expect(
      svc.updateShift(MANAGER, RID, "sh-sam", { endTime: "25:99" } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
    legacy.start_time = "09:00";
    await expect(
      svc.updateShift(MANAGER, RID, "sh-sam", { endTime: "09:00" } as any),
    ).rejects.toThrow(/cannot start and end at 09:00/);
  });

  it("a failed read of the person's shifts saves nothing", async () => {
    const db = seed();
    db.errors["shifts:select"] = { message: "timeout" };
    await expect(create(build(db).svc, {})).rejects.toThrow(/other shifts/);
    expect(shiftsOn(db, WEEK)).toHaveLength(1);
  });

  it("the request body refuses a time that is not a clock time", () => {
    const dto = plainToInstance(CreateShiftDto, { shiftDate: WEEK, startTime: "banana", endTime: "25:99" });
    const fields = validateSync(dto).map((e) => e.property);
    expect(fields).toEqual(expect.arrayContaining(["startTime", "endTime"]));
    const ok = plainToInstance(CreateShiftDto, { shiftDate: WEEK, startTime: "09:00", endTime: "17:00:00" });
    expect(validateSync(ok)).toEqual([]);
  });

});

describe("B7 — time off runs forwards, a year at most", () => {
  const request = (db: StubDb, startDate: string, endDate: string) =>
    build(db).team.createTimeOff(MANAGER, RID, { memberId: "m-sam", startDate, endDate } as any);

  it("refuses a request that ends before it starts, and writes nothing", async () => {
    const db = seed();
    await expect(request(db, "2099-01-10", "2099-01-05")).rejects.toBeInstanceOf(BadRequestException);
    expect(db.tables.time_off_requests).toHaveLength(0);
  });

  it("refuses more than 365 days in one request, and an impossible date", async () => {
    expect(timeOffRefusal("2099-01-01", "2099-12-31")).toBeNull(); // 365 days
    expect(timeOffRefusal("2099-01-01", "2100-01-01")).toMatch(/at most 365 days; this one covers 366/);
    expect(timeOffRefusal("2099-02-30", "2099-03-01")).toMatch(/real dates/);
  });

  it("files a one-day request", async () => {
    const db = seed();
    await request(db, WEEK, WEEK);
    expect(db.tables.time_off_requests).toHaveLength(1);
  });
});

describe("B8 — a bad weekStart is a 400, and any day reads its own week", () => {
  it("refuses a missing, malformed or impossible date", () => {
    for (const bad of [undefined, "", "banana", "2026-02-30", "2026-9-7"]) {
      expect(() => weekStartFromQuery(bad)).toThrow(BadRequestException);
    }
    expect(isCalendarDate("2028-02-29")).toBe(true);
  });

  it("the week and my-week routes refuse a bad date before any read, and pass the Monday on", () => {
    const schedule = { getWeek: jest.fn(async () => ({})), getMyWeek: jest.fn(async () => ({})) } as any;
    const controller = new TeamController({} as any, schedule, {} as any, {} as any, {} as any, {} as any);
    const req = { user: { userId: MANAGER } } as any;
    expect(() => controller.week(req, RID, "banana")).toThrow(BadRequestException);
    expect(() => controller.myWeek(req, RID, undefined as any)).toThrow(BadRequestException);
    expect(schedule.getWeek).not.toHaveBeenCalled();
    controller.week(req, RID, "2026-09-09");
    controller.myWeek(req, RID, "2026-09-13");
    expect(schedule.getWeek).toHaveBeenCalledWith(MANAGER, RID, "2026-09-07");
    expect(schedule.getMyWeek).toHaveBeenCalledWith(MANAGER, RID, "2026-09-07");
  });

  it("reads a Monday as itself and any other day as its week's Monday", () => {
    expect(weekStartFromQuery("2026-09-07")).toBe("2026-09-07"); // Monday
    expect(weekStartFromQuery("2026-09-09")).toBe("2026-09-07"); // Wednesday
    expect(weekStartFromQuery("2026-09-13")).toBe("2026-09-07"); // Sunday
  });
});

describe("B9 — a crew message and a wage have bounds", () => {
  const errorsOf = (cls: any, body: Record<string, unknown>) =>
    validateSync(plainToInstance(cls, body)).map((e) => e.property);

  it("an empty or over-long broadcast is refused; a normal one passes", () => {
    expect(errorsOf(BroadcastDto, { message: "", audience: "everyone" })).toContain("message");
    expect(errorsOf(BroadcastDto, { message: "x".repeat(1001), audience: "everyone" })).toContain("message");
    expect(errorsOf(BroadcastDto, { message: "x".repeat(1000), audience: "everyone" })).not.toContain("message");
  });

  it("an hourly wage above 100 000 is refused", () => {
    expect(errorsOf(CreateTeamMemberDto, { displayName: "Sam", hourlyWage: 100_001 })).toContain("hourlyWage");
    expect(errorsOf(CreateTeamMemberDto, { displayName: "Sam", hourlyWage: 450 })).toEqual([]);
  });
});
