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

const TENANT = "rest-1";
const OTHER = "rest-2";
const MEMBERS = ["user-1", "user-2"];
const ZONE = "America/New_York";
const AUDIENCE = { ready: [...MEMBERS], deferred: [] as string[] };

function build(progress: any) {
  const db = new FakeDb();
  const database = fakeDatabase(db, MEMBERS);
  const notifications = fakeNotifications(MEMBERS);
  const ledger = new ProducerLedgerService(
    database as any,
    notifications as any,
  );
  const goals = {
    getGoalProgress: recorder(async () => progress),
  };
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
