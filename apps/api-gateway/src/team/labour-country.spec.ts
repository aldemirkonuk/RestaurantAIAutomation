import { ScheduleService } from "./schedule.service";
import { TeamService } from "./team.service";
import {
  breakCounted,
  handoverChecks,
  hoursBetween,
  houseLabour,
  LABOUR_RULES,
  labourRulesFor,
  minimumBreak,
  NO_LABOUR_RULES,
  priceShift,
  SUBDIVISION_LABOUR_RULES,
  workedHours,
} from "./pay-rules";
import { asDatabaseService, makeStubDb, StubDb } from "./testing/supabase-stub";

/**
 * Labour rules follow the house's country (founder ruling S195, 2026-10-11:
 * "Every house gets its rules based on its location"). F-155 / F-1385 /
 * F-1399: a US house got the Turkish 45-hour week and the 4857 Art. 68
 * breaks. F-1367: an overnight shift on a DST night was counted on the wall
 * clock. Every case here fails on the tree before the per-country table.
 */

const RID = "restaurant-1";
const OWNER = "user-owner";
const WEEK = "2026-09-07"; // a Monday

function seed(house: Record<string, any>): StubDb {
  return makeStubDb({
    user_restaurant_access: [
      {
        id: "a1",
        user_id: OWNER,
        restaurant_id: RID,
        role: "owner",
        is_active: true,
      },
    ],
    users: [{ user_id: OWNER, restaurant_id: RID, role: "owner", name: "Ada" }],
    team_members: [
      {
        id: "m-staff",
        restaurant_id: RID,
        user_id: null,
        display_name: "Sam",
        hourly_wage: 20,
        created_at: "2026-01-03",
      },
    ],
    team_settings: [
      {
        restaurant_id: RID,
        labor_tracking_enabled: true,
        labor_target_pct: 30,
      },
    ],
    schedules: [
      { id: "s1", restaurant_id: RID, week_start: WEEK, status: "draft" },
    ],
    shifts: [],
    shift_breaks: [],
    schedule_receipts: [],
    coverage_templates: [],
    time_off_requests: [],
    notifications: [],
    system_audit_log: [],
    team_member_wage_changes: [],
    restaurants: [{ id: RID, ...house }],
  });
}

function scheduleOf(db: StubDb) {
  const team = new TeamService(asDatabaseService(db));
  const notifications = {
    persistForRestaurant: jest.fn(async () => ({ inserted: 0 })),
  } as any;
  const push = { sendToUsers: jest.fn(async () => undefined) } as any;
  return new ScheduleService(asDatabaseService(db), team, notifications, push);
}

/** Five 9-hour shifts, nothing recorded: 45h on the clock, Mon-Fri. */
function longWeek(db: StubDb, end = "18:00") {
  for (let d = 0; d < 5; d++) {
    db.tables.shifts.push({
      id: `sh${d}`,
      restaurant_id: RID,
      schedule_id: "s1",
      member_id: "m-staff",
      shift_date: `2026-09-${String(7 + d).padStart(2, "0")}`,
      start_time: "09:00",
      end_time: end,
      state: "scheduled",
      shift_breaks: [],
    });
  }
}

const at = (start: string, end: string, over: Record<string, any> = {}) => ({
  start_time: start,
  end_time: end,
  ...over,
});

