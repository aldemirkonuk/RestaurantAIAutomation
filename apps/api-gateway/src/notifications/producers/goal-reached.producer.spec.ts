/**
 * The goal-reached producer, and the three facts the founder asked it to carry:
 * the time of the event, how early it was, and who was on shift then.
 */

import { GoalReachedProducer } from "./goal-reached.producer";
import { ProducerLedgerService } from "./producer-ledger.service";
import {
  FakeDb,
  fakeDatabase,
  fakeNotifications,
  recorder,
} from "./testing/fake-db";
import { onShiftAt, shiftWindow } from "./shift-window";
import { count, percent, percentFigure } from "./producer-copy";

const TENANT = "rest-1";
const OTHER = "rest-2";
const MEMBERS = ["user-1", "user-2"];
const ZONE = "America/New_York";
const AUDIENCE = { ready: [...MEMBERS], deferred: [] as string[] };

function build(progress: any) {
  const db = new FakeDb();
  db.tables.user_restaurant_access = [
    {
      restaurant_id: TENANT,
      user_id: "user-1",
      role: "owner",
      is_active: true,
    },
    {
      restaurant_id: TENANT,
      user_id: "user-2",
      role: "manager",
      is_active: true,
    },
    {
      restaurant_id: TENANT,
      user_id: "user-3",
      role: "staff",
      is_active: true,
    },
  ];
  const database = fakeDatabase(db, MEMBERS);
  const notifications = fakeNotifications(MEMBERS);
  const ledger = new ProducerLedgerService(
    database as any,
    notifications as any,
  );
  const goals = {
    getGoalProgress: recorder(async () => progress),
  };
  // A USD house, said outright (F-341: a money goal prints the house's money).
  db.tables.restaurants.push({ id: TENANT, currency: "USD" });
  const producer = new GoalReachedProducer(
    database as any,
    goals as any,
    ledger,
  );
  return { db, notifications, goals, producer };
}

function goalRow(over: Record<string, any> = {}) {
  return {
    id: "goal-1",
    restaurant_id: TENANT,
    name: "September wine revenue",
    metric_key: "wine_revenue",
    target_value: 10000,
    direction: "at_least",
    deadline: "2026-09-30",
    status: "active",
    ...over,
  };
}

const REACHED = {
  target: 10000,
  current: 10450,
  metricLabel: "Wine revenue",
  unit: "currency",
};

/** 23:04 New York on 2 September = 03:04 UTC on 3 September. */
const CROSSED_AT = "2026-09-03T03:04:00Z";
const NOW = new Date("2026-09-03T03:10:00Z");

function seedCrossing(db: FakeDb) {
  db.tables.pos_checks.push({
    restaurant_id: TENANT,
    voided: false,
    opened_at: "2026-09-03T02:40:00Z",
    closed_at: CROSSED_AT,
    total: 480,
  });
}

function seedShift(db: FakeDb) {
  db.tables.shifts.push({
    restaurant_id: TENANT,
    member_id: "member-1",
    shift_date: "2026-09-02",
    start_time: "17:00",
    end_time: "01:00",
    role: "floor",
    state: "scheduled",
  });
  db.tables.team_members.push({
    id: "member-1",
    restaurant_id: TENANT,
    display_name: "Ada Lovelace",
  });
}

