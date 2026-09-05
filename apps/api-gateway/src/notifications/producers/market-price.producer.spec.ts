/**
 * The market signal, and the two things it adds to the read the page's box
 * already calls: it narrows to what this house BUYS, and it refuses a drop so
 * large it reads as a bad parse.
 */

import { MarketPriceProducer } from "./market-price.producer";
import { ProducerLedgerService } from "./producer-ledger.service";
import {
  FakeDb,
  fakeDatabase,
  fakeNotifications,
  fixedClock,
  recorder,
} from "./testing/fake-db";
import {
  DEFAULT_DROP_THRESHOLD,
  IMPLAUSIBLE_DROP_CEILING,
  SIGNAL_WINDOW_DAYS,
  decideSignal,
  readThreshold,
} from "./market-signal";

const TENANT = "rest-1";
const OTHER = "rest-2";
const MEMBERS = ["user-1", "user-2"];
const ZONE = "America/New_York";
const AUDIENCE = { ready: [...MEMBERS], deferred: [] as string[] };
const NOW = new Date("2026-09-03T14:00:00Z");

function rankedItem(over: Record<string, any> = {}) {
  return {
    productKey: "wine:mw-1",
    productName: "Domaine Vacheron Sancerre 2022",
    currency: "USD",
    latest: {
      unitPrice: 42,
      observedAt: "2026-09-03T09:00:00Z",
      vendorName: "Vintner Select",
      sourceType: "website_scrape",
    },
    average: {
      unitPrice: 51.2,
      observations: 9,
      from: "2026-08-06T00:00:00Z",
      to: "2026-09-01T00:00:00Z",
    },
    absoluteBelow: 9.2,
    fractionBelow: 0.1796875,
    ...over,
  };
}

function build(
  items: any[] = [rankedItem()],
  env: Record<string, any> = {},
  startAt: Date = NOW,
) {
  const db = new FakeDb();
  const database = fakeDatabase(db, MEMBERS);
  const notifications = fakeNotifications(MEMBERS);
  // EVERY instant in this suite comes from here. Before 2026-09-04 the ledger
  // stamped `claimed_at` from the wall clock while the suppression window came
  // from the fixed NOW below, so the outcome depended on the machine date.
  const clock = fixedClock(startAt);
  const ledger = new ProducerLedgerService(
    database as any,
    notifications as any,
    clock,
  );
  const comparison = {
    belowTrailingAverage: recorder(async () => ({
      items,
      scanned: { observations: 220, products: 14 },
      skipped: {
        noProductKey: 0,
        unnormalisable: 0,
        thinHistory: 2,
        mixedCurrency: 0,
        notBelow: 5,
      },
      averageExcludesLatest: true as const,
      minObservations: 3,
      window: { days: 30, from: "2026-08-04T14:00:00Z" },
    })),
  };
  const config = { get: (k: string) => env[k] };
  const producer = new MarketPriceProducer(
    database as any,
    comparison as any,
    ledger,
    config as any,
  );
  /** Sweep at an instant, keeping the clock and the sweep's `now` in step. */
  const sweepAt = (at: Date) => {
    clock.advanceTo(at);
    return producer.sweepTenant(TENANT, ZONE, AUDIENCE, at);
  };

  return { db, notifications, comparison, producer, clock, sweepAt };
}

function bought(db: FakeDb, over: Record<string, any> = {}) {
  db.tables.procurement_orders.push({
    id: "order-1",
    restaurant_id: TENANT,
    created_at: "2026-08-20T00:00:00Z",
  });
  db.tables.procurement_order_items.push({
    order_id: "order-1",
    master_wine_id: "mw-1",
    producer: "Domaine Vacheron",
    wine_name: "Sancerre 2022",
    ...over,
  });
}

