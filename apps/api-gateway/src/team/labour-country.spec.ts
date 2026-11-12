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
import { labourShare, readWeekSales } from "./week-sales";

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

describe("F-1548 — a stored cost is priced again on the house's rules now", () => {
  /** Priced when the house read as Turkish: 9h less the Art. 68 hour, x 20. */
  function pricedOnTurkishRules(db: StubDb) {
    db.tables.shifts.push({
      id: "sh-old",
      restaurant_id: RID,
      schedule_id: "s1",
      member_id: "m-staff",
      shift_date: WEEK,
      start_time: "09:00",
      end_time: "18:00",
      state: "scheduled",
      shift_breaks: [],
      labor_cost: 160,
    });
  }

  it("a house whose country was fixed to the US reads 9 hours and 9 hours' cost", async () => {
    const db = seed({ country: "US", timezone: "America/Los_Angeles" });
    pricedOnTurkishRules(db);
    const week = await scheduleOf(db).getWeek(OWNER, RID, WEEK);
    expect(week.labor.totalHours).toBe(9);
    expect(week.labor.totalCost).toBe(180);
    expect(week.shifts[0].labor_cost).toBe(180);
  });

  it("prices the day at the wage the person had then, as a write does", async () => {
    const db = seed({ country: "US", timezone: "America/Los_Angeles" });
    pricedOnTurkishRules(db);
    db.tables.team_member_wage_changes.push({
      restaurant_id: RID,
      member_id: "m-staff",
      old_wage: 15,
      changed_at: "2026-09-20T10:00:00Z",
    });
    const week = await scheduleOf(db).getWeek(OWNER, RID, WEEK);
    expect(week.labor.totalCost).toBe(135);
  });

  it("a failed wage read is said, never the stored cost passed off as current", async () => {
    const db = seed({ country: "US", timezone: "America/Los_Angeles" });
    pricedOnTurkishRules(db);
    db.errors["team_member_wage_changes:select"] = { message: "boom" };
    await expect(scheduleOf(db).getWeek(OWNER, RID, WEEK)).rejects.toThrow(
      "Could not read the wages to cost this week, so the week is not shown.",
    );
  });
});