describe("GoalReachedProducer", () => {
  it("[REVERT-FAILS] a money goal is said in the house's own money, and bare when none is recorded (F-341)", async () => {
    const lira = build(REACHED);
    lira.db.tables.restaurants[0].currency = "TRY";
    lira.db.tables.analytics_goals.push(goalRow());
    seedCrossing(lira.db);
    await lira.producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    const said = lira.notifications.persistForRestaurant.calls[0][1].message;
    expect(said).toMatch(
      /stands at TRY\s10,450\.00 against a target of TRY\s10,000\.00/,
    );
    expect(said).not.toContain("$");

    const unsaid = build(REACHED);
    unsaid.db.tables.restaurants[0].currency = null;
    unsaid.db.tables.analytics_goals.push(goalRow());
    seedCrossing(unsaid.db);
    await unsaid.producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(
      unsaid.notifications.persistForRestaurant.calls[0][1].message,
    ).toContain("stands at 10,450.00 against a target of 10,000.00");
  });

  it("[REVERT-FAILS] a lira house's goal groups its money the house's way, not en-US (F-887)", async () => {
    const lira = build(REACHED);
    lira.db.tables.restaurants[0].currency = "TRY";
    lira.db.tables.restaurants[0].country = "TR";
    lira.db.tables.analytics_goals.push(goalRow());
    seedCrossing(lira.db);
    await lira.producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(
      lira.notifications.persistForRestaurant.calls[0][1].message,
    ).toContain("stands at ₺10.450,00 against a target of ₺10.000,00");
  });

  it("[REVERT-FAILS] a lira house's count goal groups the house's way, not en-US (F-888)", async () => {
    const lira = build({
      ...REACHED,
      current: 1240.5,
      target: 1200,
      unit: "bottles",
    });
    lira.db.tables.restaurants[0].currency = "TRY";
    lira.db.tables.restaurants[0].country = "TR";
    lira.db.tables.analytics_goals.push(goalRow({ target_value: 1200 }));
    seedCrossing(lira.db);
    await lira.producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(
      lira.notifications.persistForRestaurant.calls[0][1].message,
    ).toContain("stands at 1.240,5 against a target of 1.200.");
  });

  it("[REVERT-FAILS] counts and percents take the house's formats, en-US when unknown (F-888)", () => {
    expect(count(1240.5, "tr-TR")).toBe("1.240,5");
    expect(count(1240.5, null)).toBe("1,240.5");
    expect(percentFigure(0.125, "tr-TR")).toBe("%12,5");
    expect(percentFigure(0.125, null)).toBe("12.5%");
    expect(percentFigure(-0.04, null)).toBe("-4.0%");
    expect(percent(0.18, "tr-TR")).toBe("%18");
    expect(percent(-0.1796875, undefined)).toBe("18%");
  });

  it("[REVERT-FAILS] sends the goal's figures only to owners and managers (F-782)", async () => {
    const { db, notifications, producer } = build(REACHED);
    db.tables.analytics_goals.push(goalRow());
    seedCrossing(db);
    const audience = { ready: ["user-1", "user-3"], deferred: ["user-2"] };
    const tally = await producer.sweepTenant(TENANT, ZONE, audience, NOW);
    expect(tally.deferredQuietHours).toBe(1);
    const opts = notifications.persistForRestaurant.calls[0][2];
    expect(opts.onlyUserIds).toEqual(["user-1"]);
  });

  it("[REVERT-FAILS] an owner whose membership has ended does not hear the goal's figures", async () => {
    const { db, notifications, producer } = build(REACHED);
    db.tables.user_restaurant_access[0].valid_until = "2026-01-01T00:00:00Z";
    db.tables.analytics_goals.push(goalRow());
    seedCrossing(db);
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    const opts = notifications.persistForRestaurant.calls[0][2];
    expect(opts.onlyUserIds).toEqual(["user-2"]);
  });

  it("[REVERT-FAILS] says so when only staff were there to hear it, rather than writing to them", async () => {
    const { db, notifications, producer } = build(REACHED);
    db.tables.analytics_goals.push(goalRow());
    seedCrossing(db);
    const tally = await producer.sweepTenant(
      TENANT,
      ZONE,
      { ready: ["user-3"], deferred: [] },
      NOW,
    );
    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
    expect(tally.withheldReason).toMatch(/no owner or manager/);
  });

  it("throws when it cannot read who may hear the goal — never the whole house", async () => {
    const { db, notifications, producer } = build(REACHED);
    db.tables.analytics_goals.push(goalRow());
    seedCrossing(db);
    db.failures.user_restaurant_access = "permission denied";
    await expect(
      producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW),
    ).rejects.toThrow(/user_restaurant_access/);
    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
  });

  it("writes one notification when an at-least goal crosses its target", async () => {
    const { db, notifications, producer } = build(REACHED);
    db.tables.analytics_goals.push(goalRow());
    seedCrossing(db);
    seedShift(db);

    const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(tally.emitted).toBe(2); // one row per member
    expect(notifications.persistForRestaurant.calls).toHaveLength(1);

    const payload = notifications.persistForRestaurant.calls[0][1];
    expect(payload.title).toBe("September wine revenue reached its target");
    expect(payload.type).toBe("goal_reached");
  });

  it("[REVERT-FAILS] a second sweep over the same crossing writes nothing", async () => {
    const { db, notifications, producer } = build(REACHED);
    db.tables.analytics_goals.push(goalRow());
    seedCrossing(db);

    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    const second = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);

    expect(notifications.persistForRestaurant.calls).toHaveLength(1);
    expect(second.emitted).toBe(0);
    expect(second.alreadyClaimed).toBe(1);
  });

  it("[REVERT-FAILS] reads only its own tenant's goals", async () => {
    const { db, notifications, producer } = build(REACHED);
    db.tables.analytics_goals.push(goalRow({ id: "mine" }));
    db.tables.analytics_goals.push(
      goalRow({ id: "theirs", restaurant_id: OTHER, name: "Their goal" }),
    );
    seedCrossing(db);

    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(notifications.persistForRestaurant.calls).toHaveLength(1);
    expect(notifications.persistForRestaurant.calls[0][0]).toBe(TENANT);
    expect(notifications.persistForRestaurant.calls[0][1].title).toContain(
      "September wine revenue",
    );
  });

  it("carries the crossing time, the earliness and the roster as metadata", async () => {
    const { db, notifications, producer } = build(REACHED);
    db.tables.analytics_goals.push(goalRow());
    seedCrossing(db);
    seedShift(db);

    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    const meta = notifications.persistForRestaurant.calls[0][1].metadata;

    expect(meta.crossedAt).toBe(new Date(CROSSED_AT).toISOString());
    expect(meta.detectedAt).toBe(NOW.toISOString());
    // 2 September 23:04 New York against a 30 September deadline.
    expect(meta.earlyByDays).toBe(27);
    expect(meta.earlinessPhrase).toBe("27 days early");
    expect(meta.onShift).toEqual([
      { memberId: "member-1", name: "Ada Lovelace", role: "floor" },
    ]);
    expect(meta.onShiftSource).toMatch(/not a clock-in record/);

    const message = notifications.persistForRestaurant.calls[0][1].message;
    expect(message).toContain("27 days early");
    expect(message).toContain("Ada Lovelace (floor)");
  });

  it("[REVERT-FAILS] says the crossing time is unknown rather than reporting the sweep time as it", async () => {
    const { db, notifications, producer } = build(REACHED);
    db.tables.analytics_goals.push(goalRow());
    // No pos_checks row: the source cannot say when the metric last moved.

    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    const call = notifications.persistForRestaurant.calls[0][1];
    expect(call.metadata.crossedAt).toBeNull();
    expect(call.metadata.crossedAtSource).toMatch(/could not be read/);
    expect(call.metadata.earlyByDays).toBeNull();
    expect(call.message).toContain("could not be read from the source");
  });

  it("does not write for a goal that has not reached its target", async () => {
    const { db, notifications, producer } = build({
      ...REACHED,
      current: 4000,
    });
    db.tables.analytics_goals.push(goalRow());
    const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
    expect(tally.withheldReason).toBe("No active goal has reached its target.");
  });

  it("[REVERT-FAILS] an at-most ceiling is not a success and is named, not silently skipped", async () => {
    const { db, notifications, producer } = build(REACHED);
    db.tables.analytics_goals.push(
      goalRow({ direction: "at_most", metric_key: "purchase_spend" }),
    );
    const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
    expect(tally.withheldReason).toMatch(/ceilings this producer does not report/);
  });

  it("with no active goal it says so rather than reporting an empty sweep", async () => {
    const { producer } = build(REACHED);
    const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(tally.withheldReason).toMatch(/No active goal is set/);
  });

  it("throws when the goals table cannot be read — never 'no goals'", async () => {
    const { db, producer } = build(REACHED);
    db.failures.analytics_goals = "statement timeout";
    await expect(
      producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW),
    ).rejects.toThrow(/analytics_goals/);
  });

  // F-629: an average is a level over the window, not a running total.
  const AVERAGE = {
    target: 85,
    current: 120,
    metricLabel: "Average check",
    unit: "currency",
  };

  it("[REVERT-FAILS] does not call an average reached while its window is still open", async () => {
    const { db, notifications, goals, producer } = build(AVERAGE);
    db.tables.analytics_goals.push(
      goalRow({
        name: "Average check",
        metric_key: "avg_check",
        target_value: 85,
      }),
    );
    seedCrossing(db);
    seedShift(db);

    const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);

    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
    expect(goals.getGoalProgress.calls).toHaveLength(0);
    expect(tally.withheldReason).toMatch(/judged only over a whole window/);
  });

  it("[REVERT-FAILS] does not judge an average with no deadline", async () => {
    const { db, notifications, producer } = build(AVERAGE);
    db.tables.analytics_goals.push(
      goalRow({ metric_key: "wine_attach_rate", deadline: null }),
    );
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
  });

  it("calls an average reached once its deadline has passed, with no crossing time or roster", async () => {
    const { db, notifications, producer } = build(AVERAGE);
    db.tables.analytics_goals.push(
      goalRow({
        name: "Average check",
        metric_key: "avg_check",
        target_value: 85,
        deadline: "2026-09-01",
      }),
    );
    seedCrossing(db);
    seedShift(db);

    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);

    const call = notifications.persistForRestaurant.calls[0][1];
    expect(call.metadata.crossedAt).toBeNull();
    expect(call.metadata.crossedAtSource).toMatch(/a level has no single row/);
    expect(call.metadata.onShift).toEqual([]);
    expect(call.message).toContain("no single moment it crossed");
    expect(call.message).not.toContain("could not be read");
  });

  it("[REVERT-FAILS] does not judge days of stock after its deadline", async () => {
    const { db, notifications, producer } = build({
      target: 20,
      current: 25,
      metricLabel: "Days of stock",
      unit: "days",
    });
    db.tables.analytics_goals.push(
      goalRow({
        metric_key: "days_of_inventory",
        target_value: 20,
        deadline: "2026-08-31",
      }),
    );
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
  });

  it("[REVERT-FAILS] writes no emoji into the title or the message", async () => {
    const { db, notifications, producer } = build(REACHED);
    db.tables.analytics_goals.push(goalRow());
    seedCrossing(db);
    seedShift(db);
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    const call = notifications.persistForRestaurant.calls[0][1];
    const emoji =
      /(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]|\u{FE0F}|\u{20E3})/u;
    expect(emoji.test(call.title)).toBe(false);
    expect(emoji.test(call.message)).toBe(false);
  });
});

