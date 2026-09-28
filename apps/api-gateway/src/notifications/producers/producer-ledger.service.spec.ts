/**
 * The ledger — the only thing in this directory that writes.
 *
 * Everything the five producers claim about never speaking twice reduces to
 * these cases, so they are proven here once, against a fake that enforces the
 * UNIQUE `(restaurant_id, producer, dedupe_key, user_id)` index rather than a
 * stub that says "inserted" to everything.
 */

import { ProducerLedgerService, emptyTally } from "./producer-ledger.service";
import {
  FakeDb,
  fakeDatabase,
  fakeNotifications,
  recorder,
} from "./testing/fake-db";

const TENANT = "rest-1";
const OTHER = "rest-2";
const MEMBERS = ["user-1", "user-2"];

function build(members: string[] = MEMBERS, insertedOverride?: () => number | null) {
  const db = new FakeDb();
  const database = fakeDatabase(db, members);
  const notifications = fakeNotifications(members, insertedOverride);
  const service = new ProducerLedgerService(
    database as any,
    notifications as any,
  );
  return { db, database, notifications, service };
}

function event(over: Partial<{ dedupeKey: string; occurredAt: Date }> = {}) {
  return {
    dedupeKey: over.dedupeKey ?? "thing:1",
    occurredAt: over.occurredAt ?? new Date("2026-09-02T23:04:00Z"),
    payload: {
      type: "goal_reached",
      title: "A goal reached its target",
      message: "Stated as a fact.",
    },
  };
}

describe("ProducerLedgerService.audienceFor", () => {
  it("splits members by quiet hours on the RESTAURANT's clock, not the server's", async () => {
    const { db, service } = build();
    db.tables.notification_preferences.push({
      user_id: "user-1",
      restaurant_id: TENANT,
      quiet_hours_enabled: true,
      quiet_hours_start: "22:00",
      quiet_hours_end: "08:00",
    });

    // 03:00 UTC is 23:00 in New York — inside user-1's window.
    const audience = await service.audienceFor(
      TENANT,
      "America/New_York",
      new Date("2026-09-03T03:00:00Z"),
    );
    expect(audience.deferred).toEqual(["user-1"]);
    expect(audience.ready).toEqual(["user-2"]);
  });

  it("[REVERT-FAILS] a member with no preferences row is awake, not suppressed", async () => {
    const { service } = build();
    const audience = await service.audienceFor(
      TENANT,
      "UTC",
      new Date("2026-09-03T03:00:00Z"),
    );
    expect(audience.ready).toEqual(MEMBERS);
    expect(audience.deferred).toEqual([]);
  });

  it("throws when preferences cannot be read — never silently wakes or silences", async () => {
    const { db, service } = build();
    db.failures.notification_preferences = "connection reset";
    await expect(
      service.audienceFor(TENANT, "UTC", new Date()),
    ).rejects.toThrow(/notification_preferences/);
  });
});

