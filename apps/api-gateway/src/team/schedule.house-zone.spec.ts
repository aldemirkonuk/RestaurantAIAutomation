import {
  ConflictException,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
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

function seed(timezone: string | null, country: string | null = null): StubDb {
  return makeStubDb({
    restaurants: [{ id: RID, timezone, country }],
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

// F-1007: the web printed "5p" in a Turkish house; the country the clock is
// read from now travels with the week, to everyone (it is not money).
describe("ScheduleService — the week carries the house's country (F-1007)", () => {
  it("gives the full rota and a staff member's own week the house's country", async () => {
    const db = seed("Europe/Istanbul", "Turkey");
    expect((await service(db).getWeek(MANAGER, RID, WEEK)).country).toBe(
      "Turkey",
    );
    expect((await service(db).getMyWeek(STAFF, RID, WEEK)).country).toBe(
      "Turkey",
    );
  });

  it("says null when it cannot be read", async () => {
    const db = seed("Europe/Istanbul", "Turkey");
    db.errors["restaurants:select"] = { message: "boom" };
    expect((await service(db).getMyWeek(STAFF, RID, WEEK)).country).toBeNull();
  });
});

// F-1005: "I have seen it" answered success whether or not anything was written.
describe("ScheduleService.acknowledge — says seen only once it is recorded (F-1005)", () => {
  function withWeek(db: StubDb): StubDb {
    db.tables.schedules.push({
      id: "s1",
      restaurant_id: RID,
      week_start: WEEK,
      status: "published",
    });
    return db;
  }

  it("writes the receipt and says so", async () => {
    const db = withWeek(seed(null));
    await expect(service(db).acknowledge(STAFF, RID, "s1")).resolves.toEqual({
      acknowledged: true,
    });
    expect(db.tables.schedule_receipts).toHaveLength(1);
  });

  it("refuses when the receipt cannot be written", async () => {
    const db = withWeek(seed(null));
    db.errors["schedule_receipts:upsert"] = { message: "boom" };
    await expect(
      service(db).acknowledge(STAFF, RID, "s1"),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it("refuses, in words, a person with no roster row", async () => {
    const db = withWeek(seed(null));
    db.tables.team_members = [];
    await expect(
      service(db).acknowledge(STAFF, RID, "s1"),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("calls a failed schedule read an error, not a missing schedule", async () => {
    const db = withWeek(seed(null));
    db.errors["schedules:select"] = { message: "boom" };
    await expect(
      service(db).acknowledge(STAFF, RID, "s1"),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
    db.errors["schedules:select"] = undefined as any;
    await expect(
      service(db).acknowledge(STAFF, RID, "nope"),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