describe("shift-window (the smallest read there was not one of)", () => {
  it("a shift that ends before it starts crosses midnight", () => {
    const w = shiftWindow(
      { shift_date: "2026-09-02", start_time: "17:00", end_time: "01:00" },
      ZONE,
    )!;
    expect(w.start.toISOString()).toBe("2026-09-02T21:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-09-03T05:00:00.000Z");
  });

  it("[REVERT-FAILS] equal start and end times are a moment that day, not 24 hours", () => {
    const w = shiftWindow(
      { shift_date: "2026-09-02", start_time: "10:00", end_time: "10:00" },
      ZONE,
    )!;
    expect(w.start.toISOString()).toBe("2026-09-02T14:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-09-02T14:00:00.000Z");
    // Read as 24 hours, this row would name m1 at 23:00 that night.
    const on = onShiftAt(
      [
        {
          member_id: "m1",
          shift_date: "2026-09-02",
          start_time: "10:00",
          end_time: "10:00",
          state: "scheduled",
        },
      ],
      new Date("2026-09-03T03:00:00Z"),
      ZONE,
    );
    expect(on).toEqual([]);
  });

  it("[REVERT-FAILS] an open or called-out shift is the absence of a person", () => {
    const rows = [
      { member_id: "m1", shift_date: "2026-09-02", start_time: "17:00", end_time: "23:59", state: "open" },
      { member_id: "m2", shift_date: "2026-09-02", start_time: "17:00", end_time: "23:59", state: "callout" },
      { member_id: "m3", shift_date: "2026-09-02", start_time: "17:00", end_time: "23:59", state: "covered" },
    ];
    const on = onShiftAt(rows, new Date("2026-09-03T02:00:00Z"), ZONE);
    expect(on.map((p) => p.memberId)).toEqual(["m3"]);
  });

  it("the window is half-open, so a handover is not two people", () => {
    const rows = [
      { member_id: "m1", shift_date: "2026-09-02", start_time: "11:00", end_time: "17:00", state: "scheduled" },
      { member_id: "m2", shift_date: "2026-09-02", start_time: "17:00", end_time: "23:00", state: "scheduled" },
    ];
    // 17:00 New York on 2 September = 21:00 UTC.
    const on = onShiftAt(rows, new Date("2026-09-02T21:00:00Z"), ZONE);
    expect(on.map((p) => p.memberId)).toEqual(["m2"]);
  });

  it("a member with two overlapping rows is one person", () => {
    const rows = [
      { member_id: "m1", shift_date: "2026-09-02", start_time: "17:00", end_time: "23:00", role: "bar", state: "scheduled" },
      { member_id: "m1", shift_date: "2026-09-02", start_time: "18:00", end_time: "22:00", role: "floor", state: "covered" },
    ];
    const on = onShiftAt(rows, new Date("2026-09-02T23:00:00Z"), ZONE);
    expect(on).toEqual([{ memberId: "m1", role: "bar" }]);
  });
});