describe("F-1549 — the week's cost as a share of the till's net sales", () => {
  /** One 9-hour shift with no break taken: 9 x 20 = 180. */
  function costedWeek(db: StubDb) {
    db.tables.shifts.push({
      id: "sh1",
      restaurant_id: RID,
      schedule_id: "s1",
      member_id: "m-staff",
      shift_date: WEEK,
      start_time: "09:00",
      end_time: "18:00",
      state: "scheduled",
      shift_breaks: [],
      recorded_break_min: 0,
      labor_cost: 180,
    });
  }
  const check = (id: string, closed: string, subtotal: unknown) => ({
    id,
    restaurant_id: RID,
    voided: false,
    opened_at: closed,
    closed_at: closed,
    subtotal,
  });

  it("gives 10% when the till took 1800 over the whole week", async () => {
    const db = seed({ country: "TR", timezone: "Europe/Istanbul" });
    costedWeek(db);
    db.tables.pos_checks = [
      check("c0", "2026-08-01T12:00:00Z", 50), // the till's first day
      check("c1", "2026-09-07T12:00:00Z", 1000),
      check("c2", "2026-09-12T12:00:00Z", 800),
      check("c3", "2026-09-14T12:00:00Z", 999), // the Monday after
    ];
    const week = await scheduleOf(db).getWeek(OWNER, RID, WEEK);
    expect(week.labor.totalCost).toBe(180);
    expect(week.labor.netSales).toBe(1800);
    expect(week.labor.laborPct).toBe(10);
    expect(week.labor.laborPctWhy).toBeNull();
  });

  it("with no till, gives no share and says the sales are not known", async () => {
    const db = seed({ country: "TR", timezone: "Europe/Istanbul" });
    costedWeek(db);
    db.tables.pos_checks = [];
    const week = await scheduleOf(db).getWeek(OWNER, RID, WEEK);
    expect(week.labor.laborPct).toBeNull();
    expect(week.labor.netSales).toBeNull();
    expect(week.labor.laborPctWhy).toMatch(/No till is sending sales/);
  });

  it("a till that began mid-week, or checks with no amount, give no share", async () => {
    const db = seed({ country: "TR", timezone: "Europe/Istanbul" });
    costedWeek(db);
    db.tables.pos_checks = [
      check("c1", "2026-09-09T12:00:00Z", 1000),
      check("c2", "2026-09-20T12:00:00Z", 10),
    ];
    let week = await scheduleOf(db).getWeek(OWNER, RID, WEEK);
    expect(week.labor.laborPct).toBeNull();
    expect(week.labor.laborPctWhy).toMatch(/partway through this week/);

    db.tables.pos_checks = [
      check("c0", "2026-08-01T12:00:00Z", 50),
      check("c1", "2026-09-09T12:00:00Z", null),
      check("c2", "2026-09-20T12:00:00Z", 10),
    ];
    week = await scheduleOf(db).getWeek(OWNER, RID, WEEK);
    expect(week.labor.laborPct).toBeNull();
    expect(week.labor.laborPctWhy).toMatch(/no amount before tax/);
  });

  it("F-1716: a day with net on only some of its checks is not summed as the day", async () => {
    const db = seed({
      country: "TR",
      timezone: "Europe/Istanbul",
      tax_basis: "prices_include_tax",
    });
    costedWeek(db);
    db.tables.pos_checks = [
      check("c0", "2026-08-01T12:00:00Z", 50),
      check("c1", "2026-09-08T12:00:00Z", 1000),
      // Same Tuesday: a mixed-rate check the house could not make pre-tax.
      check("c2", "2026-09-08T13:00:00Z", null),
      check("c3", "2026-09-12T12:00:00Z", 800),
      check("c4", "2026-09-14T12:00:00Z", 999),
    ];
    const week = await scheduleOf(db).getWeek(OWNER, RID, WEEK);
    // Before: 1800 and 10%, the Tuesday read as its one stated check.
    expect(week.labor.netSales).toBeNull();
    expect(week.labor.laborPct).toBeNull();
    expect(week.labor.laborPctWhy).toBe(
      "1 of this week's 3 checks carries no amount before tax, so the week's sales are not all known.",
    );
  });

  it("F-1557: a ruled-out day with no check leaves the week's sales unknown, as on the dashboard", async () => {
    const db = seed({ country: "TR", timezone: "Europe/Istanbul" });
    costedWeek(db);
    db.tables.pos_checks = [
      check("c0", "2026-08-01T12:00:00Z", 50),
      check("c1", "2026-09-07T12:00:00Z", 1000),
      check("c2", "2026-09-12T12:00:00Z", 800),
      check("c3", "2026-09-14T12:00:00Z", 999),
    ];
    // Wednesday the till was down; the owner ruled it out of the figures.
    db.tables.analytics_day_exclusions = [
      { restaurant_id: RID, business_date: "2026-09-09" },
      { restaurant_id: "other", business_date: "2026-09-10" },
    ];
    let week = await scheduleOf(db).getWeek(OWNER, RID, WEEK);
    expect(week.labor.netSales).toBeNull();
    expect(week.labor.laborPct).toBeNull();
    expect(week.labor.laborPctWhy).toMatch(
      /ruled out of the figures and the till took nothing on it/,
    );

    // A ruled-out day whose checks did land still stands, as on the dashboard.
    db.tables.analytics_day_exclusions = [
      { restaurant_id: RID, business_date: "2026-09-07" },
    ];
    week = await scheduleOf(db).getWeek(OWNER, RID, WEEK);
    expect(week.labor.netSales).toBe(1800);

    // An unread list is said, never a quiet 0.
    db.errors["analytics_day_exclusions:select"] = { message: "boom" };
    week = await scheduleOf(db).getWeek(OWNER, RID, WEEK);
    expect(week.labor.netSales).toBeNull();
    expect(week.labor.laborPctWhy).toMatch(/could not be read/);
  });

  it("F-1588: a week across the day prices began to include KDV says its net is on two bases", async () => {
    const db = seed({
      country: "TR",
      timezone: "Europe/Istanbul",
      tax_basis: "prices_include_tax",
      tax_basis_confirmed_at: "2026-09-10T09:00:00Z", // Thursday, house day
    });
    costedWeek(db);
    db.tables.house_tax_basis_answers = [
      {
        restaurant_id: RID,
        basis: "prices_include_tax",
        answered_at: "2026-09-10T09:00:00Z",
        answered_by: OWNER,
      },
    ];
    db.tables.pos_checks = [
      check("c0", "2026-08-01T12:00:00Z", 50),
      check("c1", "2026-09-07T12:00:00Z", 1000),
      check("c2", "2026-09-12T12:00:00Z", 800),
      check("c3", "2026-09-14T12:00:00Z", 999),
    ];
    let week = await scheduleOf(db).getWeek(OWNER, RID, WEEK);
    // The figure stands; it says where its days change basis.
    expect(week.labor.netSales).toBe(1800);
    expect(week.labor.netSalesTaxNote).toMatch(
      /include KDV from 10 September 2026, so this period's net is not on one basis/,
    );
    expect(week.labor.netSalesTaxNote).toMatch(
      /Until 9 September 2026, .*as the till sent it/,
    );

    // The next week is wholly on the answer: no mark.
    db.tables.house_tax_basis_answers[0].answered_at = "2026-09-07T05:00:00Z";
    db.tables.restaurants[0].tax_basis_confirmed_at = "2026-09-07T05:00:00Z";
    week = await scheduleOf(db).getWeek(OWNER, RID, WEEK);
    expect(week.labor.netSalesTaxNote).toBeNull();

    // An unread answer history is said, and the figure still stands.
    db.tables.house_tax_basis_answers[0].answered_at = "2026-09-10T09:00:00Z";
    db.errors["house_tax_basis_answers:select"] = { message: "boom" };
    week = await scheduleOf(db).getWeek(OWNER, RID, WEEK);
    expect(week.labor.netSales).toBe(1800);
    expect(week.labor.netSalesTaxNote).toMatch(/could not be read/);
  });

  it('F-1588: an "added on top" answer mid-week leaves net as sent: no mark, and an unset house reads no history', async () => {
    const db = seed({
      country: "US",
      timezone: "America/Detroit",
      tax_basis: "prices_exclude_tax",
      tax_basis_confirmed_at: "2026-09-10T15:00:00Z",
    });
    costedWeek(db);
    db.tables.house_tax_basis_answers = [
      {
        restaurant_id: RID,
        basis: "prices_exclude_tax",
        answered_at: "2026-09-10T15:00:00Z",
        answered_by: OWNER,
      },
    ];
    db.tables.pos_checks = [
      check("c0", "2026-08-01T16:00:00Z", 50),
      check("c1", "2026-09-07T16:00:00Z", 1000),
      check("c3", "2026-09-14T16:00:00Z", 999),
    ];
    let week = await scheduleOf(db).getWeek(OWNER, RID, WEEK);
    expect(week.labor.netSales).toBe(1000);
    expect(week.labor.netSalesTaxNote).toBeNull();

    db.tables.restaurants[0].tax_basis = null;
    db.errors["house_tax_basis_answers:select"] = { message: "boom" };
    week = await scheduleOf(db).getWeek(OWNER, RID, WEEK);
    expect(week.labor.netSalesTaxNote).toBeNull();
  });

  it("a week not over yet gives no share and says why", async () => {
    const sales = await readWeekSales(
      {
        from: () => {
          throw new Error("must not read");
        },
      },
      RID,
      WEEK,
      "Europe/Istanbul",
      new Date("2026-09-10T12:00:00Z"),
    );
    expect(sales.netSales).toBeNull();
    expect(sales.unknownWhy).toMatch(/not over yet/);
  });

  it("no share of a cost that is not known, or of a manager's partial cost", () => {
    const known = { netSales: 1000, unknownWhy: null };
    expect(labourShare(250, known, 0)).toEqual({
      laborPct: 25,
      laborPctWhy: null,
    });
    expect(labourShare(null, known, 0).laborPct).toBeNull();
    expect(labourShare(250, known, 1).laborPct).toBeNull();
    expect(
      labourShare(250, { netSales: 0, unknownWhy: null }, 0).laborPct,
    ).toBeNull();
  });
});