describe("MarketPriceProducer", () => {
  it("writes the founder's sentence for a product this house buys", async () => {
    const { db, notifications, comparison, producer } = build();
    bought(db);

    const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(tally.emitted).toBe(2);
    // The SAME read the page's market box calls — not a second arithmetic.
    expect(comparison.belowTrailingAverage.calls).toHaveLength(1);
    expect(comparison.belowTrailingAverage.calls[0][0]).toMatchObject({
      restaurantId: TENANT,
      windowDays: 30,
      minObservations: 3,
    });

    const call = notifications.persistForRestaurant.calls[0][1];
    expect(call.title).toBe(
      "Domaine Vacheron Sancerre 2022 is 18% below its 30-day average",
    );
    expect(call.message).toContain(
      "Vintner Select is quoting $42.00 for Domaine Vacheron Sancerre 2022, against a 30-day average of $51.20 across 9 earlier sightings.",
    );
    expect(call.message).toContain("A good time to buy, on price alone.");
    expect(call.metadata.thresholdPct).toBe(DEFAULT_DROP_THRESHOLD);
    expect(call.metadata.thresholdSource).toBe("default");
    // The type the page's register map already carries (nt-format.ts:98).
    expect(call.type).toBe("price_change");
    expect(call.actionUrl).toBe("/vendor-prices?product=wine%3Amw-1");
  });

  it("[REVERT-FAILS] a second sweep on the same day writes nothing", async () => {
    const { db, notifications, sweepAt } = build();
    bought(db);
    await sweepAt(NOW);
    const second = await sweepAt(NOW);
    expect(notifications.persistForRestaurant.calls).toHaveLength(1);
    expect(second.emitted).toBe(0);
    expect(second.alreadyClaimed).toBe(1);
  });

  it("[REVERT-FAILS] stays quiet about the same product for a week", async () => {
    const { db, notifications, sweepAt } = build();
    bought(db);
    await sweepAt(NOW);
    // Three days later — a new dedupe key, but inside the suppression window.
    const tally = await sweepAt(new Date(NOW.getTime() + 3 * 86_400_000));
    expect(notifications.persistForRestaurant.calls).toHaveLength(1);
    expect(tally.alreadyClaimed).toBe(1);

    // Eight days later — outside it, and the house hears about it again.
    await sweepAt(new Date(NOW.getTime() + 8 * 86_400_000));
    expect(notifications.persistForRestaurant.calls).toHaveLength(2);
    expect(SIGNAL_WINDOW_DAYS).toBe(7);
  });

  it("[REVERT-FAILS] the suppression window is measured against the sweep, not the machine date", async () => {
    // THE 2026-09-04 REGRESSION, PINNED. This suite fixes NOW at
    // 2026-09-03T14:00Z and sweeps a third time at NOW + 8 days. When
    // `claimed_at` came from the wall clock, the claim written by sweep one
    // carried the REAL date: before 2026-09-04T14:00Z it fell outside the
    // seven-day window and the third sweep wrote; from 2026-09-04T14:00Z it
    // fell inside, the sweep suppressed, and the assertion above went red
    // having changed nothing. The test was measuring the calendar.
    //
    // Running the WHOLE sequence under two clocks a year apart proves the
    // outcome is a property of the code. If either stamp escapes to the wall
    // clock again, exactly one of these two runs breaks.
    const runUnder = async (startAt: Date) => {
      const { db, notifications, sweepAt } = build([rankedItem()], {}, startAt);
      bought(db);
      const first = await sweepAt(startAt);
      const inside = await sweepAt(new Date(startAt.getTime() + 3 * 86_400_000));
      const after = await sweepAt(new Date(startAt.getTime() + 8 * 86_400_000));
      return {
        writes: notifications.persistForRestaurant.calls.length,
        claimedAt: db.tables.notification_producer_claims.map(
          (r: any) => r.claimed_at,
        ),
        tallies: [first.emitted, inside.alreadyClaimed, after.emitted],
      };
    };

    const past = await runUnder(new Date("2025-01-15T09:00:00Z"));
    const future = await runUnder(new Date("2027-11-02T22:30:00Z"));

    expect(past.writes).toBe(2);
    expect(future.writes).toBe(2);
    expect(past.tallies).toEqual(future.tallies);
    expect(past.tallies).toEqual([2, 1, 2]);

    // …and every stamp came from the injected clock, not from today.
    const today = new Date().toISOString().slice(0, 10);
    for (const stamp of [...past.claimedAt, ...future.claimedAt]) {
      expect(stamp.slice(0, 10)).not.toBe(today);
    }
    expect(past.claimedAt.every((t: string) => t.startsWith("2025-"))).toBe(true);
    expect(future.claimedAt.every((t: string) => t.startsWith("2027-"))).toBe(
      true,
    );
  });

  it("[REVERT-FAILS] says nothing about a product this house has never bought", async () => {
    const { db, notifications, producer } = build();
    db.tables.procurement_orders.push({
      id: "order-1",
      restaurant_id: TENANT,
      created_at: "2026-08-20T00:00:00Z",
    });
    db.tables.procurement_order_items.push({
      order_id: "order-1",
      master_wine_id: "mw-999",
      wine_name: "Something else",
    });
    const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
    expect(tally.withheldReason).toMatch(/never bought/);
  });

  it("[REVERT-FAILS] never reads another restaurant's orders for the product set", async () => {
    const { db, notifications, producer } = build();
    db.tables.procurement_orders.push({
      id: "order-x",
      restaurant_id: OTHER,
      created_at: "2026-08-20T00:00:00Z",
    });
    db.tables.procurement_order_items.push({
      order_id: "order-x",
      master_wine_id: "mw-1",
      wine_name: "Their bottle",
    });
    const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
    expect(tally.withheldReason).toMatch(/No order line with a library identity/);
  });

  it("[REVERT-FAILS] refuses a drop so large it reads as a bad parse, and says why", async () => {
    const { db, notifications, producer } = build([
      rankedItem({ fractionBelow: 0.92, latest: { unitPrice: 4.1, observedAt: "2026-09-03T09:00:00Z", vendorName: "Scraped Co", sourceType: "website_scrape" } }),
    ]);
    bought(db);
    const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
    expect(tally.withheldReason).toMatch(/refused as a probable bad parse/);
  });

  it("does not interrupt for a movement under the house's threshold", async () => {
    const { db, notifications, producer } = build([
      rankedItem({ fractionBelow: 0.04 }),
    ]);
    bought(db);
    const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
    expect(tally.withheldReason).toMatch(/below the 10% this house asks for/);
  });

  it("honours an env threshold and records that the deployment set it", async () => {
    const { db, notifications, producer } = build(
      [rankedItem({ fractionBelow: 0.04 })],
      { MARKET_SIGNAL_DROP_PCT: "3" },
    );
    bought(db);
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    const meta = notifications.persistForRestaurant.calls[0][1].metadata;
    expect(meta.thresholdPct).toBeCloseTo(0.03);
    expect(meta.thresholdSource).toBe("env");
  });

  it("[REVERT-FAILS] names the churn caveat the engine warns about", async () => {
    const { db, notifications, producer } = build();
    bought(db);
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(notifications.persistForRestaurant.calls[0][1].message).toContain(
      "a cheaper vendor appearing reads the same as a price falling",
    );
  });

  it("throws when the house's own orders cannot be read", async () => {
    const { db, producer } = build();
    db.failures.procurement_orders = "statement timeout";
    await expect(
      producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW),
    ).rejects.toThrow(/procurement_orders/);
  });

  it("[REVERT-FAILS] writes no emoji", async () => {
    const { db, notifications, producer } = build();
    bought(db);
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    const call = notifications.persistForRestaurant.calls[0][1];
    const emoji =
      /(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]|\u{FE0F}|\u{20E3})/u;
    expect(emoji.test(call.title)).toBe(false);
    expect(emoji.test(call.message)).toBe(false);
  });
});

