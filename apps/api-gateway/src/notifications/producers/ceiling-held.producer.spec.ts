/**
 * The ceiling producer: the success a ceiling goal has is not a crossing, it is
 * a period that ran out with the house still under.
 */

import { CeilingHeldProducer } from "./ceiling-held.producer";
import { ProducerLedgerService } from "./producer-ledger.service";
import {
  FakeDb,
  fakeDatabase,
  fakeNotifications,
  recorder,
} from "./testing/fake-db";

const TENANT = "rest-1";
const OTHER = "rest-2";
const MEMBERS = ["user-1", "user-2"];
const ZONE = "America/New_York";
const AUDIENCE = { ready: [...MEMBERS], deferred: [] as string[] };

/** The period ends at local midnight opening 1 October = 04:00 UTC. */
const CLOSED_AT = "2026-10-01T04:00:00.000Z";
const NOW = new Date("2026-10-01T12:00:00Z");

function build(progress: any) {
  const db = new FakeDb();
  const database = fakeDatabase(db, MEMBERS);
  const notifications = fakeNotifications(MEMBERS);
  const ledger = new ProducerLedgerService(
    database as any,
    notifications as any,
  );
  const goals = { getGoalProgress: recorder(async () => progress) };
  const producer = new CeilingHeldProducer(
    database as any,
    goals as any,
    ledger,
  );
  return { db, notifications, goals, producer };
}

function ceiling(over: Record<string, any> = {}) {
  return {
    id: "goal-1",
    restaurant_id: TENANT,
    name: "September purchasing",
    metric_key: "purchase_spend",
    target_value: 10000,
    direction: "at_most",
    deadline: "2026-09-30",
    status: "active",
    ...over,
  };
}

const HELD = {
  target: 10000,
  current: 8420,
  metricLabel: "Purchasing spend",
  unit: "currency",
};

function seedShift(db: FakeDb) {
  // 17:00–01:00 on 30 September covers local midnight, so the close has a crew.
  db.tables.shifts.push({
    restaurant_id: TENANT,
    member_id: "member-1",
    shift_date: "2026-09-30",
    start_time: "17:00",
    end_time: "01:00",
    role: "bar",
    state: "scheduled",
  });
  db.tables.team_members.push({
    id: "member-1",
    restaurant_id: TENANT,
    display_name: "Grace Hopper",
  });
}

