import { ScheduleService } from "./schedule.service";
import { TeamService } from "./team.service";
import { asDatabaseService, makeStubDb, StubDb } from "./testing/supabase-stub";

/**
 * F-252: the phone's Team tab read "tonight" off the phone's own UTC date, so
 * an LA house saw tomorrow's rota after 17:00. The week replies now carry the
 * house's time zone, to both the full rota (owners, managers) and the staff
 * member's own week, so the phone can read the house's date.
 */

const RID = "restaurant-1";
const MANAGER = "user-manager";
const STAFF = "user-staff";
const WEEK = "2026-10-05"; // a Monday

function seed(timezone: string | null): StubDb {
  return makeStubDb({
    restaurants: [{ id: RID, timezone }],
    user_restaurant_access: [
      {
        id: "a2",
        user_id: MANAGER,
        restaurant_id: RID,
        role: "manager",
        is_active: true,
      },
      {
        id: "a3",
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
        email: "moe@example.test",
      },
      {
        user_id: STAFF,
        restaurant_id: RID,
        role: "staff",
        email: "sam@example.test",
      },
    ],
    team_members: [
      {
        id: "m-staff",
        restaurant_id: RID,
        user_id: STAFF,
        display_name: "Sam",
        hourly_wage: 20,
      },
    ],
    team_settings: [],
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
  return new ScheduleService(
    asDatabaseService(db),
    team,
    { persistForRestaurant: jest.fn(async () => ({ inserted: 0 })) } as any,
    { sendToUsers: jest.fn(async () => undefined) } as any,
  );
}

describe("ScheduleService — the week carries the house's time zone (F-252)", () => {
  it("gives the full rota the house's zone", async () => {
    const week = await service(seed("America/Los_Angeles")).getWeek(
      MANAGER,
      RID,
      WEEK,
    );
    expect(week.timezone).toBe("America/Los_Angeles");
  });

  it("gives a staff member's own week the house's zone", async () => {
    const mine = await service(seed("America/Los_Angeles")).getMyWeek(
      STAFF,
      RID,
      WEEK,
    );
    expect(mine.timezone).toBe("America/Los_Angeles");
  });

  it("says null, not a guessed zone, when none is stated or it cannot be read", async () => {
    expect(
      (await service(seed(null)).getMyWeek(STAFF, RID, WEEK)).timezone,
    ).toBeNull();
    const db = seed("America/Los_Angeles");
    db.errors["restaurants:select"] = { message: "boom" };
    expect((await service(db).getMyWeek(STAFF, RID, WEEK)).timezone).toBeNull();
  });
});