describe("the rules table, keyed by the house's country", () => {
  it("reads a code or a name, and never falls back to Türkiye", () => {
    expect(labourRulesFor("TR").country).toBe("TR");
    expect(labourRulesFor("Türkiye").country).toBe("TR");
    expect(labourRulesFor("United States").country).toBe("US");
    expect(labourRulesFor("GB").country).toBe("GB");
    expect(labourRulesFor("Germany").country).toBe("DE"); // not the retired DD
    expect(labourRulesFor("Deutschland").country).toBe("DE");
    expect(labourRulesFor("France")).toBe(NO_LABOUR_RULES);
    expect(labourRulesFor(null)).toBe(NO_LABOUR_RULES);
  });

  it("takes the country from the zone when none is recorded", () => {
    expect(
      houseLabour({ timezone: "Europe/Istanbul", country: null }).rules.country,
    ).toBe("TR");
    expect(
      houseLabour({ timezone: "America/Detroit", country: "US" }).zone,
    ).toBe("America/Detroit");
    expect(houseLabour({ timezone: null, country: "Türkiye" }).zone).toBe(
      "Europe/Istanbul",
    );
  });

  it("TR keeps 4857: the 45-hour week and the Art. 68 minimum", () => {
    expect(LABOUR_RULES.TR.weeklyReviewHours).toBe(45);
    const tr = { rules: LABOUR_RULES.TR };
    expect(breakCounted(at("09:00", "17:00"), tr)).toEqual({
      minutes: 30,
      assumed: true,
    });
    expect(breakCounted(at("09:00", "12:00"), tr)).toEqual({
      minutes: 15,
      assumed: true,
    });
  });

  it("US: the FLSA 40-hour week, and no break assumed (no federal rule)", () => {
    const us = { rules: LABOUR_RULES.US };
    expect(LABOUR_RULES.US.weeklyReviewHours).toBe(40);
    expect(breakCounted(at("09:00", "19:00"), us)).toEqual({
      minutes: 0,
      assumed: false,
    });
    expect(workedHours(at("09:00", "19:00"), us)).toBe(10);
    expect(priceShift(20, at("09:00", "19:00"), us)).toBe(200);
  });

  it("GB: the 48-hour average week, 20 minutes over 6 hours of work", () => {
    const gb = { rules: LABOUR_RULES.GB };
    expect(LABOUR_RULES.GB.weeklyReviewHours).toBe(48);
    expect(minimumBreak(360, LABOUR_RULES.GB)).toBe(0);
    expect(minimumBreak(361, LABOUR_RULES.GB)).toBe(20);
    expect(breakCounted(at("09:00", "17:00"), gb)).toEqual({
      minutes: 20,
      assumed: true,
    });
    expect(breakCounted(at("09:00", "14:00"), gb)).toEqual({
      minutes: 0,
      assumed: false,
    });
  });

  it("DE: 30 minutes over 6 hours of work, 45 over 9, a 10-hour day", () => {
    const de = { rules: LABOUR_RULES.DE };
    expect(LABOUR_RULES.DE.dailyReviewHours).toBe(10);
    expect(minimumBreak(360, LABOUR_RULES.DE)).toBe(0);
    expect(minimumBreak(390, LABOUR_RULES.DE)).toBe(30);
    expect(minimumBreak(570, LABOUR_RULES.DE)).toBe(30); // 9h of work after it
    expect(minimumBreak(571, LABOUR_RULES.DE)).toBe(45);
    expect(breakCounted(at("08:00", "18:00"), de)).toEqual({
      minutes: 45,
      assumed: true,
    });
  });

  it("any other country: no break assumed and no weekly line", () => {
    const fr = { rules: NO_LABOUR_RULES };
    expect(breakCounted(at("09:00", "19:00"), fr)).toEqual({
      minutes: 0,
      assumed: false,
    });
    expect(NO_LABOUR_RULES.weeklyReviewHours).toBeNull();
  });

  it("the hand-over warning uses the house's week, and none where it has no rule", () => {
    const given = [
      { id: "g", shift_date: WEEK, start_time: "09:00", end_time: "19:00" },
    ];
    const theirs = [1, 2, 3, 4].map((d) => ({
      id: `t${d}`,
      shift_date: `2026-09-${String(7 + d).padStart(2, "0")}`,
      start_time: "09:00",
      end_time: "19:00",
    }));
    const codes = (house: any) =>
      (
        handoverChecks(given as any, {}, theirs as any, [], false, house).get(
          "g",
        ) ?? []
      ).map((c) => c.code);
    expect(codes({ rules: LABOUR_RULES.US })).toEqual(["weekly_hours"]); // 50h > 40
    expect(codes({ rules: LABOUR_RULES.GB })).toEqual(["weekly_hours"]); // 50h > 48
    expect(codes({ rules: NO_LABOUR_RULES })).toEqual([]);
  });
});