describe("ProducerLedgerService.emit", () => {
  it("writes once, and a second sweep of the same event writes nothing", async () => {
    const { db, notifications, service } = build();
    const audience = { ready: [...MEMBERS], deferred: [] };

    const first = await service.emit(
      { restaurantId: TENANT, producer: "goal_reached", audience, tally: emptyTally() },
      event(),
    );
    expect(first).toBe("written");
    expect(notifications.persistForRestaurant.calls).toHaveLength(1);

    const tally = emptyTally();
    const second = await service.emit(
      { restaurantId: TENANT, producer: "goal_reached", audience, tally },
      event(),
    );
    expect(second).toBe("already_claimed");
    // THE ASSERTION THIS WHOLE FILE EXISTS FOR: no second write.
    expect(notifications.persistForRestaurant.calls).toHaveLength(1);
    expect(tally.alreadyClaimed).toBe(1);
    expect(db.tables.notification_producer_claims).toHaveLength(2);
  });

  it("[REVERT-FAILS] the claim is per person, so a deferred member is served by a later sweep", async () => {
    const { notifications, service } = build();
    const producer = "goal_reached";

    // First sweep: user-2 is asleep.
    await service.emit(
      {
        restaurantId: TENANT,
        producer,
        audience: { ready: ["user-1"], deferred: ["user-2"] },
        tally: emptyTally(),
      },
      event(),
    );
    expect(notifications.persistForRestaurant.calls[0][2].onlyUserIds).toEqual([
      "user-1",
    ]);

    // Second sweep, same event, user-2 now awake. A per-EVENT claim would have
    // marked this finished and lost them the record entirely.
    const outcome = await service.emit(
      {
        restaurantId: TENANT,
        producer,
        audience: { ready: MEMBERS, deferred: [] },
        tally: emptyTally(),
      },
      event(),
    );
    expect(outcome).toBe("written");
    expect(notifications.persistForRestaurant.calls).toHaveLength(2);
    expect(notifications.persistForRestaurant.calls[1][2].onlyUserIds).toEqual([
      "user-2",
    ]);
  });

  it("[REVERT-FAILS] the same dedupe key in another restaurant is a different event", async () => {
    const { db, notifications, service } = build();
    const audience = { ready: [...MEMBERS], deferred: [] };
    await service.emit(
      { restaurantId: TENANT, producer: "goal_reached", audience, tally: emptyTally() },
      event(),
    );
    await service.emit(
      { restaurantId: OTHER, producer: "goal_reached", audience, tally: emptyTally() },
      event(),
    );
    expect(notifications.persistForRestaurant.calls).toHaveLength(2);
    expect(notifications.persistForRestaurant.calls[0][0]).toBe(TENANT);
    expect(notifications.persistForRestaurant.calls[1][0]).toBe(OTHER);
    expect(db.tables.notification_producer_claims).toHaveLength(4);
  });

  it("the same key under a different producer is a different event", async () => {
    const { notifications, service } = build();
    const audience = { ready: [...MEMBERS], deferred: [] };
    await service.emit(
      { restaurantId: TENANT, producer: "goal_reached", audience, tally: emptyTally() },
      event(),
    );
    await service.emit(
      { restaurantId: TENANT, producer: "sale_record", audience, tally: emptyTally() },
      event(),
    );
    expect(notifications.persistForRestaurant.calls).toHaveLength(2);
  });

  it("[REVERT-FAILS] releases its claims when the funnel wrote nothing, so the next sweep retries", async () => {
    const { db, notifications, service } = build(MEMBERS, () => 0);
    const tally = emptyTally();
    const outcome = await service.emit(
      { restaurantId: TENANT, producer: "goal_reached", audience: { ready: MEMBERS, deferred: [] }, tally },
      event(),
    );
    expect(outcome).toBe("failed");
    expect(tally.failed).toBe(1);
    expect(tally.emitted).toBe(0);
    // Nothing was written, so nothing may stay claimed.
    expect(db.tables.notification_producer_claims).toHaveLength(0);
    expect(notifications.persistForRestaurant.calls).toHaveLength(1);
  });

  it("does not write when the claim query itself fails", async () => {
    const { db, notifications, service } = build();
    db.failures.notification_producer_claims = "deadlock detected";
    const tally = emptyTally();
    const outcome = await service.emit(
      { restaurantId: TENANT, producer: "goal_reached", audience: { ready: MEMBERS, deferred: [] }, tally },
      event(),
    );
    expect(outcome).toBe("failed");
    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
  });

  it("with nobody awake it writes nothing and says so, counting the deferral", async () => {
    const { notifications, service } = build();
    const tally = emptyTally();
    const outcome = await service.emit(
      { restaurantId: TENANT, producer: "goal_reached", audience: { ready: [], deferred: MEMBERS }, tally },
      event(),
    );
    expect(outcome).toBe("no_audience");
    expect(tally.deferredQuietHours).toBe(2);
    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
  });

  it("carries the EVENT's time in metadata, not the delivery time", async () => {
    const { notifications, service } = build();
    const occurredAt = new Date("2026-09-02T23:04:00Z");
    await service.emit(
      { restaurantId: TENANT, producer: "goal_reached", audience: { ready: MEMBERS, deferred: [] }, tally: emptyTally() },
      event({ occurredAt }),
    );
    const payload = notifications.persistForRestaurant.calls[0][1];
    expect(payload.metadata.occurredAt).toBe(occurredAt.toISOString());
    expect(payload.metadata.producer).toBe("goal_reached");
  });
});

describe("ProducerLedgerService run ledger", () => {
  it("lastRun is null when the producer has never run — a real answer", async () => {
    const { service } = build();
    await expect(service.lastRun(TENANT, "goal_reached")).resolves.toBeNull();
  });

  it("throws rather than answering null when the ledger cannot be read", async () => {
    const { db, service } = build();
    db.failures.notification_producer_runs = "permission denied";
    await expect(service.lastRun(TENANT, "goal_reached")).rejects.toThrow(
      /notification_producer_runs/,
    );
  });

  it("closeRun records the counts and the withheld reason", async () => {
    const { db, service } = build();
    const runId = await service.openRun(TENANT, "sale_record", new Date());
    const tally = emptyTally();
    tally.withheldReason = "No POS check has ever landed for this restaurant.";
    await service.closeRun(runId, tally, new Date(), null);
    const row = db.tables.notification_producer_runs[0];
    expect(row.finished_at).toBeTruthy();
    expect(row.withheld_reason).toMatch(/No POS check/);
    expect(row.emitted).toBe(0);
  });

  it("claimedKeysSince returns the keys this producer already said", async () => {
    const { service } = build();
    await service.emit(
      { restaurantId: TENANT, producer: "market_price", audience: { ready: MEMBERS, deferred: [] }, tally: emptyTally() },
      event({ dedupeKey: "product:wine:abc:2026-09-03" }),
    );
    const keys = await service.claimedKeysSince(
      TENANT,
      "market_price",
      new Date("2026-01-01T00:00:00Z"),
    );
    expect(keys.has("product:wine:abc:2026-09-03")).toBe(true);
  });

  it("recorder harness is load-bearing (the fake enforces the unique index)", async () => {
    // Proves the constraint the idempotency cases rest on is really enforced,
    // rather than the producer merely never trying twice.
    const { db } = build();
    const row = {
      restaurant_id: TENANT,
      producer: "p",
      dedupe_key: "k",
      user_id: "u",
    };
    const first = await db
      .from("notification_producer_claims")
      .upsert([row], { ignoreDuplicates: true })
      .select("id, user_id");
    expect(first.data).toHaveLength(1);
    const second = await db
      .from("notification_producer_claims")
      .upsert([row], { ignoreDuplicates: true })
      .select("id, user_id");
    expect(second.data).toHaveLength(0);
    expect(recorder).toBeInstanceOf(Function);
  });
});