describe("F-1550 — the hand-over warning writes hours as the house does", () => {
  it("a Turkish house reads 46,5; an American one 46.5", () => {
    const given = [
      // No break taken anywhere, so both houses count 10.5 + 3 x 12 = 46.5.
      {
        id: "g",
        shift_date: WEEK,
        start_time: "09:00",
        end_time: "19:30",
        recorded_break_min: 0,
      },
    ];
    const theirs = [1, 2, 3].map((d) => ({
      id: `t${d}`,
      shift_date: `2026-09-${String(7 + d).padStart(2, "0")}`,
      start_time: "09:00",
      end_time: "21:00",
      recorded_break_min: 0,
    }));
    const message = (house: any) =>
      handoverChecks(given as any, {}, theirs as any, [], false, house)
        .get("g")!
        .find((c) => c.code === "weekly_hours")!.message;
    const tr = houseLabour({ country: "TR", timezone: "Europe/Istanbul" });
    expect(tr.locale).toBe("tr-TR");
    expect(message(tr)).toBe(
      "With it they work 46,5 hours that week, over the 45-hour week.",
    );
    const us = houseLabour({ country: "US", timezone: "America/Chicago" });
    expect(message(us)).toBe(
      "With it they work 46.5 hours that week, over the 40-hour week.",
    );
  });
});
