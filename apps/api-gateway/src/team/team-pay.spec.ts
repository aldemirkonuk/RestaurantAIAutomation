import {
  BadRequestException,
  ForbiddenException,
  InternalServerErrorException,
} from "@nestjs/common";
import { ScheduleService } from "./schedule.service";
import { TeamService } from "./team.service";
import { handoverOf } from "./team.controller";
import {
  art68BreakForWork,
  art68MinimumBreak,
  breakCounted,
  doubleBookingRefusal,
  handoverBlock,
  handoverChecks,
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
import { MembersService } from "../restaurants/members.service";
import { AuthService } from "../auth/auth.service";

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
  return withReleaseRpc(makeStubDb({
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
  }));
}

/**
 * `release_leaving_shifts` (migration 20261201130000) over the stub's tables,
 * the way the SQL does it: every row re-checked against what was read, all
 * of it applied or none of it. The SQL itself is held by its own test,
 * `supabase/tests/20261201130000_a_removal_mid_shift_splits_the_shift_test.sql`.
 * Fail it with `db.errors["rpc:release_leaving_shifts"]`.
 */
function withReleaseRpc(db: StubDb): StubDb {
  let nextRest = 0;
  (db.supabase as any).rpc = async (fn: string, args: any) => {
    db.ops.push({ table: `rpc:${fn}`, op: "update", filters: [], payload: args } as any);
    const forced = db.errors[`rpc:${fn}`];
    if (forced) return { data: null, error: forced };
    if (fn === "hand_over_leaving_shifts") return handOver(args);
    if (fn !== "release_leaving_shifts") throw new Error(`stub: no rpc ${fn}`);
    return release(args);
  };
  // `hand_over_leaving_shifts` (migration 20261202120000), over copies of the
  // tables so a raise changes nothing, as the transaction does.
  const handOver = (args: any) => {
    const saved = db.tables.shifts.map((r) => ({ ...r }));
    const fail = (message: string) => {
      db.tables.shifts.splice(0, db.tables.shifts.length, ...saved);
      return { data: null, error: { message } };
    };
    if (args.p_to === args.p_member_id) return fail("the person taking over is the person leaving");
    if (!db.tables.team_members.some((m) => m.id === args.p_to && m.restaurant_id === args.p_restaurant_id))
      return fail("not on this house's roster");
    const r: any = release(args);
    if (r.error) return fail(r.error.message);
    const rows = db.tables.shifts;
    const moved: any[] = [];
    for (const g of args.p_give) {
      const row = rows.find((x) => x.id === g.id);
      if (!row || row.member_id !== args.p_member_id || row.shift_date !== g.shift_date ||
          row.start_time !== g.start_time || row.state === "open" || row.state === "callout")
        return fail("not as it was read");
      Object.assign(row, { member_id: args.p_to, labor_cost: g.labor_cost });
      moved.push(row);
    }
    for (const g of args.p_give_rests) {
      const restId = r.data.rests.find((x: any) => x.id === g.id)?.rest_id;
      const from = rows.find((x) => x.id === g.id);
      const rest = rows.find((x) => x.id === restId);
      if (!rest || !from || rest.member_id !== null || rest.state !== "open") return fail("not cut now");
      Object.assign(rest, { member_id: args.p_to, state: from.state, shift_type: from.shift_type, labor_cost: g.labor_cost });
      moved.push(rest);
    }
    const allow = db.tables.team_settings?.find((t) => t.restaurant_id === args.p_restaurant_id)?.allow_double_booking === true;
    if (!(allow && args.p_accept_overlap)) {
      const span = (x: any) => {
        const m = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
        const at = Date.parse(`${x.shift_date}T00:00:00Z`) / 60_000 + m(x.start_time);
        return [at, at + ((m(x.end_time) - m(x.start_time) + 1440) % 1440)];
      };
      for (const a of moved)
        for (const b of rows)
          if (b.id !== a.id && b.member_id === args.p_to && b.state !== "open" && b.state !== "callout") {
            const [a0, a1] = span(a);
            const [b0, b1] = span(b);
            if (a0 < b1 && b0 < a1) return fail("overlaps");
          }
    }
    return { data: { ...r.data, given: args.p_give.length, given_rests: args.p_give_rests.length }, error: null };
  };
  function release(args: any): any {
    const rows = db.tables.shifts;
    const find = (id: string) => rows.find((r) => r.id === id);
    const theirs = (r: any) =>
      r && r.restaurant_id === args.p_restaurant_id && r.member_id === args.p_member_id &&
      r.state !== "open" && r.state !== "callout";
    const stale = { data: null, error: { message: "not as it was read" } };
    for (const o of args.p_open) {
      const r = find(o.id);
      if (!theirs(r) || r!.shift_date !== o.shift_date || r!.start_time !== o.start_time) return stale;
    }
    for (const x of args.p_split) {
      const r = find(x.id);
      if (!theirs(r) || r!.shift_date !== x.was.shift_date || r!.start_time !== x.was.start_time ||
          r!.end_time !== x.was.end_time) return stale;
      if (x.rest.start_time !== x.worked.end_time || x.rest.end_time !== x.was.end_time) return stale;
    }
    for (const o of args.p_open)
      Object.assign(find(o.id)!, { member_id: null, state: "open", shift_type: "open", labor_cost: null });
    const rests: any[] = [];
    for (const x of args.p_split) {
      const r = find(x.id)!;
      Object.assign(r, {
        end_time: x.worked.end_time,
        recorded_break_min: x.worked.recorded_break_min,
        labor_cost: x.worked.labor_cost,
      });
      const monday = (d: string) => {
        const t = Date.parse(`${d}T00:00:00Z`);
        const dow = (new Date(t).getUTCDay() + 6) % 7;
        return new Date(t - dow * 86_400_000).toISOString().slice(0, 10);
      };
      const schedule_id =
        monday(x.rest.shift_date) === monday(r.shift_date)
          ? r.schedule_id
          : (db.tables.schedules.find(
              (w) => w.restaurant_id === args.p_restaurant_id && w.week_start === monday(x.rest.shift_date),
            )?.id ?? null);
      const rest = {
        id: `rest-${++nextRest}`,
        restaurant_id: args.p_restaurant_id,
        schedule_id,
        member_id: null,
        shift_date: x.rest.shift_date,
        start_time: x.rest.start_time,
        end_time: x.rest.end_time,
        role: r.role ?? null,
        shift_type: "open",
        state: "open",
        note: r.note ?? null,
        labor_cost: null,
        recorded_break_min: x.rest.recorded_break_min,
        shift_breaks: [],
      };
      rows.push(rest);
      rests.push({ id: r.id, rest_id: rest.id });
    }
    return { data: { opened: args.p_open.length, split: args.p_split.length, rests }, error: null };
  }
  return db;
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
    // The WAGE read alone fails (it names `hourly_wage`, answered 42703 here);
    // the roster read before it (`id` only, ADR 0215 item 20) still answers,
    // so this holds the wage read's own refusal, not the roster read's.
    db.schema = { team_members: ["id", "restaurant_id"] };
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

  it("assumes a break at any length, once nothing is on record (founder 2026-09-22, round 6y)", () => {
    const at = (start_time: string, end_time: string, over: Record<string, any> = {}) => ({ start_time, end_time, ...over });
    // A 1-hour shift: round 2 built "no assumption at 4h or under"; round 6y
    // ("Yes, follow Art. 68 (Recommended)") assumes the 15-minute minimum here too.
    expect(breakCounted(at("09:00", "10:00"))).toEqual({ minutes: 15, assumed: true });
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

  it("the 4h00/4h01 and 7h30/7h31 boundaries (founder 2026-09-22, round 6y)", () => {
    const at = (start_time: string, end_time: string) => ({ start_time, end_time });
    // 4h00 exactly: the fork this round answers. Round 2 built 0/not-assumed
    // here (gated on "over 4 hours"); round 6y assumes 15, Art. 68(a).
    expect(breakCounted(at("09:00", "13:00"))).toEqual({ minutes: 15, assumed: true });
    // 4h01: already assumed under round 2 (just over the old gate); unchanged
    // by this round — a regression check that the low-end fix did not move it.
    expect(breakCounted(at("09:00", "13:01"))).toEqual({ minutes: 15, assumed: true });
    // 7h30 (7.5h span, Art. 68(b)'s own edge): 30 minutes.
    expect(breakCounted(at("09:00", "16:30"))).toEqual({ minutes: 30, assumed: true });
    // 7h31 span: still 30 — a 30-minute break here leaves 7h01m of work,
    // inside (b) (art68BreakForWork(421) === 30, pinned above). The span-level
    // step to 60 is at 8h00/8h01 (art68MinimumBreak(480)/(481), also pinned
    // above), not at 7h30/7h31: this test fixes that distinction, keyed on
    // work time (item 3, founder round 6y "On work time (Recommended)", as
    // built), not the span.
    expect(breakCounted(at("09:00", "16:31"))).toEqual({ minutes: 30, assumed: true });
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
    // `doubleBooking` (ADR 0215 item 27): the owner's alone, like the target.
    expect((await teamOf(db).getSettings(OWNER, RID)).mayChange).toEqual({ trackingOff: true, trackingOn: true, target: true, doubleBooking: true });
    expect((await teamOf(db).getSettings(MANAGER, RID)).mayChange).toEqual({ trackingOff: false, trackingOn: true, target: false, doubleBooking: false });
    expect((await teamOf(db).getSettings(STAFF, RID)).mayChange).toEqual({ trackingOff: false, trackingOn: false, target: false, doubleBooking: false });
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

describe("R1 — the retention job: credentials, shifts and leave, then wages, same clock", () => {
  const svcWith = (rpc: jest.Mock) =>
    new WageRecordRetentionService({ supabase: { rpc } } as any);

  // A stub keyed by RPC name, so the ordering assertions below are real:
  // calling the wrong name (or the right one twice) fails loudly rather than
  // silently reusing the other RPC's fixture.
  const rpcOf = (byName: Record<string, { data?: any; error?: any }>) =>
    jest.fn(async (name: string) =>
      Object.prototype.hasOwnProperty.call(byName, name)
        ? byName[name]
        : { data: null, error: { message: `unexpected rpc ${name}` } },
    );

  const CRED_OK = (creds = 0) => ({
    data: [{ credentials_deleted: creds }],
    error: null,
  });
  const SL_OK = (shifts = 0, leave = 0) => ({
    data: [{ shifts_deleted: shifts, leave_rows_deleted: leave }],
    error: null,
  });
  const WAGE_OK = (wage = 0, dep = 0) => ({
    data: [{ wage_rows_deleted: wage, departures_deleted: dep }],
    error: null,
  });

  it("calls the credential purge, the shifts-and-leave purge, then the wage purge, in that order, and reports all five counts (founder 2026-09-22 round 6y; credentials 2026-09-25 round 4)", async () => {
    const rpc = rpcOf({
      purge_expired_credential_records: CRED_OK(4),
      purge_expired_shift_and_leave_records: SL_OK(2, 1),
      purge_expired_wage_records: WAGE_OK(3, 1),
    });
    const run = await svcWith(rpc).purgeExpired();
    expect(rpc.mock.calls.map((c) => c[0])).toEqual([
      "purge_expired_credential_records",
      "purge_expired_shift_and_leave_records",
      "purge_expired_wage_records",
    ]);
    expect(run).toMatchObject({
      ok: true,
      credentialsDeleted: 4,
      shiftsDeleted: 2,
      leaveRowsDeleted: 1,
      wageRowsDeleted: 3,
      departuresDeleted: 1,
    });
  });

  it("does not call the wage purge at all when the shifts-and-leave purge fails", async () => {
    const rpc = rpcOf({
      purge_expired_credential_records: CRED_OK(),
      purge_expired_shift_and_leave_records: { data: null, error: { message: "boom" } },
    });
    const run = await svcWith(rpc).purgeExpired();
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(run).toMatchObject({
      ok: false,
      credentialsDeleted: null,
      shiftsDeleted: null,
      leaveRowsDeleted: null,
      wageRowsDeleted: null,
      departuresDeleted: null,
      error: "boom",
    });
  });

  it("reports a failed wage purge as failed, never as nothing due, after a successful shifts-and-leave purge", async () => {
    const rpc = rpcOf({
      purge_expired_credential_records: CRED_OK(),
      purge_expired_shift_and_leave_records: SL_OK(),
      purge_expired_wage_records: { data: null, error: { message: "boom" } },
    });
    const run = await svcWith(rpc).purgeExpired();
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(run).toMatchObject({ ok: false, wageRowsDeleted: null, departuresDeleted: null, error: "boom" });
  });

  it("reports the shifts-and-leave purge answering without its counts as failed, not as 0 deleted", async () => {
    const rpc = rpcOf({
      purge_expired_credential_records: CRED_OK(),
      purge_expired_shift_and_leave_records: { data: [{}], error: null },
    });
    const run = await svcWith(rpc).purgeExpired();
    expect(run.ok).toBe(false);
    expect(run.shiftsDeleted).toBeNull();
    expect(run.leaveRowsDeleted).toBeNull();
    expect(rpc).toHaveBeenCalledTimes(2); // never reaches the wage purge
  });

  it("reports the wage purge answering without its counts as failed, not as 0 deleted", async () => {
    const rpc = rpcOf({
      purge_expired_credential_records: CRED_OK(),
      purge_expired_shift_and_leave_records: SL_OK(),
      purge_expired_wage_records: { data: [{}], error: null },
    });
    const run = await svcWith(rpc).purgeExpired();
    expect(run.ok).toBe(false);
    expect(run.wageRowsDeleted).toBeNull();
  });

  it("calls nothing else when the credential purge fails, and reports every count as unknown (round 4)", async () => {
    const rpc = rpcOf({
      purge_expired_credential_records: { data: null, error: { message: "boom" } },
    });
    const run = await svcWith(rpc).purgeExpired();
    expect(rpc.mock.calls.map((c) => c[0])).toEqual(["purge_expired_credential_records"]);
    expect(run).toMatchObject({
      ok: false,
      credentialsDeleted: null,
      shiftsDeleted: null,
      leaveRowsDeleted: null,
      wageRowsDeleted: null,
      departuresDeleted: null,
      error: "boom",
    });
  });

  it("reads the credential purge answering without its count (or a null count) as failed, not 0 deleted", async () => {
    for (const data of [[{}], [{ credentials_deleted: null }]]) {
      const rpc = rpcOf({ purge_expired_credential_records: { data, error: null } });
      const run = await svcWith(rpc).purgeExpired();
      expect(run).toMatchObject({ ok: false, credentialsDeleted: null });
      expect(rpc).toHaveBeenCalledTimes(1);
    }
  });

  it("reports a thrown call as failed", async () => {
    const rpc = jest.fn(async () => {
      throw new Error("network");
    });
    const run = await svcWith(rpc).purgeExpired();
    expect(run).toMatchObject({ ok: false, error: "network" });
  });

  it("reads null counts as no answer, not as 0 deleted — both purges", async () => {
    // Number(null) is 0: without the guard this run would report "0 deleted".
    const rpcSL = rpcOf({
      purge_expired_credential_records: CRED_OK(),
      purge_expired_shift_and_leave_records: {
        data: [{ shifts_deleted: null, leave_rows_deleted: null }],
        error: null,
      },
    });
    const runSL = await svcWith(rpcSL).purgeExpired();
    expect(runSL).toMatchObject({ ok: false, shiftsDeleted: null, leaveRowsDeleted: null });

    const rpcWage = rpcOf({
      purge_expired_credential_records: CRED_OK(),
      purge_expired_shift_and_leave_records: SL_OK(),
      purge_expired_wage_records: {
        data: [{ wage_rows_deleted: null, departures_deleted: null }],
        error: null,
      },
    });
    const runWage = await svcWith(rpcWage).purgeExpired();
    expect(runWage).toMatchObject({ ok: false, wageRowsDeleted: null, departuresDeleted: null });
  });

  it("is scheduled nightly, and the scheduled run is credentials, shifts-and-leave, then wages, in order", async () => {
    const opts = Reflect.getMetadata(
      "SCHEDULE_CRON_OPTIONS",
      WageRecordRetentionService.prototype.scheduled,
    );
    expect(opts?.cronTime).toBe(WAGE_RETENTION_CRON);
    expect(WAGE_RETENTION_CRON).toBe("23 3 * * *");
    const rpc = rpcOf({
      purge_expired_credential_records: CRED_OK(),
      purge_expired_shift_and_leave_records: SL_OK(),
      purge_expired_wage_records: WAGE_OK(),
    });
    await svcWith(rpc).scheduled();
    expect(rpc.mock.calls.map((c) => c[0])).toEqual([
      "purge_expired_credential_records",
      "purge_expired_shift_and_leave_records",
      "purge_expired_wage_records",
    ]);
  });
});

// ── K1: a removed person's kept rows are kept, not part of the working week ──
//
// ADR 0215 item 20 (founder 2026-09-22, round 6y, "Keep them 5 years
// (Recommended)"): a removal no longer deletes a person's shifts and leave.
// The database keeps them (migration 20261201110200, PGlite probe); the
// gateway reads the week as it did before the removal stopped deleting them.
// "m-gone" is a person removed from the roster whose rows were kept.

describe("K1 — a removed person's kept shifts and leave are kept, not part of the week", () => {
  const GONE = "m-gone";

  it("leaves them out of the week's shifts, hours, cost and coverage, and keeps the rows", async () => {
    const db = seed();
    db.tables.coverage_templates.push({
      id: "ct1", restaurant_id: RID, day_of_week: null, role: "line", shift_period: "am", min_staff: 2,
    });
    db.tables.shifts.push(
      shift({ id: "live", member_id: "m-staff", role: "line", labor_cost: 150 }),
      shift({ id: "kept", member_id: GONE, role: "line", labor_cost: 150 }),
      // An open shift names nobody and is still part of the week.
      shift({ id: "open", member_id: null, role: "line", state: "open", shift_type: "open" }),
    );
    for (const who of [MANAGER, OWNER]) {
      const week = await scheduleOf(db).getWeek(who, RID, WEEK);
      expect(week.shifts.map((s: any) => s.id)).toEqual(["live", "open"]);
      expect(week.coverage.days.find((d: any) => d.date === WEEK).openShifts).toBe(1);
      // 7.5 worked on the live shift + 7.5 planned on the open one; the kept
      // shift's 7.5 is not in the week.
      expect(week.labor.totalHours).toBe(15);
      const day = week.coverage.days.find((d: any) => d.date === WEEK);
      // Nobody on the roster covers the second "line" slot: a gap, as it was
      // before a removal stopped deleting the removed person's shift.
      expect(day.staffed).toBe(1);
      expect(day.gaps).toEqual([{ role: "line", period: "am", staffed: 1, required: 2 }]);
      if (who === OWNER) {
        expect(week.labor.totalCost).toBe(150);
        expect(week.labor.pricedShifts).toBe(1);
      }
    }
    // Kept: reading the week deleted nothing.
    expect(db.tables.shifts.map((s) => s.id).sort()).toEqual(["kept", "live", "open"]);
    expect(db.opsOn("shifts", "delete")).toHaveLength(0);
  });

  it("does not count their approved paid leave in the owner's week", async () => {
    const db = seed();
    db.tables.time_off_requests.push(
      { id: "t-live", restaurant_id: RID, member_id: "m-staff", start_date: WEEK, end_date: WEEK, status: "approved", leave_type: "paid" },
      { id: "t-kept", restaurant_id: RID, member_id: GONE, start_date: WEEK, end_date: WEEK, status: "approved", leave_type: "paid" },
    );
    const week = await scheduleOf(db).getWeek(OWNER, RID, WEEK);
    expect(week.labor.leave).toEqual({
      readable: true,
      paid: [{ memberId: "m-staff", days: 1 }],
      paidDays: 1,
      unknownTypeDays: 0,
    });
  });

  it("does not list their leave requests to a manager, and keeps them", async () => {
    const db = seed();
    db.tables.time_off_requests.push(
      { id: "t-live", restaurant_id: RID, member_id: "m-staff", start_date: WEEK, end_date: WEEK, status: "pending", created_at: "2026-09-01" },
      { id: "t-kept", restaurant_id: RID, member_id: GONE, start_date: WEEK, end_date: WEEK, status: "pending", created_at: "2026-09-02" },
    );
    const asManager = await teamOf(db).listTimeOff(MANAGER, RID);
    expect(asManager.map((t: any) => t.id)).toEqual(["t-live"]);
    const asStaff = await teamOf(db).listTimeOff(STAFF, RID);
    expect(asStaff.map((t: any) => t.id)).toEqual(["t-live"]);
    expect(db.tables.time_off_requests).toHaveLength(2);
  });

  it("never copies them into a new week, and replacing a week does not delete them", async () => {
    const db = seed();
    const FROM = "2026-08-31";
    db.tables.schedules.push({ id: "s-from", restaurant_id: RID, week_start: FROM, status: "published" });
    db.tables.shifts.push(
      shift({ id: "src-live", schedule_id: "s-from", shift_date: FROM, member_id: "m-staff", labor_cost: 150 }),
      shift({ id: "src-kept", schedule_id: "s-from", shift_date: FROM, member_id: GONE, labor_cost: 150 }),
      // Already in the target week: the removed person's kept shift.
      shift({ id: "tgt-kept", member_id: GONE, labor_cost: 150 }),
    );
    // The kept shift is not "in the way": no 409 without the flag.
    const res: any = await scheduleOf(db).copyWeek(MANAGER, RID, { fromWeekStart: FROM, toWeekStart: WEEK } as any);
    expect(res).toMatchObject({ copied: 1, deleted: 0 });
    const inWeek = db.tables.shifts.filter((s) => s.shift_date === WEEK);
    expect(inWeek.filter((s) => s.member_id === GONE).map((s) => s.id)).toEqual(["tgt-kept"]);
    expect(inWeek.filter((s) => s.member_id === "m-staff")).toHaveLength(1);

    // Replacing the week deletes the live copy it made, never the kept shift.
    const again: any = await scheduleOf(db).copyWeek(MANAGER, RID, {
      fromWeekStart: FROM,
      toWeekStart: WEEK,
      replaceTarget: true,
    } as any);
    expect(again).toMatchObject({ copied: 1, deleted: 1 });
    expect(db.tables.shifts.some((s) => s.id === "tgt-kept")).toBe(true);
    expect(db.tables.shifts.some((s) => s.id === "src-kept")).toBe(true);
  });

  it("refuses the week when the roster cannot be read, rather than hiding every shift", async () => {
    const db = seed();
    db.tables.shifts.push(shift({ id: "live", member_id: "m-staff" }));
    db.errors["team_members:select"] = { message: "boom" };
    await expect(scheduleOf(db).getWeek(OWNER, RID, WEEK)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    await expect(
      scheduleOf(db).copyWeek(MANAGER, RID, { fromWeekStart: WEEK, toWeekStart: "2026-09-14" } as any),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    await expect(teamOf(db).listTimeOff(MANAGER, RID)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });
});

// ── K2: a removal sends the person's unstarted shifts back to the open pool ──
//
// ADR 0215 item 26, founder item 93 (2026-09-28): "back to the open pool
// absolutely". Carried from the preserved wt-labor snapshot 4d299b231's K2,
// re-cut to main's `deleteMember`: "not started" is read on the house's clock
// (not the UTC calendar day), a call-out stays (its cover is already open),
// every failed read refuses, and the open runs before the first membership
// write. K1 (above) is the read side: what stays theirs stays hidden.

describe("K2 — deleteMember sends a removed person's unstarted shifts back to the open pool", () => {
  const GONE = "m-gone";
  const OTHER = "m-other";

  afterEach(() => {
    jest.useRealTimers();
  });

  function at(iso: string) {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] }).setSystemTime(new Date(iso));
  }

  function seedGone(db: StubDb, zone: string | null = "Europe/Istanbul") {
    db.tables.restaurants = [{ id: RID, timezone: zone, country: null }];
    db.tables.team_members.push({
      id: GONE,
      restaurant_id: RID,
      user_id: null,
      display_name: "Gone",
      hourly_wage: 25,
    });
  }

  it("opens every shift not yet started on the house's clock; the past, a call-out and others' stay", async () => {
    // 12:00 UTC = 15:00 in Istanbul.
    at("2026-09-22T12:00:00Z");
    const db = seed();
    seedGone(db);
    db.tables.shifts.push(
      shift({ id: "past", member_id: GONE, shift_date: "2026-09-01", labor_cost: 150 }),
      shift({ id: "today-started", member_id: GONE, shift_date: "2026-09-22", start_time: "09:00", labor_cost: 150 }),
      shift({ id: "today-later", member_id: GONE, shift_date: "2026-09-22", start_time: "18:00", labor_cost: 90 }),
      shift({ id: "future-scheduled", member_id: GONE, shift_date: "2026-10-05", labor_cost: 150 }),
      shift({ id: "future-covered", member_id: GONE, shift_date: "2026-10-06", state: "covered", labor_cost: 140 }),
      shift({ id: "future-callout", member_id: GONE, shift_date: "2026-10-07", state: "callout", labor_cost: 150 }),
      shift({ id: "other-future", member_id: OTHER, shift_date: "2026-10-05", labor_cost: 100 }),
    );

    const receipt: any = await teamOf(db).deleteMember(MANAGER, RID, GONE);
    expect(receipt.shiftsOpened).toBe(3);

    const byId = new Map(db.tables.shifts.map((s) => [s.id, s]));
    for (const id of ["today-later", "future-scheduled", "future-covered"]) {
      expect(byId.get(id)).toMatchObject({
        member_id: null,
        state: "open",
        shift_type: "open",
        labor_cost: null,
      });
    }
    expect(byId.get("past")).toMatchObject({ member_id: GONE, state: "scheduled", labor_cost: 150 });
    // In progress at 15:00 (09:00-17:00): cut there, not kept whole (K3).
    expect(byId.get("today-started")).toMatchObject({ member_id: GONE, state: "scheduled", end_time: "15:00" });
    expect(receipt.shiftsSplit).toBe(1);
    expect(byId.get("future-callout")).toMatchObject({ member_id: GONE, state: "callout", labor_cost: 150 });
    expect(byId.get("other-future")).toMatchObject({ member_id: OTHER, labor_cost: 100 });
    expect(db.tables.system_audit_log[0]?.changes?.shifts_opened).toBe(3);
    expect(db.tables.team_members.some((m) => m.id === GONE)).toBe(false);
  });

  it("reads 'today' on the house's zone, not UTC: after local midnight, a shift that already started stays", async () => {
    // 22:30 UTC on the 22nd = 01:30 on the 23rd in Istanbul.
    at("2026-09-22T22:30:00Z");
    const db = seed();
    seedGone(db);
    db.tables.shifts.push(
      shift({ id: "started-local", member_id: GONE, shift_date: "2026-09-23", start_time: "00:30" }),
      shift({ id: "later-local", member_id: GONE, shift_date: "2026-09-23", start_time: "09:00" }),
    );
    const receipt: any = await teamOf(db).deleteMember(MANAGER, RID, GONE);
    expect(receipt.shiftsOpened).toBe(1);
    const byId = new Map(db.tables.shifts.map((s) => [s.id, s]));
    expect(byId.get("started-local")).toMatchObject({ member_id: GONE, state: "scheduled" });
    expect(byId.get("later-local")).toMatchObject({ member_id: null, state: "open" });
  });

  it("with no zone known, opens only what has not started in any zone (the clock at UTC+14)", async () => {
    // 12:00 UTC on the 22nd = 02:00 on the 23rd at UTC+14.
    at("2026-09-22T12:00:00Z");
    const db = seed();
    seedGone(db, null);
    db.tables.shifts.push(
      shift({ id: "maybe-started", member_id: GONE, shift_date: "2026-09-22", start_time: "18:00" }),
      shift({ id: "surely-later", member_id: GONE, shift_date: "2026-09-23", start_time: "09:00" }),
    );
    const receipt: any = await teamOf(db).deleteMember(MANAGER, RID, GONE);
    expect(receipt.shiftsOpened).toBe(1);
    expect(receipt).toMatchObject({ shiftsSplit: 0, shiftsUnjudged: 1, clock: { zone: null, source: "none" } });
    const byId = new Map(db.tables.shifts.map((s) => [s.id, s]));
    expect(byId.get("maybe-started")).toMatchObject({ member_id: GONE, end_time: "17:00" });
    expect(byId.get("surely-later")).toMatchObject({ member_id: null, state: "open" });
  });

  it("opens nothing, and reports 0, for a person with no upcoming shifts", async () => {
    at("2026-09-22T12:00:00Z");
    const db = seed();
    seedGone(db);
    db.tables.shifts.push(shift({ id: "past", member_id: GONE, shift_date: "2026-09-01" }));
    const receipt: any = await teamOf(db).deleteMember(MANAGER, RID, GONE);
    expect(receipt.shiftsOpened).toBe(0);
    expect(db.opsOn("shifts", "update")).toHaveLength(0);
    expect(db.opsOn("rpc:release_leaving_shifts")).toHaveLength(0);
    expect(db.tables.shifts[0]).toMatchObject({ member_id: GONE });
  });

  it.each([
    ["restaurants:select", "the house's clock cannot be read"],
    ["shifts:select", "their shifts cannot be read"],
    ["rpc:release_leaving_shifts", "the open fails"],
  ])("refuses, removing nobody, when %s fails (%s)", async (key) => {
    at("2026-09-22T12:00:00Z");
    const db = seed();
    seedGone(db);
    db.tables.shifts.push(shift({ id: "future", member_id: GONE, shift_date: "2026-10-05" }));
    db.errors[key] = { message: "boom" };
    await expect(teamOf(db).deleteMember(MANAGER, RID, GONE)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(db.tables.team_members.some((m) => m.id === GONE)).toBe(true);
    expect(db.tables.shifts[0]).toMatchObject({ member_id: GONE, state: "scheduled" });
    expect(db.tables.system_audit_log).toHaveLength(0);
  });

  it("for a person with an account, opens before the first membership write: a failed open leaves their access", async () => {
    at("2026-09-22T12:00:00Z");
    const db = seed();
    db.tables.restaurants = [{ id: RID, timezone: "Europe/Istanbul", country: null }];
    db.tables.shifts.push(shift({ id: "sam-future", member_id: "m-staff", shift_date: "2026-10-05" }));
    db.errors["rpc:release_leaving_shifts"] = { message: "boom" };
    await expect(teamOf(db).deleteMember(MANAGER, RID, "m-staff")).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(db.tables.user_restaurant_access.some((a) => a.user_id === STAFF)).toBe(true);
    expect(db.tables.users.find((u) => u.user_id === STAFF)).toMatchObject({ restaurant_id: RID });
    expect(db.tables.team_members.some((m) => m.id === "m-staff")).toBe(true);
  });

  it("for a person with an account, a removal that goes through opens their upcoming shift", async () => {
    at("2026-09-22T12:00:00Z");
    const db = seed();
    db.tables.restaurants = [{ id: RID, timezone: "Europe/Istanbul", country: null }];
    db.tables.shifts.push(shift({ id: "sam-future", member_id: "m-staff", shift_date: "2026-10-05" }));
    const receipt: any = await teamOf(db).deleteMember(MANAGER, RID, "m-staff");
    expect(receipt).toMatchObject({ removed: true, accessRevoked: true, shiftsOpened: 1 });
    expect(db.tables.shifts[0]).toMatchObject({ member_id: null, state: "open" });
  });

  it("still refuses a manager removing an owner before any shift is opened", async () => {
    at("2026-09-22T12:00:00Z");
    const db = seed();
    db.tables.restaurants = [{ id: RID, timezone: "Europe/Istanbul", country: null }];
    db.tables.shifts.push(shift({ id: "boss-future", member_id: "m-owner", shift_date: "2026-10-05" }));
    await expect(teamOf(db).deleteMember(MANAGER, RID, "m-owner")).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(db.tables.shifts[0]).toMatchObject({ member_id: "m-owner", state: "scheduled" });
    expect(db.opsOn("shifts", "update")).toHaveLength(0);
    expect(db.opsOn("rpc:release_leaving_shifts")).toHaveLength(0);
  });
});

// ── K3: a removal mid-shift splits the shift, and every figure follows ───────
//
// The founder, 2026-09-28, verbatim: "handle it sota, it also has to take care
// of yhat exact edge case where it opens midahift then everything changes
// accordingly". ADR 0215 item 26's 2026-09-28 bracket. A shift in progress at
// the removal is cut at the removal minute on the house's clock: the worked
// part stays the person's, its end, break and cost recomputed; the rest is a
// new open shift. The clock is the house's zone, else its country's only
// zone, else the remover's device zone, else none — and with none, a shift
// that may have started is kept whole and named, never cut on a guess.

describe("K3 — a removal mid-shift splits the shift at the removal minute", () => {
  const GONE = "m-gone";

  afterEach(() => {
    jest.useRealTimers();
  });

  function at(iso: string) {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] }).setSystemTime(new Date(iso));
  }

  function seedGone(zone: string | null = "Europe/Istanbul", country: string | null = null) {
    const db = seed();
    db.tables.restaurants = [{ id: RID, timezone: zone, country }];
    db.tables.team_members.push({
      id: GONE,
      restaurant_id: RID,
      user_id: null,
      display_name: "Gone",
      hourly_wage: 25,
    });
    return db;
  }

  const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const span = (a: string, b: string) => (minutes(b) - minutes(a) + 1440) % 1440;
  const restOf = (db: StubDb) => db.tables.shifts.filter((r) => String(r.id).startsWith("rest-"));

  it("cuts a shift in progress: the worked part stays theirs, re-priced; the rest is a new open shift", async () => {
    // 10:00 UTC = 13:00 in Istanbul, four hours into 09:00-17:00.
    at("2026-09-22T10:00:00Z");
    const db = seedGone();
    db.tables.shifts.push(
      shift({ id: "live", member_id: GONE, shift_date: "2026-09-22", role: "Server", note: "Patio", labor_cost: 187.5 }),
    );
    const receipt: any = await teamOf(db).deleteMember(MANAGER, RID, GONE);
    expect(receipt).toMatchObject({
      shiftsOpened: 0,
      shiftsSplit: 1,
      shiftsUnjudged: 0,
      clock: { zone: "Europe/Istanbul", source: "house" },
    });

    const worked = db.tables.shifts.find((r) => r.id === "live")!;
    // 4 hours, the Art. 68 minimum for 4 hours (15 min) assumed: 3.75 h x 25.
    expect(worked).toMatchObject({
      member_id: GONE,
      state: "scheduled",
      start_time: "09:00",
      end_time: "13:00",
      recorded_break_min: null,
      labor_cost: 93.75,
    });
    const [rest] = restOf(db);
    expect(rest).toMatchObject({
      member_id: null,
      state: "open",
      shift_type: "open",
      shift_date: "2026-09-22",
      start_time: "13:00",
      end_time: "17:00",
      role: "Server",
      note: "Patio",
      labor_cost: null,
      schedule_id: "s1",
    });

    // Everything follows: the two spans add up to the shift; the stored cost
    // is what the hour rules give the stored row; the audit names the cut.
    expect(span(worked.start_time, worked.end_time) + span(rest.start_time, rest.end_time)).toBe(8 * 60);
    expect(worked.labor_cost).toBe(priceShift(25, worked as any));
    expect(workedHours(worked as any)).toBe(3.75);
    expect(db.tables.system_audit_log[0]?.changes).toMatchObject({
      shifts_opened: 0,
      shifts_split: [{ id: "live", cut: "13:00", rest_id: rest.id, was_end: "17:00", was_break_min: null }],
      shifts_unjudged: [],
      shifts_clock: { zone: "Europe/Istanbul", source: "house" },
    });
    // The receipt carries no money: a manager removed them.
    expect(JSON.stringify(receipt)).not.toMatch(/labor_cost|hourly_wage|93\.75/);
  });

  it("the week then shows the rest as open, and the worked part only in the former-staff rows", async () => {
    at("2026-09-22T10:00:00Z");
    const db = seedGone();
    db.tables.schedules.push({ id: "s2", restaurant_id: RID, week_start: "2026-09-21", status: "draft" });
    db.tables.shifts.push(shift({ id: "live", schedule_id: "s2", member_id: GONE, shift_date: "2026-09-22" }));
    await teamOf(db).deleteMember(MANAGER, RID, GONE);
    const week = await scheduleOf(db).getWeek(OWNER, RID, "2026-09-21");
    const ids = week.shifts.map((s: any) => s.id);
    expect(ids).not.toContain("live");
    const open = week.shifts.find((s: any) => s.member_id == null);
    expect(open).toMatchObject({ start_time: "13:00", end_time: "17:00", state: "open", labor_cost: null });
  });

  it("an overnight shift cut after midnight: the read reaches yesterday, and the rest lands on today", async () => {
    // 22:30 UTC on the 22nd = 01:30 on the 23rd in Istanbul; the shift began at 22:00 on the 22nd.
    at("2026-09-22T22:30:00Z");
    const db = seedGone();
    db.tables.shifts.push(
      shift({ id: "night", member_id: GONE, shift_date: "2026-09-22", start_time: "22:00", end_time: "04:00" }),
    );
    const receipt: any = await teamOf(db).deleteMember(MANAGER, RID, GONE);
    expect(receipt.shiftsSplit).toBe(1);
    const worked = db.tables.shifts.find((r) => r.id === "night")!;
    expect(worked).toMatchObject({ shift_date: "2026-09-22", start_time: "22:00", end_time: "01:30" });
    // 3.5 h with a 15-minute assumed break: 3.25 h x 25.
    expect(worked.labor_cost).toBe(81.25);
    const [rest] = restOf(db);
    expect(rest).toMatchObject({ shift_date: "2026-09-23", start_time: "01:30", end_time: "04:00", member_id: null });
  });

  it("an overnight Sunday shift cut after midnight puts the rest in Monday's week", async () => {
    // 2026-09-27 is a Sunday; 23:00 UTC = 02:00 Monday the 28th in Istanbul.
    at("2026-09-27T23:00:00Z");
    const db = seedGone();
    db.tables.schedules.push({ id: "s-next", restaurant_id: RID, week_start: "2026-09-28", status: "draft" });
    db.tables.shifts.push(
      shift({ id: "sun", member_id: GONE, shift_date: "2026-09-27", start_time: "22:00", end_time: "04:00" }),
    );
    await teamOf(db).deleteMember(MANAGER, RID, GONE);
    expect(restOf(db)[0]).toMatchObject({ shift_date: "2026-09-28", start_time: "02:00", schedule_id: "s-next" });
  });

  it.each([
    // [label, instant, zone, shift, worked end, rest date, rest start]
    ["fall back (New York, 2026-11-01)", "2026-11-01T10:00:00Z", "America/New_York", ["2026-10-31", "22:00", "06:00"], "05:00", "2026-11-01", "05:00"],
    ["spring forward (New York, 2026-03-08)", "2026-03-08T07:30:00Z", "America/New_York", ["2026-03-07", "23:00", "07:00"], "03:30", "2026-03-08", "03:30"],
  ])("across DST — %s — the cut is the house's wall clock and the spans still add up", async (_l, instant, zone, [d, a, b], cut, restDay, restStart) => {
    at(instant as string);
    const db = seedGone(zone as string);
    db.tables.shifts.push(shift({ id: "dst", member_id: GONE, shift_date: d, start_time: a, end_time: b }));
    await teamOf(db).deleteMember(MANAGER, RID, GONE);
    const worked = db.tables.shifts.find((r) => r.id === "dst")!;
    const [rest] = restOf(db);
    expect(worked.end_time).toBe(cut);
    expect(rest).toMatchObject({ shift_date: restDay, start_time: restStart, end_time: b });
    expect(span(worked.start_time, worked.end_time) + span(rest.start_time, rest.end_time)).toBe(span(a as string, b as string));
  });

  it("a recorded break says how long, not when: each part is counted with its own Art. 68 minimum, shown as assumed", async () => {
    // 15:00 UTC = 18:00 in Istanbul, nine hours into 09:00-19:00 with 60 recorded.
    at("2026-09-22T15:00:00Z");
    const db = seedGone();
    db.tables.shifts.push(
      shift({ id: "long", member_id: GONE, shift_date: "2026-09-22", end_time: "19:00", recorded_break_min: 60 }),
    );
    await teamOf(db).deleteMember(MANAGER, RID, GONE);
    const worked = db.tables.shifts.find((r) => r.id === "long")!;
    // 9 h, assumed 60 (Art. 68 over 7.5 h of work): 8 h x 25.
    expect(worked).toMatchObject({ end_time: "18:00", recorded_break_min: null, labor_cost: 200 });
    expect(breakCounted(worked as any)).toEqual({ minutes: 60, assumed: true });
    // The one hour left: a 15-minute minimum fits in it, so it is assumed.
    expect(restOf(db)[0]).toMatchObject({ start_time: "18:00", end_time: "19:00", recorded_break_min: null });
    // The record keeps what the cut replaced.
    expect(db.tables.system_audit_log[0]?.changes?.shifts_split?.[0]).toMatchObject({
      was_end: "19:00",
      was_break_min: 60,
    });
  });

  it("a recorded 'no break taken' stays no break in both parts", async () => {
    at("2026-09-22T10:00:00Z");
    const db = seedGone();
    db.tables.shifts.push(shift({ id: "nobreak", member_id: GONE, shift_date: "2026-09-22", recorded_break_min: 0 }));
    await teamOf(db).deleteMember(MANAGER, RID, GONE);
    expect(db.tables.shifts.find((r) => r.id === "nobreak")).toMatchObject({ recorded_break_min: 0, labor_cost: 100 });
    expect(restOf(db)[0]).toMatchObject({ recorded_break_min: 0 });
  });

  it("a planned break on the clock goes to the part it falls in", async () => {
    // 11:00 UTC = 14:00 Istanbul; the planned 30-minute break was at 12:00.
    at("2026-09-22T11:00:00Z");
    const db = seedGone();
    db.tables.shifts.push(
      shift({
        id: "planned",
        member_id: GONE,
        shift_date: "2026-09-22",
        shift_breaks: [{ start_time: "12:00", duration_min: 30 }],
      }),
    );
    await teamOf(db).deleteMember(MANAGER, RID, GONE);
    // 5 h less the 30 taken: 4.5 h x 25; recorded, so the row is not counted whole.
    expect(db.tables.shifts.find((r) => r.id === "planned")).toMatchObject({
      end_time: "14:00",
      recorded_break_min: 30,
      labor_cost: 112.5,
    });
    expect(restOf(db)[0]).toMatchObject({ start_time: "14:00", recorded_break_min: null });
  });

  it("a planned break after the cut is not taken in the worked part; the rest carries it", async () => {
    // 08:00 UTC = 11:00 Istanbul; the planned break is at 12:00.
    at("2026-09-22T08:00:00Z");
    const db = seedGone();
    db.tables.shifts.push(
      shift({ id: "later", member_id: GONE, shift_date: "2026-09-22", shift_breaks: [{ start_time: "12:00", duration_min: 30 }] }),
    );
    await teamOf(db).deleteMember(MANAGER, RID, GONE);
    expect(db.tables.shifts.find((r) => r.id === "later")).toMatchObject({ recorded_break_min: 0, labor_cost: 50 });
    expect(restOf(db)[0]).toMatchObject({ start_time: "11:00", recorded_break_min: 30 });
  });

  it("on an overnight shift, a planned break after midnight is placed after midnight", async () => {
    // 23:00 UTC = 02:00 Istanbul; 20:00-04:00 with a 30-minute break planned at 01:00.
    at("2026-09-22T23:00:00Z");
    const db = seedGone();
    db.tables.shifts.push(
      shift({
        id: "late-break",
        member_id: GONE,
        shift_date: "2026-09-22",
        start_time: "20:00",
        end_time: "04:00",
        shift_breaks: [{ start_time: "01:00", duration_min: 30 }],
      }),
    );
    await teamOf(db).deleteMember(MANAGER, RID, GONE);
    // 6 h less the 30 taken at 01:00: 5.5 h x 25.
    expect(db.tables.shifts.find((r) => r.id === "late-break")).toMatchObject({
      end_time: "02:00",
      recorded_break_min: 30,
      labor_cost: 137.5,
    });
  });

  it("a planned break whose start does not parse is read as not taken, never lowering the worked pay", async () => {
    at("2026-09-22T10:00:00Z");
    const db = seedGone();
    db.tables.shifts.push(
      shift({ id: "odd", member_id: GONE, shift_date: "2026-09-22", shift_breaks: [{ start_time: "noon", duration_min: 30 }] }),
    );
    await teamOf(db).deleteMember(MANAGER, RID, GONE);
    expect(db.tables.shifts.find((r) => r.id === "odd")).toMatchObject({ recorded_break_min: 0, labor_cost: 100 });
    expect(restOf(db)[0]).toMatchObject({ recorded_break_min: 30 });
  });

  it("a stint too short to hold the minimum break had none: ten minutes are paid as ten minutes", async () => {
    // 06:10 UTC = 09:10 Istanbul, ten minutes into the shift.
    at("2026-09-22T06:10:00Z");
    const db = seedGone();
    db.tables.shifts.push(shift({ id: "brief", member_id: GONE, shift_date: "2026-09-22" }));
    await teamOf(db).deleteMember(MANAGER, RID, GONE);
    const worked = db.tables.shifts.find((r) => r.id === "brief")!;
    expect(worked).toMatchObject({ end_time: "09:10", recorded_break_min: 0, labor_cost: 4.17 });
    expect(restOf(db)[0]).toMatchObject({ start_time: "09:10", end_time: "17:00" });
  });

  it("at the very start minute the shift opens whole; at the very end minute it is kept whole", async () => {
    at("2026-09-22T06:00:00Z"); // 09:00 Istanbul
    const db = seedGone();
    db.tables.shifts.push(
      shift({ id: "now-starts", member_id: GONE, shift_date: "2026-09-22", start_time: "09:00", end_time: "17:00" }),
      shift({ id: "now-ends", member_id: GONE, shift_date: "2026-09-22", start_time: "01:00", end_time: "09:00" }),
    );
    const receipt: any = await teamOf(db).deleteMember(MANAGER, RID, GONE);
    expect(receipt).toMatchObject({ shiftsOpened: 1, shiftsSplit: 0 });
    expect(db.tables.shifts.find((r) => r.id === "now-starts")).toMatchObject({ member_id: null, state: "open", end_time: "17:00" });
    expect(db.tables.shifts.find((r) => r.id === "now-ends")).toMatchObject({ member_id: GONE, end_time: "09:00" });
    expect(restOf(db)).toHaveLength(0);
  });

  it("a call-out or an open row in progress is left alone", async () => {
    at("2026-09-22T10:00:00Z");
    const db = seedGone();
    db.tables.shifts.push(shift({ id: "co", member_id: GONE, shift_date: "2026-09-22", state: "callout" }));
    const receipt: any = await teamOf(db).deleteMember(MANAGER, RID, GONE);
    expect(receipt.shiftsSplit).toBe(0);
    expect(db.tables.shifts.find((r) => r.id === "co")).toMatchObject({ end_time: "17:00", state: "callout" });
  });

  it("with no zone on the house, the country's only zone decides", async () => {
    at("2026-09-22T10:00:00Z");
    const db = seedGone(null, "TR");
    db.tables.shifts.push(shift({ id: "tr", member_id: GONE, shift_date: "2026-09-22" }));
    const receipt: any = await teamOf(db).deleteMember(MANAGER, RID, GONE);
    expect(receipt.clock).toEqual({ zone: "Europe/Istanbul", source: "country" });
    expect(db.tables.shifts.find((r) => r.id === "tr")).toMatchObject({ end_time: "13:00" });
  });

  it("with none recorded, the remover's device zone decides, and the receipt says so", async () => {
    at("2026-09-22T10:00:00Z");
    const db = seedGone(null);
    db.tables.shifts.push(shift({ id: "dev", member_id: GONE, shift_date: "2026-09-22" }));
    const receipt: any = await teamOf(db).deleteMember(MANAGER, RID, GONE, "Europe/Istanbul");
    expect(receipt).toMatchObject({ shiftsSplit: 1, clock: { zone: "Europe/Istanbul", source: "device" } });
    expect(db.tables.shifts.find((r) => r.id === "dev")).toMatchObject({ end_time: "13:00" });
  });

  it("the house's own zone wins over the device's", async () => {
    at("2026-09-22T10:00:00Z");
    const db = seedGone("Europe/Istanbul");
    db.tables.shifts.push(shift({ id: "own", member_id: GONE, shift_date: "2026-09-22" }));
    const receipt: any = await teamOf(db).deleteMember(MANAGER, RID, GONE, "America/New_York");
    expect(receipt.clock).toEqual({ zone: "Europe/Istanbul", source: "house" });
    expect(db.tables.shifts.find((r) => r.id === "own")).toMatchObject({ end_time: "13:00" });
  });

  it.each([["+05:00"], ["Not/AZone"], [""]])(
    "a device zone that is not an IANA zone (%p) is no clock: a maybe-started shift is kept whole and named",
    async (device) => {
      at("2026-09-22T10:00:00Z");
      const db = seedGone(null);
      db.tables.shifts.push(shift({ id: "maybe", member_id: GONE, shift_date: "2026-09-22" }));
      const receipt: any = await teamOf(db).deleteMember(MANAGER, RID, GONE, device);
      expect(receipt).toMatchObject({ shiftsSplit: 0, shiftsUnjudged: 1, clock: { zone: null, source: "none" } });
      expect(db.tables.shifts.find((r) => r.id === "maybe")).toMatchObject({ member_id: GONE, end_time: "17:00" });
      expect(restOf(db)).toHaveLength(0);
      expect(db.tables.system_audit_log[0]?.changes?.shifts_unjudged).toEqual(["maybe"]);
    },
  );

  it("a failed split write refuses the whole removal: nothing opened, nothing cut, nobody removed", async () => {
    at("2026-09-22T10:00:00Z");
    const db = seedGone();
    db.tables.shifts.push(
      shift({ id: "live", member_id: GONE, shift_date: "2026-09-22", labor_cost: 187.5 }),
      shift({ id: "next", member_id: GONE, shift_date: "2026-10-05" }),
    );
    db.errors["rpc:release_leaving_shifts"] = { message: "boom" };
    await expect(teamOf(db).deleteMember(MANAGER, RID, GONE)).rejects.toThrow(/nobody was removed/);
    expect(db.tables.shifts.find((r) => r.id === "live")).toMatchObject({ member_id: GONE, end_time: "17:00", labor_cost: 187.5 });
    expect(db.tables.shifts.find((r) => r.id === "next")).toMatchObject({ member_id: GONE, state: "scheduled" });
    expect(restOf(db)).toHaveLength(0);
    expect(db.tables.team_members.some((m) => m.id === GONE)).toBe(true);
    expect(db.tables.system_audit_log).toHaveLength(0);
  });

  it("a row changed since it was read refuses the whole removal", async () => {
    at("2026-09-22T10:00:00Z");
    const db = seedGone();
    db.tables.shifts.push(shift({ id: "live", member_id: GONE, shift_date: "2026-09-22" }));
    // Someone moves the shift between the read and the write.
    const realRpc = (db.supabase as any).rpc;
    (db.supabase as any).rpc = async (fn: string, args: any) => {
      db.tables.shifts.find((r) => r.id === "live")!.end_time = "18:00";
      return realRpc(fn, args);
    };
    await expect(teamOf(db).deleteMember(MANAGER, RID, GONE)).rejects.toThrow(/nobody was removed/);
    expect(db.tables.team_members.some((m) => m.id === GONE)).toBe(true);
    expect(restOf(db)).toHaveLength(0);
  });

  it("a failed read of their wage, needed to re-price the worked part, refuses before any write", async () => {
    at("2026-09-22T10:00:00Z");
    const db = seedGone();
    db.tables.shifts.push(shift({ id: "live", member_id: GONE, shift_date: "2026-09-22" }));
    const realFrom = db.supabase.from.bind(db.supabase);
    let memberReads = 0;
    (db.supabase as any).from = (t: string) => {
      // The first team_members read is the removal target; the second is the wage.
      if (t === "team_members" && ++memberReads === 2) db.errors["team_members:select"] = { message: "boom" };
      return realFrom(t);
    };
    await expect(teamOf(db).deleteMember(MANAGER, RID, GONE)).rejects.toThrow(/nobody was removed/);
    expect(db.opsOn("rpc:release_leaving_shifts")).toHaveLength(0);
    expect(db.tables.shifts.find((r) => r.id === "live")).toMatchObject({ end_time: "17:00" });
  });

  it("for a person with an account, the split lands before the first membership write", async () => {
    at("2026-09-22T10:00:00Z");
    const db = seed();
    db.tables.restaurants = [{ id: RID, timezone: "Europe/Istanbul", country: null }];
    db.tables.shifts.push(shift({ id: "sam-live", member_id: "m-staff", shift_date: "2026-09-22" }));
    const receipt: any = await teamOf(db).deleteMember(MANAGER, RID, "m-staff");
    expect(receipt).toMatchObject({ removed: true, accessRevoked: true, shiftsSplit: 1 });
    // Sam's wage is 20: 4 h less 15 min assumed = 3.75 h x 20.
    expect(db.tables.shifts.find((r) => r.id === "sam-live")).toMatchObject({ end_time: "13:00", labor_cost: 75 });
    const rpcAt = db.ops.findIndex((o) => o.table === "rpc:release_leaving_shifts");
    const firstMembershipWrite = db.ops.findIndex(
      (o) => o.op !== "select" && ["user_restaurant_access", "users", "team_members", "calendar_links"].includes(o.table),
    );
    expect(rpcAt).toBeGreaterThanOrEqual(0);
    expect(firstMembershipWrite === -1 || rpcAt < firstMembershipWrite).toBe(true);
  });
});

// ── K4: "Replace with" on the remove dialog (ADR 0215 item 27) ───────────────

/**
 * The founder, 2026-09-28, verbatim: Replacement "'Replace with' picker";
 * picker checks "refuse overlap warn rest but owner has a say to change it
 * into warn all four to allow double booking". On 8dd9bfeaf this file does
 * not compile (`handoverChecks`, `handoverBlock`, `handoverOf` and
 * `doubleBookingRefusal` do not exist) and `deleteMember` takes no
 * hand-over, so every shift would open: every K4 case fails there.
 */
describe("K4 — a removal can hand the leaving person's shifts to someone named", () => {
  const GONE = "m-gone";
  const SAM = "m-staff"; // wage 20

  afterEach(() => {
    jest.useRealTimers();
  });

  function at(iso: string) {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] }).setSystemTime(new Date(iso));
  }

  /** 2026-09-22 10:00 UTC = 13:00 Istanbul, a Tuesday. */
  function seedGone() {
    at("2026-09-22T10:00:00Z");
    const db = seed();
    db.tables.restaurants = [{ id: RID, timezone: "Europe/Istanbul", country: null }];
    db.tables.team_members.push({ id: GONE, restaurant_id: RID, user_id: null, display_name: "Gone", hourly_wage: 25 });
    db.tables.team_members.find((m) => m.id === SAM)!.position = "Server";
    db.tables.shifts.push(
      shift({ id: "thu", member_id: GONE, shift_date: "2026-09-24", role: "Server", labor_cost: 187.5 }),
      shift({ id: "fri", member_id: GONE, shift_date: "2026-09-25", role: "Server", labor_cost: 187.5 }),
    );
    return db;
  }
  const byId = (db: StubDb, id: string) => db.tables.shifts.find((r) => r.id === id)!;
  const handOver = (ids: string[], accept: string[] = [], to = SAM) => ({ to, shiftIds: ids, accept });
  async function refusedWith(p: Promise<unknown>): Promise<any> {
    try {
      await p;
    } catch (e: any) {
      return e;
    }
    throw new Error("expected a refusal");
  }
  function nothingWritten(db: StubDb) {
    expect(db.opsOn("rpc:hand_over_leaving_shifts")).toHaveLength(0);
    expect(db.opsOn("rpc:release_leaving_shifts")).toHaveLength(0);
    expect(byId(db, "thu")).toMatchObject({ member_id: GONE, state: "scheduled" });
    expect(byId(db, "fri")).toMatchObject({ member_id: GONE, state: "scheduled" });
    expect(db.tables.team_members.some((m) => m.id === GONE)).toBe(true);
  }

  it("moves the named shifts to the chosen person at their wage; the rest still opens", async () => {
    const db = seedGone();
    const receipt: any = await teamOf(db).deleteMember(MANAGER, RID, GONE, null, handOver(["thu"]));
    // 8 h less the 30-minute Art. 68 minimum assumed = 7.5 h x Sam's 20.
    expect(byId(db, "thu")).toMatchObject({ member_id: SAM, state: "scheduled", labor_cost: 150 });
    expect(byId(db, "fri")).toMatchObject({ member_id: null, state: "open", labor_cost: null });
    expect(receipt).toMatchObject({ removed: true, shiftsOpened: 1, shiftsHandedOver: 1, handedTo: SAM });
    expect(db.tables.system_audit_log[0]?.changes).toMatchObject({
      shifts_opened: 1,
      shifts_handed_to: SAM,
      shifts_handed_over: [{ id: "thu", row: "thu", part: "whole" }],
      shifts_warnings_accepted: [],
    });
    expect(JSON.stringify(receipt)).not.toMatch(/labor_cost|hourly_wage|150/);
    expect(db.tables.team_members.some((m) => m.id === GONE)).toBe(false);
  });

  it("hands over the rest of a shift in progress: the worked part stays theirs, the rest is the chosen person's", async () => {
    const db = seedGone();
    db.tables.shifts.push(shift({ id: "live", member_id: GONE, shift_date: "2026-09-22", role: "Server", shift_type: "am" }));
    const receipt: any = await teamOf(db).deleteMember(MANAGER, RID, GONE, null, handOver(["live"]));
    expect(byId(db, "live")).toMatchObject({ member_id: GONE, end_time: "13:00" });
    const rest = db.tables.shifts.find((r) => String(r.id).startsWith("rest-"))!;
    // 4 h less the 15-minute minimum assumed = 3.75 h x 20.
    expect(rest).toMatchObject({ member_id: SAM, state: "scheduled", shift_type: "am", start_time: "13:00", end_time: "17:00", labor_cost: 75 });
    expect(receipt).toMatchObject({ shiftsSplit: 1, shiftsHandedOver: 1, shiftsOpened: 2 });
    expect(db.tables.system_audit_log[0]?.changes?.shifts_handed_over).toEqual([{ id: "live", row: rest.id, part: "rest" }]);
  });

  it("REFUSES an overlap by default, even when the remover accepts it: nothing is written, nobody removed", async () => {
    const db = seedGone();
    db.tables.shifts.push(shift({ id: "sam-thu", member_id: SAM, shift_date: "2026-09-24", start_time: "16:00", end_time: "23:00" }));
    const e = await refusedWith(teamOf(db).deleteMember(MANAGER, RID, GONE, null, handOver(["thu"], ["overlap"])));
    expect(e.getStatus()).toBe(409);
    expect(e.getResponse()).toMatchObject({ refused: [{ id: "thu", check: { code: "overlap", level: "refuse" } }] });
    nothingWritten(db);
  });

  it("with the owner's double booking on, an overlap is a warning: refused until accepted, then it lands", async () => {
    const db = seedGone();
    db.tables.team_settings[0].allow_double_booking = true;
    db.tables.shifts.push(shift({ id: "sam-thu", member_id: SAM, shift_date: "2026-09-24", start_time: "16:00", end_time: "23:00" }));
    const e = await refusedWith(teamOf(db).deleteMember(MANAGER, RID, GONE, null, handOver(["thu"])));
    expect(e.getStatus()).toBe(409);
    expect(e.getResponse()).toMatchObject({ refused: [], unaccepted: [{ id: "thu", check: { code: "overlap", level: "warn" } }] });
    nothingWritten(db);
    const receipt: any = await teamOf(db).deleteMember(MANAGER, RID, GONE, null, handOver(["thu"], ["overlap"]));
    expect(byId(db, "thu").member_id).toBe(SAM);
    expect(receipt.shiftsHandedOver).toBe(1);
    expect(db.tables.system_audit_log[0]?.changes?.shifts_warnings_accepted).toEqual(["overlap"]);
  });

  it.each([
    [
      "time_off",
      (db: StubDb) =>
        db.tables.time_off_requests.push({ id: "t1", restaurant_id: RID, member_id: SAM, start_date: "2026-09-23", end_date: "2026-09-24", status: "approved" }),
    ],
    ["role", (db: StubDb) => (byId(db, "thu").role = "Bar")],
    [
      "weekly_hours",
      (db: StubDb) => {
        // Sam: 14 h less 60 min (13 worked) + 5 x 7.5 = 50.5 that week before Thursday.
        for (const d of ["2026-09-22", "2026-09-23", "2026-09-25", "2026-09-26", "2026-09-27"])
          db.tables.shifts.push(shift({ id: `sam-${d}`, member_id: SAM, shift_date: d }));
        db.tables.shifts.push(shift({ id: "sam-mon", member_id: SAM, shift_date: "2026-09-21", start_time: "09:00", end_time: "23:00" }));
      },
    ],
  ])("WARNS on %s: refused until the remover accepts that warning", async (code, arrange) => {
    const db = seedGone();
    arrange(db);
    const e = await refusedWith(teamOf(db).deleteMember(MANAGER, RID, GONE, null, handOver(["thu"])));
    expect(e.getStatus()).toBe(409);
    expect(e.getResponse().refused).toEqual([]);
    expect(e.getResponse().unaccepted.map((u: any) => u.check)).toEqual([expect.objectContaining({ code, level: "warn" })]);
    nothingWritten(db);
    // Accepting a different warning is not accepting this one.
    const other = code === "role" ? "time_off" : "role";
    await expect(teamOf(db).deleteMember(MANAGER, RID, GONE, null, handOver(["thu"], [other]))).rejects.toThrow();
    nothingWritten(db);
    await teamOf(db).deleteMember(MANAGER, RID, GONE, null, handOver(["thu"], [code]));
    expect(byId(db, "thu").member_id).toBe(SAM);
  });

  it("a pending (not approved) time-off request, a call-out and an open shift are not clashes", async () => {
    const db = seedGone();
    db.tables.time_off_requests.push({ id: "t1", restaurant_id: RID, member_id: SAM, start_date: "2026-09-24", end_date: "2026-09-24", status: "pending" });
    db.tables.shifts.push(
      shift({ id: "sam-out", member_id: SAM, shift_date: "2026-09-24", state: "callout" }),
      shift({ id: "pool", member_id: null, shift_date: "2026-09-24", state: "open" }),
    );
    await teamOf(db).deleteMember(MANAGER, RID, GONE, null, handOver(["thu"]));
    expect(byId(db, "thu").member_id).toBe(SAM);
  });

  it("the chosen person must be on this house's roster: another house's person is not found, and nothing is written", async () => {
    const db = seedGone();
    db.tables.team_members.push({ id: "m-elsewhere", restaurant_id: "restaurant-2", display_name: "Elsewhere", position: "Server" });
    await expect(
      teamOf(db).deleteMember(MANAGER, RID, GONE, null, handOver(["thu"], [], "m-elsewhere")),
    ).rejects.toThrow(/not on this house's roster/);
    nothingWritten(db);
  });

  it("the chosen person cannot be the person leaving", async () => {
    const db = seedGone();
    await expect(teamOf(db).deleteMember(MANAGER, RID, GONE, null, handOver(["thu"], [], GONE))).rejects.toThrow(
      /someone other than the person leaving/,
    );
    nothingWritten(db);
  });

  it("a shift that is not one of their upcoming ones (someone else's, or already past) is refused", async () => {
    const db = seedGone();
    db.tables.shifts.push(
      shift({ id: "moe", member_id: "m-manager", shift_date: "2026-09-24" }),
      shift({ id: "past", member_id: GONE, shift_date: "2026-09-21" }),
    );
    for (const id of ["moe", "past", "nope"]) {
      await expect(teamOf(db).deleteMember(MANAGER, RID, GONE, null, handOver([id]))).rejects.toThrow(
        /not one of their upcoming shifts/,
      );
    }
    nothingWritten(db);
    expect(byId(db, "moe").member_id).toBe("m-manager");
  });

  it("a failed read of the chosen person's shifts, leave or the owner's setting refuses; never read as 'no clash'", async () => {
    for (const t of ["shifts", "time_off_requests", "team_settings"]) {
      const db = seedGone();
      const realFrom = db.supabase.from.bind(db.supabase);
      let shiftReads = 0;
      (db.supabase as any).from = (name: string) => {
        // The first shifts read is the leaving person's; the second the chosen one's.
        if (name === t && (t !== "shifts" || ++shiftReads === 2)) db.errors[`${t}:select`] = { message: "boom" };
        return realFrom(name);
      };
      await expect(teamOf(db).deleteMember(MANAGER, RID, GONE, null, handOver(["thu"]))).rejects.toThrow(/nobody was removed/);
      nothingWritten(db);
    }
  });

  it("a clash added after the gateway's check is still refused by the write itself, and nobody is removed", async () => {
    const db = seedGone();
    const realRpc = (db.supabase as any).rpc;
    (db.supabase as any).rpc = async (fn: string, args: any) => {
      db.tables.shifts.push(shift({ id: "late", member_id: SAM, shift_date: "2026-09-24" }));
      return realRpc(fn, args);
    };
    await expect(teamOf(db).deleteMember(MANAGER, RID, GONE, null, handOver(["thu"]))).rejects.toThrow(/nobody was removed/);
    expect(byId(db, "thu").member_id).toBe(GONE);
    expect(byId(db, "fri").member_id).toBe(GONE);
    expect(db.tables.team_members.some((m) => m.id === GONE)).toBe(true);
  });

  it("the preview lists their upcoming shifts and, for a chosen person, the four checks — no money", async () => {
    const db = seedGone();
    db.tables.shifts.push(shift({ id: "sam-thu", member_id: SAM, shift_date: "2026-09-24", start_time: "16:00", end_time: "23:00" }));
    const plain = await teamOf(db).handoverPreview(MANAGER, RID, GONE, null, null);
    expect(plain.shifts.map((s) => [s.id, s.part, s.checks])).toEqual([
      ["thu", "whole", []],
      ["fri", "whole", []],
    ]);
    const withSam = await teamOf(db).handoverPreview(MANAGER, RID, GONE, SAM, null);
    expect(withSam.doubleBooking).toBe("refuse");
    expect(withSam.shifts.find((s) => s.id === "thu")!.checks).toEqual([expect.objectContaining({ code: "overlap", level: "refuse" })]);
    expect(withSam.shifts.find((s) => s.id === "fri")!.checks).toEqual([]);
    expect(JSON.stringify(withSam)).not.toMatch(/labor_cost|hourly_wage|wage/);
    expect(db.opsOn("rpc:hand_over_leaving_shifts")).toHaveLength(0);
    db.tables.team_members.push({ id: "m-elsewhere", restaurant_id: "restaurant-2", display_name: "E" });
    await expect(teamOf(db).handoverPreview(MANAGER, RID, GONE, "m-elsewhere", null)).rejects.toThrow(/roster/);
    await expect(teamOf(db).handoverPreview(STAFF, RID, GONE, SAM, null)).rejects.toThrow();
  });

  it("only the owner switches double booking, either way; the change is recorded", async () => {
    const db = seedGone();
    await expect(teamOf(db).updateSettings(MANAGER, RID, { allowDoubleBooking: true } as any)).rejects.toThrow(ForbiddenException);
    await expect(teamOf(db).updateSettings(MANAGER, RID, { allowDoubleBooking: false } as any)).rejects.toThrow(ForbiddenException);
    expect(db.tables.team_settings[0].allow_double_booking).toBeUndefined();
    const saved = await teamOf(db).updateSettings(OWNER, RID, { allowDoubleBooking: true } as any);
    expect(saved.allow_double_booking).toBe(true);
    expect(db.tables.system_audit_log.at(-1)?.changes).toMatchObject({ allow_double_booking: { from: null, to: true } });
    expect((await teamOf(db).getSettings(MANAGER, RID)).allow_double_booking).toBe(true);
  });

  it("reads double booking as off for a house that never set it", async () => {
    const db = seed();
    // A row saved before the column: off, and said as false, not left out.
    expect((await teamOf(db).getSettings(OWNER, RID)).allow_double_booking).toBe(false);
    db.tables.team_settings = [];
    expect((await teamOf(db).getSettings(OWNER, RID)).allow_double_booking).toBe(false);
  });
});

describe("K4 — the pure rules behind 'Replace with'", () => {
  const g = (over: Record<string, any>) => ({ id: "g", shift_date: "2026-09-24", start_time: "09:00", end_time: "17:00", ...over });

  it("an overnight shift overlaps the next morning; touching ends do not overlap", () => {
    const over = handoverChecks([g({ shift_date: "2026-09-23", start_time: "22:00", end_time: "04:00" })], {}, [g({ id: "t", start_time: "03:00", end_time: "05:00" })], [], false);
    expect(over.get("g")!.map((c) => c.code)).toEqual(["overlap"]);
    const touch = handoverChecks([g({})], {}, [g({ id: "t", start_time: "17:00", end_time: "20:00" }), g({ id: "u", start_time: "06:00", end_time: "09:00" })], [], false);
    expect(touch.get("g")).toEqual([]);
  });

  it("two handed-over shifts that overlap each other clash too", () => {
    const c = handoverChecks([g({ id: "a" }), g({ id: "b", start_time: "12:00", end_time: "20:00" })], {}, [], [], false);
    expect(c.get("a")!.map((x) => x.level)).toEqual(["refuse"]);
    expect(c.get("b")!.map((x) => x.level)).toEqual(["refuse"]);
  });

  it("a role matches the position or a skill, case and spaces aside; no role on the shift is no check", () => {
    expect(handoverChecks([g({ role: " bar " })], { position: "Server", skills: ["Bar"] }, [], [], false).get("g")).toEqual([]);
    expect(handoverChecks([g({ role: null })], {}, [], [], false).get("g")).toEqual([]);
    expect(handoverChecks([g({ role: "Chef" })], { position: "Server" }, [], [], false).get("g")!.map((c) => c.code)).toEqual(["role"]);
  });

  it("the week is the shift's Monday-week and 45 hours exactly is not over", () => {
    // 5 theirs + the given one, each 7.5 worked = 45: not over. A seventh is.
    const days = ["2026-09-21", "2026-09-22", "2026-09-23", "2026-09-25", "2026-09-26"];
    const theirs = days.map((d, i) => g({ id: `t${i}`, shift_date: d }));
    expect(handoverChecks([g({})], {}, theirs, [], false).get("g")).toEqual([]);
    const more = [...theirs, g({ id: "t9", shift_date: "2026-09-27" })];
    expect(handoverChecks([g({})], {}, more, [], false).get("g")!.map((c) => c.code)).toEqual(["weekly_hours"]);
    // The Sunday before is last week's.
    const lastWeek = [...theirs, g({ id: "t8", shift_date: "2026-09-20" })];
    expect(handoverChecks([g({})], {}, lastWeek, [], false).get("g")).toEqual([]);
  });

  it("time off counts on its first and last day, approved only", () => {
    const leave = [{ start_date: "2026-09-24", end_date: "2026-09-24", status: "approved" }];
    expect(handoverChecks([g({})], {}, [], leave, false).get("g")!.map((c) => c.code)).toEqual(["time_off"]);
    expect(handoverChecks([g({})], {}, [], [{ ...leave[0], status: "rejected" }], false).get("g")).toEqual([]);
  });

  it("a refusal cannot be accepted; a warning only by its own code", () => {
    const checks = new Map([["a", [{ code: "overlap" as const, level: "refuse" as const, message: "" }]]]);
    expect(handoverBlock(checks, new Set(["overlap"]))!.refused).toHaveLength(1);
    const warn = new Map([["a", [{ code: "role" as const, level: "warn" as const, message: "" }]]]);
    expect(handoverBlock(warn, new Set(["time_off"]))!.unaccepted).toHaveLength(1);
    expect(handoverBlock(warn, new Set(["role"]))).toBeNull();
  });

  it("the double-booking switch is the owner's", () => {
    expect(doubleBookingRefusal("owner", { allowDoubleBooking: true })).toBeNull();
    expect(doubleBookingRefusal("manager", { allowDoubleBooking: false })).toMatch(/Only the owner/);
    expect(doubleBookingRefusal("manager", {})).toBeNull();
  });

  it("the removal's query: replaceWith and handOver go together; unknown warning codes are refused", () => {
    expect(handoverOf(undefined, undefined, undefined)).toBeNull();
    expect(() => handoverOf(undefined, "a", undefined)).toThrow(BadRequestException);
    expect(() => handoverOf("m", undefined, undefined)).toThrow(BadRequestException);
    expect(() => handoverOf("m", "a", "overlap,sneaky")).toThrow(BadRequestException);
    expect(handoverOf(" m ", "a, b", "overlap,role")).toEqual({ to: "m", shiftIds: ["a", "b"], accept: ["overlap", "role"] });
  });
});

describe("K5 — every door out of a house releases the person's shifts (ADR 0242, OD-204)", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  // 12:00 UTC = 15:00 in Istanbul.
  function world() {
    jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] }).setSystemTime(new Date("2026-09-22T12:00:00Z"));
    const db = seed();
    db.tables.restaurants = [{ id: RID, timezone: "Europe/Istanbul", country: null }];
    db.tables.shifts.push(
      shift({ id: "staff-past", member_id: "m-staff", shift_date: "2026-09-01", labor_cost: 150 }),
      shift({ id: "staff-next", member_id: "m-staff", shift_date: "2026-10-05", labor_cost: 150 }),
      shift({ id: "staff-later", member_id: "m-staff", shift_date: "2026-10-06", labor_cost: 150 }),
    );
    return db;
  }
  const membersOf = (db: StubDb) =>
    new MembersService(asDatabaseService(db), undefined, teamOf(db));
  const byId = (db: StubDb) => new Map(db.tables.shifts.map((r) => [r.id, r]));

  it("Settings' remove opens their unstarted shifts, takes them off the roster, and files the removal", async () => {
    const db = world();

    await membersOf(db).removeMember(OWNER, RID, STAFF);

    expect(byId(db).get("staff-next")).toMatchObject({ member_id: null, state: "open", labor_cost: null });
    expect(byId(db).get("staff-later")).toMatchObject({ member_id: null, state: "open" });
    expect(byId(db).get("staff-past")).toMatchObject({ member_id: "m-staff", labor_cost: 150 });
    expect(db.tables.team_members.some((m) => m.id === "m-staff")).toBe(false);
    expect(db.tables.user_restaurant_access.some((r) => r.user_id === STAFF)).toBe(false);
    const audit = db.tables.system_audit_log.find((r) => r.action === "team_member_removed");
    expect(audit?.changes).toMatchObject({ via: "MembersService.removeMember", self_leave: false, shifts_opened: 2 });
    // The removed person is told, in the remover's role.
    const told = db.tables.notifications.filter((n) => n.user_id === STAFF);
    expect(told.map((n) => n.message)).toEqual([expect.stringMatching(/^An owner removed you/)]);
  });

  it("leaving on one's own is the same removal, and the owners and managers are told what opened", async () => {
    const db = world();

    await membersOf(db).removeMember(STAFF, RID, STAFF);

    expect(byId(db).get("staff-next")).toMatchObject({ member_id: null, state: "open" });
    expect(db.tables.team_members.some((m) => m.id === "m-staff")).toBe(false);
    const audit = db.tables.system_audit_log.find((r) => r.action === "team_member_removed");
    expect(audit?.changes).toMatchObject({ self_leave: true, shifts_opened: 2 });
    // Nobody tells the leaver they were removed; both leads hear what opened.
    expect(db.tables.notifications.filter((n) => n.user_id === STAFF)).toEqual([]);
    const leads = db.tables.notifications.filter((n) => n.metadata?.action === "team_member_left");
    expect(leads.map((n) => n.user_id).sort()).toEqual([MANAGER, OWNER].sort());
    expect(leads[0].message).toBe("2 of their upcoming shifts are open again and need someone on them.");
  });

  it("leaving from the profile (AuthService.leaveRestaurant) is the same removal, not a third door", async () => {
    const db = world();
    const auth = new AuthService(
      { sign: () => "tok", signAsync: async () => "tok" } as any,
      { get: () => undefined } as any,
      asDatabaseService(db),
      { isBlacklisted: async () => false, blacklist: async () => undefined } as any,
      { sendEmail: async () => undefined } as any,
    );
    (auth as any).moduleRef = { get: () => membersOf(db) };

    await auth.leaveRestaurant(STAFF, RID);

    expect(byId(db).get("staff-next")).toMatchObject({ member_id: null, state: "open" });
    expect(db.tables.team_members.some((m) => m.id === "m-staff")).toBe(false);
    expect(db.tables.user_restaurant_access.some((r) => r.user_id === STAFF)).toBe(false);
    const leads = db.tables.notifications.filter((n) => n.metadata?.action === "team_member_left");
    expect(leads.map((n) => n.user_id).sort()).toEqual([MANAGER, OWNER].sort());
  });

  it("deleting the account leaves every house through the same removal first", async () => {
    const db = world();
    db.tables.user_oauth_accounts = [];
    const auth = new AuthService(
      { sign: () => "tok", signAsync: async () => "tok" } as any,
      { get: () => undefined } as any,
      asDatabaseService(db),
      { isBlacklisted: async () => false, blacklist: async () => undefined } as any,
      { sendEmail: async () => undefined } as any,
    );
    (auth as any).moduleRef = { get: () => membersOf(db) };

    await auth.deleteAccount(STAFF);

    expect(byId(db).get("staff-next")).toMatchObject({ member_id: null, state: "open" });
    expect(db.tables.team_members.some((m) => m.id === "m-staff")).toBe(false);
    expect(db.tables.users.some((u) => u.user_id === STAFF)).toBe(false);
  });

  it("leaving refuses, and changes nothing, when the one removal path is not wired", async () => {
    const db = world();
    const auth = new AuthService(
      { sign: () => "tok", signAsync: async () => "tok" } as any,
      { get: () => undefined } as any,
      asDatabaseService(db),
      { isBlacklisted: async () => false, blacklist: async () => undefined } as any,
      { sendEmail: async () => undefined } as any,
    );

    await expect(auth.leaveRestaurant(STAFF, RID)).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(db.tables.user_restaurant_access.some((r) => r.user_id === STAFF)).toBe(true);
  });

  it("a leave names the shifts the house had no clock to judge, and pushes to the leads it told", async () => {
    const db = world();
    // No zone, no country: a shift today may or may not have started, so it is
    // kept whole on the leaver's name (unjudged) — the one that needs a person.
    db.tables.restaurants = [{ id: RID, timezone: null, country: null }];
    db.tables.shifts.push(
      shift({ id: "staff-today", member_id: "m-staff", shift_date: "2026-09-22", start_time: "11:00", end_time: "19:00" }),
    );
    const push = { sendToUsers: jest.fn(async () => ({ outcome: "accepted_by_service" })) };
    const team = new TeamService(asDatabaseService(db), undefined, push as any);
    const members = new MembersService(asDatabaseService(db), undefined, team);

    await members.removeMember(STAFF, RID, STAFF);

    const leads = db.tables.notifications.filter((n) => n.metadata?.action === "team_member_left");
    expect(leads[0].metadata.shifts_unjudged).toBe(1);
    expect(leads[0].message).toMatch(/1 shift this house has no clock to judge is still on their name/);
    expect(push.sendToUsers).toHaveBeenCalledWith(
      expect.arrayContaining([OWNER, MANAGER]),
      expect.objectContaining({ title: "Sam left the team", priority: "high" }),
    );
  });

  it("a lead whose membership has lapsed (valid_until past) is not told", async () => {
    const db = world();
    const mgr = db.tables.user_restaurant_access.find((r) => r.user_id === MANAGER)!;
    mgr.valid_until = "2026-01-01T00:00:00Z";

    await membersOf(db).removeMember(STAFF, RID, STAFF);

    const leads = db.tables.notifications.filter((n) => n.metadata?.action === "team_member_left");
    expect(leads.map((n) => n.user_id)).toEqual([OWNER]);
  });

  it("the Team page's remove still hands nobody a leaver notice (a manager chose it)", async () => {
    const db = world();
    await teamOf(db).deleteMember(MANAGER, RID, "m-staff");
    expect(db.tables.notifications.filter((n) => n.metadata?.action === "team_member_left")).toEqual([]);
    expect(byId(db).get("staff-next")).toMatchObject({ member_id: null, state: "open" });
  });

  it("a members door without the one removal path refuses, and changes nothing", async () => {
    const db = world();
    const bare = new MembersService(asDatabaseService(db));

    await expect(bare.removeMember(OWNER, RID, STAFF)).rejects.toBeInstanceOf(InternalServerErrorException);

    expect(db.tables.user_restaurant_access.some((r) => r.user_id === STAFF)).toBe(true);
    expect(byId(db).get("staff-next")).toMatchObject({ member_id: "m-staff" });
  });

  it("a manager still cannot remove an owner through the members door", async () => {
    const db = world();
    await expect(membersOf(db).removeMember(MANAGER, RID, OWNER)).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.tables.team_members.some((m) => m.id === "m-owner")).toBe(true);
  });
});
