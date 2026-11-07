import {
  ConflictException,
  InternalServerErrorException,
} from "@nestjs/common";
import { ScheduleService } from "./schedule.service";
import { TeamService } from "./team.service";
import { asDatabaseService, makeStubDb, StubDb } from "./testing/supabase-stub";

/**
 * QA round 4 (team, admin, shell): B1, B2, B3 and H2.
 *
 *  B1 `getMyWeek` took `{ data }` alone from four reads, so a failed shifts
 *     read became `mine: []` and the waiter's week printed "Off" seven times.
 *  B2 `listCertifications` / `listTimeOff` returned `[]` on a failed read: an
 *     empty credential file and an empty time-off file.
 *  B3 `acknowledge` returned `{ acknowledged: true }` whatever the upsert did,
 *     and 200 `{ acknowledged: false }` for a caller with no roster row.
 *  H2 staff saw the manager's unpublished week as the real roster.
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
    expect(week.mine[0].draft).toBe(false);
    expect(week.published).toBe(true);
    expect(week.draftsWithheld).toBe(false);
  });
});

describe("H2: staff see only a published week", () => {
  it("withholds every shift and the schedule row of an unpublished week from staff", async () => {
    const week = await service(seed()).getMyWeek(STAFF, RID, DRAFT_WEEK);
    expect(week.mine).toEqual([]);
    expect(week.open).toEqual([]);
    expect(week.schedule).toBeNull();
    expect(week.published).toBe(false);
    expect(week.draftsWithheld).toBe(true);
  });

  it("judges each shift by its own schedule, so a range across two weeks hides only the draft one", async () => {
    // A Wednesday "weekStart" spans the draft week's tail and the live week's
    // head; only the live week's shifts may reach staff.
    const db = seed();
    db.tables.shifts.push(
      shift("sh-draft-sun", "s-draft", "m-staff", "2026-09-13", "scheduled"),
    );
    const week = await service(db).getMyWeek(STAFF, RID, "2026-09-09");
    expect(week.mine.map((s: any) => s.id)).toEqual(["sh-live-mine"]);
    expect(week.open.map((s: any) => s.id)).toEqual(["sh-live-open"]);
  });

  // A null schedule_id is real: release_leaving_shifts writes one when the
  // cut rest of a shift lands in a week that had no schedules row yet (a
  // Sunday 22:00-02:00 shift cut by a removal), a hand-over gives that rest
  // to a named person, and a call-out copies the null on. Such a shift is
  // judged by the week its shift_date falls in.
  function lone(id: string, memberId: string | null, date: string) {
    return {
      ...shift(id, null as any, memberId, date, memberId ? "scheduled" : "open"),
      schedule_id: null,
    };
  }

  it("shows staff a shift with no schedule_id once the week of its date is published", async () => {
    const db = seed();
    db.tables.shifts.push(
      lone("sh-rest-mine", "m-staff", LIVE_WEEK),
      lone("sh-rest-open", null, LIVE_WEEK),
    );
    const week = await service(db).getMyWeek(STAFF, RID, LIVE_WEEK);
    expect(week.mine.map((s: any) => s.id)).toEqual([
      "sh-live-mine",
      "sh-rest-mine",
    ]);
    expect(week.open.map((s: any) => s.id)).toContain("sh-rest-open");
    expect(week.mine.find((s: any) => s.id === "sh-rest-mine").draft).toBe(
      false,
    );
  });

  it("reads the week of a lone shift's date even when the range asked for starts mid-week", async () => {
    // "2026-09-09" is a Wednesday: it has no schedules row of its own, so the
    // lone Monday shift's week (LIVE_WEEK) must be looked up by its date.
    const db = seed();
    db.tables.shifts.push(lone("sh-rest-mine", "m-staff", LIVE_WEEK));
    const week = await service(db).getMyWeek(STAFF, RID, "2026-09-09");
    expect(week.mine.map((s: any) => s.id)).toEqual([
      "sh-live-mine",
      "sh-rest-mine",
    ]);
  });

  it("hides a shift with no schedule_id while the week of its date is a draft or has no row", async () => {
    const db = seed();
    db.tables.shifts.push(
      lone("sh-rest-draft", "m-staff", DRAFT_WEEK),
      lone("sh-rest-nowhere", "m-staff", "2026-09-21"),
    );
    const draft = await service(db).getMyWeek(STAFF, RID, DRAFT_WEEK);
    expect(draft.mine).toEqual([]);
    const nowhere = await service(db).getMyWeek(STAFF, RID, "2026-09-21");
    expect(nowhere.mine).toEqual([]);
    expect(nowhere.draftsWithheld).toBe(true);
  });

  it("refuses rather than guess when whether the week is published cannot be read", async () => {
    // The week's own row is read by week_start; the shifts' schedules by id.
    // Both are `schedules:select`, so this is the same refusal as B1's — the
    // point is that it is a refusal, not a week shown on a guess.
    const db = seed({ "schedules:select": { message: "connection reset" } });
    await expect(
      service(db).getMyWeek(STAFF, RID, DRAFT_WEEK),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it("control: a manager still sees the draft week, each shift marked draft", async () => {
    const week = await service(seed()).getMyWeek(MANAGER, RID, DRAFT_WEEK);
    expect(week.schedule?.status).toBe("draft");
    expect(week.open.map((s: any) => [s.id, s.draft])).toEqual([
      ["sh-draft-open", true],
    ]);
    expect(week.published).toBe(false);
    expect(week.draftsWithheld).toBe(false);
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

  it("refuses a week that is not published", async () => {
    const db = seed();
    await expect(
      service(db).acknowledge(STAFF, RID, "s-draft"),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(db.tables.schedule_receipts).toEqual([]);
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