describe("F-1367 — a DST night counts the hours really worked", () => {
  it("Detroit, 2026-10-31 22:00 to 06:00 across the fall-back is 9 hours", () => {
    expect(
      hoursBetween("22:00", "06:00", {
        date: "2026-10-31",
        zone: "America/Detroit",
      }),
    ).toBe(9);
    // On the wall clock it reads 8: the hour repeated at 01:00 was worked too.
    expect(hoursBetween("22:00", "06:00")).toBe(8);
  });

  it("Detroit, 2026-03-07 22:00 to 06:00 across the spring-forward is 7 hours", () => {
    expect(
      hoursBetween("22:00", "06:00", {
        date: "2026-03-07",
        zone: "America/Detroit",
      }),
    ).toBe(7);
  });

  it("an ordinary night is unchanged, and so is a shift with no zone", () => {
    expect(
      hoursBetween("22:00", "06:00", {
        date: "2026-10-10",
        zone: "America/Detroit",
      }),
    ).toBe(8);
    expect(
      hoursBetween("22:00", "06:00", { date: "2026-10-31", zone: null }),
    ).toBe(8);
  });

  it("prices the Detroit night on 9 hours", () => {
    const house = houseLabour({ country: "US", timezone: "America/Detroit" });
    expect(
      priceShift(
        20,
        { shift_date: "2026-10-31", start_time: "22:00", end_time: "06:00" },
        house,
      ),
    ).toBe(180);
  });
});

describe("F-155 / F-1385 — /team reads a US house on US rules", () => {
  it("flags 45 hours as over the 40-hour week, with no assumed break", async () => {
    const db = seed({ country: "US", timezone: "America/Los_Angeles" });
    longWeek(db);
    const week = await scheduleOf(db).getWeek(OWNER, RID, WEEK);
    expect(week.labor.weeklyReviewHours).toBe(40);
    expect(week.labor.labourCountry).toBe("US");
    expect(week.labor.totalHours).toBe(45);
    expect(week.labor.assumedBreakShifts).toBe(0);
    expect(week.labor.overtime).toEqual([{ memberId: "m-staff", hours: 45 }]);
  });

  it("the same week in a Turkish house is 40 worked hours, under 45", async () => {
    const db = seed({ country: "TR", timezone: "Europe/Istanbul" });
    longWeek(db);
    const week = await scheduleOf(db).getWeek(OWNER, RID, WEEK);
    expect(week.labor.weeklyReviewHours).toBe(45);
    expect(week.labor.totalHours).toBe(40); // 9h spans less the Art. 68 hour
    expect(week.labor.assumedBreakShifts).toBe(5);
    expect(week.labor.overtime).toEqual([]);
  });

  it("a house elsewhere gets no review line and no assumed break, never Turkey's", async () => {
    const db = seed({ country: "France", timezone: "Europe/Paris" });
    longWeek(db, "20:00"); // 55h
    const week = await scheduleOf(db).getWeek(OWNER, RID, WEEK);
    expect(week.labor.weeklyReviewHours).toBeNull();
    expect(week.labor.labourCountry).toBeNull();
    expect(week.labor.assumedBreakShifts).toBe(0);
    expect(week.labor.overtime).toEqual([]);
  });

  it("prices a new US shift on its whole span", async () => {
    const db = seed({ country: "US", timezone: "America/Los_Angeles" });
    const created = await scheduleOf(db).createShift(OWNER, RID, {
      memberId: "m-staff",
      shiftDate: WEEK,
      startTime: "09:00",
      endTime: "19:00",
    } as any);
    const row = db.tables.shifts.find((s) => s.id === created.id)!;
    expect(row.labor_cost).toBe(200); // 10h x 20, no Art. 68 hour taken out
  });
});