describe("CeilingHeldProducer", () => {
  it("reports a period that closed under the ceiling, with the headroom", async () => {
    const { db, notifications, producer } = build(HELD);
    db.tables.analytics_goals.push(ceiling());
    seedShift(db);

    const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(tally.emitted).toBe(2);

    const call = notifications.persistForRestaurant.calls[0][1];
    expect(call.title).toBe("September purchasing stayed under its ceiling");
    expect(call.message).toContain("stayed under by $1,580.00");
    expect(call.message).toContain(
      "Purchasing spend finished at $8,420.00 against a ceiling of $10,000.00 — 16% of it unused.",
    );
    expect(call.message).toContain("Grace Hopper (bar)");
    // The register `nt-format.ts:112` already carries; a new word would file
    // this row under "Other".
    expect(call.type).toBe("goal_reached");
  });

  it("[REVERT-FAILS] carries the same provenance keys the crossing producer does", async () => {
    const { db, notifications, producer } = build(HELD);
    db.tables.analytics_goals.push(ceiling());
    seedShift(db);
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    const meta = notifications.persistForRestaurant.calls[0][1].metadata;

    for (const key of [
      "goalId",
      "metricKey",
      "metricLabel",
      "unit",
      "target",
      "current",
      "direction",
      "deadline",
      "detectedAt",
      "onShift",
      "onShiftSource",
      "timeZone",
    ]) {
      expect(Object.keys(meta)).toContain(key);
    }
    expect(meta.direction).toBe("at_most");
    expect(meta.periodEndedAt).toBe(CLOSED_AT);
    expect(meta.periodEndSource).toMatch(/restaurant's timezone/);
    expect(meta.detectedAt).toBe(NOW.toISOString());
    expect(meta.headroom).toBe(1580);
    expect(meta.headroomFraction).toBeCloseTo(0.158);
    expect(meta.onShift).toEqual([
      { memberId: "member-1", name: "Grace Hopper", role: "bar" },
    ]);
  });

  it("[REVERT-FAILS] the period closes on the HOUSE's clock, not the server's", async () => {
    const { db, notifications, producer } = build(HELD);
    db.tables.analytics_goals.push(ceiling());

    // 00:30 UTC on 1 October is still 20:30 on 30 September in New York — the
    // period has not closed. A UTC-midnight rule would have fired here.
    const tooEarly = new Date("2026-10-01T00:30:00Z");
    const early = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, tooEarly);
    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
    expect(early.withheldReason).toMatch(/period has not closed yet/);

    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(notifications.persistForRestaurant.calls).toHaveLength(1);
  });

  it("[REVERT-FAILS] a second sweep of the same closed period writes nothing", async () => {
    const { db, notifications, producer } = build(HELD);
    db.tables.analytics_goals.push(ceiling());
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    const second = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(notifications.persistForRestaurant.calls).toHaveLength(1);
    expect(second.emitted).toBe(0);
    expect(second.alreadyClaimed).toBe(1);
    expect(db.tables.notification_producer_claims[0].dedupe_key).toBe(
      "goal:goal-1:2026-09-30",
    );
  });

  it("a new period on the same goal is a new line", async () => {
    const { db, notifications, producer } = build(HELD);
    db.tables.analytics_goals.push(ceiling());
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);

    // The manager rolls the ceiling forward to the end of October.
    db.tables.analytics_goals[0].deadline = "2026-10-31";
    await producer.sweepTenant(
      TENANT,
      ZONE,
      AUDIENCE,
      new Date("2026-11-01T12:00:00Z"),
    );
    expect(notifications.persistForRestaurant.calls).toHaveLength(2);
  });

  it("[REVERT-FAILS] never reads another restaurant's goals", async () => {
    const { db, notifications, producer } = build(HELD);
    db.tables.analytics_goals.push(ceiling({ id: "theirs", restaurant_id: OTHER }));
    const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
    expect(tally.withheldReason).toMatch(/No active 'at most' goal/);
  });

  it("[REVERT-FAILS] a breached ceiling is named, not reported as a success", async () => {
    const { db, notifications, producer } = build({ ...HELD, current: 11500 });
    db.tables.analytics_goals.push(ceiling());
    const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
    expect(tally.withheldReason).toMatch(/closed OVER the ceiling/);
  });

  it("[REVERT-FAILS] exactly at the ceiling is under it, not over", async () => {
    const { db, notifications, producer } = build({ ...HELD, current: 10000 });
    db.tables.analytics_goals.push(ceiling());
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    const call = notifications.persistForRestaurant.calls[0][1];
    expect(call.metadata.headroom).toBe(0);
    expect(call.message).toContain("stayed under by $0.00");
  });

  it("ignores an at-least goal — that one belongs to the crossing producer", async () => {
    const { db, notifications, producer } = build(HELD);
    db.tables.analytics_goals.push(ceiling({ direction: "at_least" }));
    const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
    expect(tally.withheldReason).toMatch(/No active 'at most' goal/);
  });

  it("does not replay a period that closed long before this producer was armed", async () => {
    const { db, notifications, producer } = build(HELD);
    db.tables.analytics_goals.push(ceiling());
    const muchLater = new Date("2026-11-30T12:00:00Z");
    const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, muchLater);
    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
    expect(tally.withheldReason).toMatch(/more than 14 days ago/);
  });

  it("skips a deadline it cannot read rather than guessing one", async () => {
    const { db, notifications, producer } = build(HELD);
    db.tables.analytics_goals.push(ceiling({ deadline: "whenever" }));
    const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
    expect(tally.failed).toBe(1);
  });

  it("says the schedule names nobody rather than claiming nobody worked", async () => {
    const { db, notifications, producer } = build(HELD);
    db.tables.analytics_goals.push(ceiling());
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    const call = notifications.persistForRestaurant.calls[0][1];
    expect(call.message).toContain("The schedule names nobody on shift");
    expect(call.metadata.onShift).toEqual([]);
  });

  it("throws when the goals table cannot be read — never 'no ceilings'", async () => {
    const { db, producer } = build(HELD);
    db.failures.analytics_goals = "statement timeout";
    await expect(
      producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW),
    ).rejects.toThrow(/analytics_goals/);
  });

  it("[REVERT-FAILS] writes no emoji", async () => {
    const { db, notifications, producer } = build(HELD);
    db.tables.analytics_goals.push(ceiling());
    seedShift(db);
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    const call = notifications.persistForRestaurant.calls[0][1];
    const emoji =
      /(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]|\u{FE0F}|\u{20E3})/u;
    expect(emoji.test(call.title)).toBe(false);
    expect(emoji.test(call.message)).toBe(false);
  });
});