describe("market-signal — the rules, without a database", () => {
  it("a threshold may be a fraction or a percent", () => {
    expect(readThreshold("0.15")).toEqual({ value: 0.15, source: "env" });
    expect(readThreshold("15")).toEqual({ value: 0.15, source: "env" });
  });

  it("[REVERT-FAILS] a refused threshold is reported as the default, not as the deployment's", () => {
    for (const raw of [undefined, "", "nonsense", "0", "-4", "200", "0.5%"]) {
      const read = readThreshold(raw);
      expect(read.value).toBe(DEFAULT_DROP_THRESHOLD);
      expect(read.source).toBe("default");
    }
  });

  it("every verdict carries a reason", () => {
    expect(decideSignal(0.18, 0.1)).toEqual({
      verdict: "notify",
      reason: "The latest sighting is 18.0% below the trailing average.",
    });
    expect(decideSignal(0.04, 0.1).verdict).toBe("below_floor");
    expect(decideSignal(0, 0.1).reason).toMatch(/at or above/);
    expect(decideSignal(null, 0.1).verdict).toBe("below_floor");
    const implausible = decideSignal(0.9, 0.1);
    expect(implausible.verdict).toBe("implausible");
    expect(implausible.reason).toMatch(/probable bad parse/);
    expect(IMPLAUSIBLE_DROP_CEILING).toBe(0.6);
  });

  it("the ceiling sits above the threshold, so the two cannot swallow each other", () => {
    expect(IMPLAUSIBLE_DROP_CEILING).toBeGreaterThan(DEFAULT_DROP_THRESHOLD);
  });
});