describe("ADR 0330 US-CA — a Californian house gets its state's rules on top of FLSA", () => {
  const CA = SUBDIVISION_LABOUR_RULES["US-CA"];

  it("reads California only inside a recorded United States", () => {
    expect(houseLabour({ country: "US", state_province: "CA" }).rules).toBe(CA);
    expect(
      houseLabour({ country: "United States", state_province: "California" })
        .rules,
    ).toBe(CA);
    // Another state keeps the federal row; so does a house with no state.
    expect(houseLabour({ country: "US", state_province: "NY" }).rules).toBe(
      LABOUR_RULES.US,
    );
    expect(houseLabour({ country: "US" }).rules).toBe(LABOUR_RULES.US);
    // No country recorded: the zone gives the US, but no state is read (ADR 0305).
    expect(
      houseLabour({ timezone: "America/Los_Angeles", state_province: "CA" })
        .rules,
    ).toBe(LABOUR_RULES.US);
    // "CA" on a house in another country is not California.
    expect(houseLabour({ country: "TR", state_province: "CA" }).rules).toBe(
      LABOUR_RULES.TR,
    );
    expect(labourRulesFor("GB", "US-CA")).toBe(LABOUR_RULES.GB);
  });

  it("keeps the 40-hour week, adds an 8-hour day and a 30-minute meal period over 5 hours of work", () => {
    expect(CA.country).toBe("US");
    expect(CA.region).toBe("US-CA");
    expect(CA.weeklyReviewHours).toBe(40);
    expect(CA.dailyReviewHours).toBe(8);
    expect(minimumBreak(5 * 60, CA)).toBe(0); // exactly 5 hours: none owed
    expect(minimumBreak(6 * 60, CA)).toBe(30);
    const house = { rules: CA };
    expect(breakCounted(at("09:00", "18:00"), house)).toEqual({
      minutes: 30,
      assumed: true,
    });
    expect(breakCounted(at("09:00", "13:00"), house)).toEqual({
      minutes: 0,
      assumed: false,
    });
    expect(workedHours(at("09:00", "18:00"), house)).toBe(8.5);
  });

  it("names a 9-hour day and the long week in a California house", async () => {
    const db = seed({
      country: "US",
      state_province: "CA",
      timezone: "America/Los_Angeles",
    });
    longWeek(db); // five 9-hour spans: 8.5 worked each after the meal period
    const week = await scheduleOf(db).getWeek(OWNER, RID, WEEK);
    expect(week.labourRegion).toBe("US-CA");
    expect(week.labor.labourRegion).toBe("US-CA");
    expect(week.labor.weeklyReviewHours).toBe(40);
    expect(week.labor.dailyReviewHours).toBe(8);
    expect(week.labor.totalHours).toBe(42.5);
    expect(week.labor.assumedBreakShifts).toBe(5);
    expect(week.labor.overtime).toEqual([{ memberId: "m-staff", hours: 42.5 }]);
    expect(week.labor.overDay).toHaveLength(5);
    expect(week.labor.overDay[0]).toEqual({
      memberId: "m-staff",
      date: "2026-09-07",
      hours: 8.5,
    });
  });

  it("the same week in Texas is federal: no meal period assumed, no daily line", async () => {
    const db = seed({
      country: "US",
      state_province: "TX",
      timezone: "America/Chicago",
    });
    longWeek(db);
    const week = await scheduleOf(db).getWeek(OWNER, RID, WEEK);
    expect(week.labourRegion).toBeNull();
    expect(week.labor.dailyReviewHours).toBeNull();
    expect(week.labor.totalHours).toBe(45);
    expect(week.labor.assumedBreakShifts).toBe(0);
    expect(week.labor.overDay).toEqual([]);
  });

  it("prices a new California shift without its meal period", async () => {
    const db = seed({
      country: "US",
      state_province: "California",
      timezone: "America/Los_Angeles",
    });
    const created = await scheduleOf(db).createShift(OWNER, RID, {
      memberId: "m-staff",
      shiftDate: WEEK,
      startTime: "09:00",
      endTime: "19:00",
    } as any);
    const row = db.tables.shifts.find((s) => s.id === created.id)!;
    expect(row.labor_cost).toBe(190); // 9.5h x 20: the 30-minute meal is not paid
  });
});
