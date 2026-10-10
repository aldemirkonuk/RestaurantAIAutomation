import { InternalServerErrorException } from "@nestjs/common";
import { ScheduleService } from "./schedule.service";
import { TeamService } from "./team.service";
import { asDatabaseService, makeStubDb, StubDb } from "./testing/supabase-stub";

/**
 * F-690 — a shift's history stays true. An edit to a past shift is priced at
 * the wage in force on that shift's date, not today's; and a deleted shift
 * leaves a record of who deleted it and what it was.
 */

const RID = "restaurant-1";
const OWNER = "user-owner";

function seed(errors: Record<string, { message: string }> = {}): StubDb {
  return makeStubDb(
    {
      user_restaurant_access: [
        { id: "a1", user_id: OWNER, restaurant_id: RID, role: "owner", is_active: true, team_pay_access: false },
      ],
      users: [{ user_id: OWNER, restaurant_id: RID, role: "owner", name: "Ada", email: "ada@example.test" }],
      team_members: [
        // Ayşe was 200/h through September; her raise to 250/h came on 1 October.
        { id: "m-ayse", restaurant_id: RID, user_id: null, display_name: "Ayşe", hourly_wage: 250, created_at: "2026-01-01" },
      ],
      team_member_wage_changes: [
        { id: "w1", restaurant_id: RID, member_id: "m-ayse", old_wage: 150, new_wage: 200, changed_at: "2026-06-01T09:00:00Z" },
        { id: "w2", restaurant_id: RID, member_id: "m-ayse", old_wage: 200, new_wage: 250, changed_at: "2026-10-01T09:00:00Z" },
      ],
      team_settings: [{ restaurant_id: RID, labor_tracking_enabled: true, wage_visible: true, labor_target_pct: 30 }],
      restaurants: [{ id: RID, currency: "TRY", country: "TR" }],
      schedules: [{ id: "s1", restaurant_id: RID, week_start: "2026-08-31", status: "draft" }],
      shifts: [
        {
          id: "sh-sept",
          restaurant_id: RID,
          schedule_id: "s1",
          member_id: "m-ayse",
          shift_date: "2026-09-03",
          start_time: "09:00",
          end_time: "17:00",
          state: "scheduled",
          recorded_break_min: 30,
          labor_cost: 1500,
          shift_breaks: [],
        },
      ],
      shift_breaks: [],
      team_member_departures: [],
      notifications: [],
      system_audit_log: [],
    },
    errors,
  );
}

function scheduleOf(db: StubDb) {
  const team = new TeamService(asDatabaseService(db));
  const notifications = { persistForRestaurant: jest.fn(async () => ({ inserted: 0 })) } as any;
  const push = { sendToUsers: jest.fn(async () => undefined) } as any;
  return new ScheduleService(asDatabaseService(db), team, notifications, push);
}

describe("F-690 — a past shift is priced at the wage it was worked at", () => {
  it("fixing September's break after an October raise keeps September's wage", async () => {
    const db = seed();
    await scheduleOf(db).updateShift(OWNER, RID, "sh-sept", { breakMinutes: 60 } as any);
    // 8 h span - 60 min break = 7 h, at the 200/h in force on 3 September.
    expect(db.tables.shifts.find((s) => s.id === "sh-sept")?.labor_cost).toBe(1400);
  });

  it("a shift after the last change is priced at the wage on file now", async () => {
    const db = seed();
    await scheduleOf(db).updateShift(OWNER, RID, "sh-sept", {
      shiftDate: "2026-10-05",
      breakMinutes: 60,
    } as any);
    expect(db.tables.shifts.find((s) => s.id === "sh-sept")?.labor_cost).toBe(1750);
  });

  it("a failed wage-history read is said, and nothing is saved", async () => {
    const db = seed({ "team_member_wage_changes:select": { message: "boom" } });
    await expect(
      scheduleOf(db).updateShift(OWNER, RID, "sh-sept", { breakMinutes: 60 } as any),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    expect(db.tables.shifts.find((s) => s.id === "sh-sept")?.labor_cost).toBe(1500);
  });
});

describe("F-690 — a deleted shift leaves a trail", () => {
  it("records who deleted which shift and what it was, without its cost", async () => {
    const db = seed();
    await scheduleOf(db).deleteShift(OWNER, RID, "sh-sept");
    expect(db.tables.shifts.find((s) => s.id === "sh-sept")).toBeUndefined();
    const row = db.tables.system_audit_log.find((r) => r.action === "shift_deleted");
    expect(row).toMatchObject({
      actor_id: OWNER,
      entity_id: "sh-sept",
      restaurant_id: RID,
      changes: { member_id: "m-ayse", shift_date: "2026-09-03", start_time: "09:00", end_time: "17:00" },
    });
    expect(JSON.stringify(row?.changes)).not.toContain("1500");
  });

  it("no record, no delete", async () => {
    const db = seed({ "system_audit_log:insert": { message: "boom" } });
    await expect(scheduleOf(db).deleteShift(OWNER, RID, "sh-sept")).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
    expect(db.tables.shifts.find((s) => s.id === "sh-sept")).toBeDefined();
  });
});
