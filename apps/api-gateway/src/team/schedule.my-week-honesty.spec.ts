import {
  ConflictException,
  InternalServerErrorException,
} from "@nestjs/common";
import { ScheduleService } from "./schedule.service";
import { TeamService } from "./team.service";
import { asDatabaseService, makeStubDb, StubDb } from "./testing/supabase-stub";

/**
 * QA round 4 (team, admin, shell): B1, B2 and B3.
 *
 *  B1 `getMyWeek` took `{ data }` alone from four reads, so a failed shifts
 *     read became `mine: []` and the waiter's week printed "Off" seven times.
 *  B2 `listCertifications` / `listTimeOff` returned `[]` on a failed read: an
 *     empty credential file and an empty time-off file.
 *  B3 `acknowledge` returned `{ acknowledged: true }` whatever the upsert did,
 *     and 200 `{ acknowledged: false }` for a caller with no roster row.
 *
 * Each failure test forces one table's read (or write) to fail and asserts
 * the call REFUSES; the controls assert the same calls still answer normally,
 * so a blanket "throw on everything" cannot pass this file.
 */

const RID = "restaurant-1";
const MANAGER = "user-manager";
const STAFF = "user-staff";
const STRANGER = "user-unrostered";
const DRAFT_WEEK = "2026-09-07"; // a Monday
const LIVE_WEEK = "2026-09-14";

function seed(errors: Record<string, { message: string }> = {}): StubDb {
  return makeStubDb(
    {
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
        {
          id: "a3",
          user_id: STRANGER,
          restaurant_id: RID,
          role: "staff",
          is_active: true,
        },
      ],
      users: [],
      team_members: [
        {
          id: "m-staff",
          restaurant_id: RID,
          user_id: STAFF,
          display_name: "Ana",
        },
        {
          id: "m-mgr",
          restaurant_id: RID,
          user_id: MANAGER,
          display_name: "Moe",
        },
      ],
      team_settings: [],
      schedules: [
        {
          id: "s-draft",
          restaurant_id: RID,
          week_start: DRAFT_WEEK,
          status: "draft",
        },
        {
          id: "s-live",
          restaurant_id: RID,
          week_start: LIVE_WEEK,
          status: "published",
        },
      ],
      shifts: [
        shift("sh-draft-mine", "s-draft", "m-staff", DRAFT_WEEK, "scheduled"),
        shift("sh-draft-open", "s-draft", null, DRAFT_WEEK, "open"),
        shift("sh-live-mine", "s-live", "m-staff", LIVE_WEEK, "scheduled"),
        shift("sh-live-open", "s-live", null, LIVE_WEEK, "open"),
      ],
      shift_breaks: [],
      schedule_receipts: [],
      team_certifications: [
        {
          id: "c1",
          restaurant_id: RID,
          member_id: "m-staff",
          cert_type: "Food",
          expires_at: "2030-01-01",
        },
      ],
      time_off_requests: [
        {
          id: "t1",
          restaurant_id: RID,
          member_id: "m-staff",
          status: "pending",
          created_at: "2026-09-01",
        },
      ],
      notifications: [],
      system_audit_log: [],
    },
    errors,
  );
}

function shift(
  id: string,
  scheduleId: string,
  memberId: string | null,
  date: string,
  state: string,
) {
  return {
    id,
    restaurant_id: RID,
    schedule_id: scheduleId,
    member_id: memberId,
    shift_date: date,
    start_time: "09:00",
    end_time: "17:00",
    role: "server",
    shift_type: "regular",
    state,
    labor_cost: 160,
  };
}

function team(db: StubDb): TeamService {
  return new TeamService(asDatabaseService(db));
}

function service(db: StubDb): ScheduleService {
  const notifications = {
    persistForRestaurant: jest.fn(async () => ({ inserted: 0 })),
  } as any;
  const push = { sendToUsers: jest.fn(async () => undefined) } as any;
  return new ScheduleService(
    asDatabaseService(db),
    team(db),
    notifications,
    push,
  );
}

describe("B1: the staff week fails closed", () => {
  it.each([
    ["shifts:select", "the shifts"],
    ["team_members:select", "the caller's roster row"],
    ["schedules:select", "the schedule"],
    ["schedule_receipts:select", "the read receipt"],
  ])("refuses when %s fails (%s), never answers an empty week", async (key) => {
    const db = seed({ [key]: { message: "statement timeout" } });
    await expect(
      service(db).getMyWeek(STAFF, RID, LIVE_WEEK),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it("control: a readable published week answers with the person's shifts", async () => {
    const week = await service(seed()).getMyWeek(STAFF, RID, LIVE_WEEK);
    expect(week.mine.map((s: any) => s.id)).toEqual(["sh-live-mine"]);
    expect(week.mine[0]).not.toHaveProperty("labor_cost");
  });
});

describe("B3: acknowledge never reports a confirmation it did not store", () => {
  it("refuses when the receipt write fails", async () => {
    const db = seed({
      "schedule_receipts:upsert": { message: "permission denied" },
    });
    await expect(
      service(db).acknowledge(STAFF, RID, "s-live"),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it("refuses a caller with no roster row instead of a 200 that reads as done", async () => {
    await expect(
      service(seed()).acknowledge(STRANGER, RID, "s-live"),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("refuses when the schedule or the roster row cannot be read", async () => {
    for (const key of ["schedules:select", "team_members:select"]) {
      const db = seed({ [key]: { message: "statement timeout" } });
      await expect(
        service(db).acknowledge(STAFF, RID, "s-live"),
      ).rejects.toBeInstanceOf(InternalServerErrorException);
    }
  });

  it("control: a stored receipt answers acknowledged", async () => {
    const db = seed();
    await expect(
      service(db).acknowledge(STAFF, RID, "s-live"),
    ).resolves.toEqual({
      acknowledged: true,
    });
    expect(db.tables.schedule_receipts).toHaveLength(1);
    expect(db.tables.schedule_receipts[0]).toMatchObject({
      schedule_id: "s-live",
      member_id: "m-staff",
    });
  });
});

describe("B2: the credential and time-off files fail closed", () => {
  it.each([
    [MANAGER, "manager"],
    [STAFF, "staff"],
  ])("listCertifications refuses a failed read (%s)", async (who) => {
    const db = seed({ "team_certifications:select": { message: "timeout" } });
    await expect(team(db).listCertifications(who, RID)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it.each([
    [MANAGER, "manager"],
    [STAFF, "staff"],
  ])("listTimeOff refuses a failed read (%s)", async (who) => {
    const db = seed({ "time_off_requests:select": { message: "timeout" } });
    await expect(team(db).listTimeOff(who, RID)).rejects.toBeInstanceOf(
      InternalServerErrorException,
    );
  });

  it("control: readable files are listed", async () => {
    const db = seed();
    await expect(team(db).listCertifications(STAFF, RID)).resolves.toHaveLength(
      1,
    );
    await expect(team(db).listTimeOff(STAFF, RID)).resolves.toHaveLength(1);
  });
});
