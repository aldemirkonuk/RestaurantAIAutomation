import { InternalServerErrorException } from "@nestjs/common";
import { ScheduleService } from "./schedule.service";
import { TeamService } from "./team.service";
import { asDatabaseService, makeStubDb, StubDb } from "./testing/supabase-stub";

/**
 * A FAILED READ IS NOT AN EMPTY WEEK.
 *
 * `scripts/check_read_errors_not_swallowed.py` caught four reads this branch
 * introduced that destructured only `data`. supabase-js RESOLVES with
 * `{ data, error }` rather than throwing, so on failure `data` came back
 * `undefined` and every one of them read as a legitimate empty result.
 *
 * Two of the four armed a guard against a DESTRUCTIVE action, which is what
 * makes them worth a spec of their own rather than a baseline row:
 *
 *   copyWeek  — `existing` counts the shifts already in the target week. A
 *               failed read gave `inTheWay === 0`, the "this week already has
 *               N shift(s); copying replaces the whole week" ConflictException
 *               did NOT throw, and the copy proceeded to delete and overwrite a
 *               week the manager was never warned about.
 *   publish   — `receiptRows` counts read receipts about to be cleared. A
 *               failed read gave `receiptsAtRisk === 0`, the "nobody will be
 *               recorded as having seen it" ConflictException did not throw,
 *               and the receipts were destroyed silently.
 *
 * A fifth, `src` in copyWeek, was pre-existing baseline debt in the same method
 * and is fixed alongside them: a failed source read returned `{ copied: 0 }`,
 * which reports a SUCCESSFUL copy of nothing for a week that may be full.
 *
 * Each test below forces exactly one query to fail and asserts the operation
 * REFUSES. The control at the end asserts the guards still fire normally, so a
 * blanket "throw on everything" could not pass this file.
 */

const RID = "restaurant-1";
const MANAGER = "user-manager";
const FROM = "2026-09-07"; // a Monday
const TO = "2026-09-14";

function seed(errors: Record<string, { message: string }> = {}): StubDb {
  return makeStubDb(
    {
      user_restaurant_access: [
        {
          id: "a2",
          user_id: MANAGER,
          restaurant_id: RID,
          role: "manager",
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
      ],
      team_members: [
        {
          id: "m1",
          restaurant_id: RID,
          user_id: null,
          display_name: "Someone",
          hourly_wage: 20,
        },
      ],
      team_settings: [
        {
          restaurant_id: RID,
          labor_tracking_enabled: true,
          wage_visible: true,
          labor_target_pct: 30,
        },
      ],
      schedules: [
        { id: "s-from", restaurant_id: RID, week_start: FROM, status: "draft" },
        { id: "s-to", restaurant_id: RID, week_start: TO, status: "published" },
      ],
      shifts: [
        {
          id: "sh-1",
          restaurant_id: RID,
          schedule_id: "s-from",
          member_id: "m1",
          shift_date: FROM,
          start_time: "09:00",
          end_time: "17:00",
          role: "server",
          shift_type: "regular",
          state: "scheduled",
        },
        {
          id: "sh-2",
          restaurant_id: RID,
          schedule_id: "s-to",
          member_id: "m1",
          shift_date: TO,
          start_time: "09:00",
          end_time: "17:00",
          role: "server",
          shift_type: "regular",
          state: "scheduled",
        },
      ],
      shift_breaks: [],
      schedule_receipts: [
        { id: "r-1", schedule_id: "s-to", member_id: "m1" },
      ],
      coverage_templates: [],
      notifications: [],
      system_audit_log: [],
    },
    errors,
  );
}

function service(db: StubDb): ScheduleService {
  // Built exactly as schedule.service.spec.ts builds it, so these tests
  // exercise the same object the rest of the suite does.
  const team = new TeamService(asDatabaseService(db));
  const notifications = {
    persistForRestaurant: jest.fn(async () => ({ inserted: 0 })),
  } as any;
  const push = { sendToUsers: jest.fn(async () => undefined) } as any;
  return new ScheduleService(asDatabaseService(db), team, notifications, push);
}

describe("a failed read never reads as an empty week", () => {
  it("copyWeek refuses when the source week cannot be read", async () => {
    // BEFORE: returned { copied: 0 } — a success reply for a copy that did not
    // happen, over a source week that may be full.
    const db = seed({ "shifts:select": { message: "statement timeout" } });
    await expect(
      service(db).copyWeek(MANAGER, RID, {
        fromWeekStart: FROM,
        toWeekStart: TO,
      } as any),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });

  it("publish refuses when the read receipts cannot be counted", async () => {
    // BEFORE: receiptsAtRisk = 0, the "nobody will be recorded as having seen
    // it" guard stayed silent, and r-1 was cleared without anyone being asked.
    const db = seed({
      "schedule_receipts:select": { message: "connection reset" },
    });
    await expect(
      service(db).publish(MANAGER, RID, "s-to", {} as any),
    ).rejects.toBeInstanceOf(InternalServerErrorException);
  });
});

describe("the control — the guards these reads arm still fire", () => {
  it("copyWeek still raises the ordinary conflict when the target week is not empty", async () => {
    // Without this, a change that simply threw on every path would pass the two
    // tests above while destroying the behaviour they exist to protect.
    const db = seed();
    await expect(
      service(db).copyWeek(MANAGER, RID, {
        fromWeekStart: FROM,
        toWeekStart: TO,
      } as any),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("publish still raises the ordinary conflict when receipts are at risk", async () => {
    const db = seed();
    await expect(
      service(db).publish(MANAGER, RID, "s-to", {} as any),
    ).rejects.toMatchObject({ status: 409 });
  });
});
