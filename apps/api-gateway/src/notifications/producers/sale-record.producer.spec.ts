/**
 * The service record, and the rule it exists to hold: a restaurant with no POS
 * gets NO ROW — not a zero, not an em dash, not "0 covers".
 */

import { SaleRecordProducer } from "./sale-record.producer";
import { ProducerLedgerService } from "./producer-ledger.service";
import { FakeDb, fakeDatabase, fakeNotifications } from "./testing/fake-db";
import {
  SETTLE_HOURS_AFTER_MIDNIGHT,
  localDateIn,
  serviceDaySettled,
  shiftLocalDate,
} from "./service-day";

const TENANT = "rest-1";
const OTHER = "rest-2";
const MEMBERS = ["user-1", "user-2"];
const ZONE = "America/New_York";
const AUDIENCE = { ready: [...MEMBERS], deferred: [] as string[] };

/** 2026-09-03 12:00 UTC = 08:00 New York — past the 06:00 settle margin. */
const NOW = new Date("2026-09-03T12:00:00Z");

function build() {
  const db = new FakeDb();
  const database = fakeDatabase(db, MEMBERS);
  const notifications = fakeNotifications(MEMBERS);
  const ledger = new ProducerLedgerService(
    database as any,
    notifications as any,
  );
  const producer = new SaleRecordProducer(database as any, ledger);
  db.tables.restaurants.push({ id: TENANT, operating_hours: null });
  return { db, notifications, producer };
}

/** A check inside the New York local day 2026-09-02. */
function check(over: Record<string, any> = {}) {
  return {
    restaurant_id: TENANT,
    voided: false,
    opened_at: "2026-09-03T00:30:00Z", // 20:30 on 2 September, New York
    closed_at: "2026-09-03T02:10:00Z",
    covers: 4,
    total: 218.4,
    items: [
      { name: "Sancerre 2022", qty: 2, price: 62 },
      { name: "Steak frites", qty: 4, price: 34 },
    ],
    ...over,
  };
}

describe("SaleRecordProducer", () => {
  it("[REVERT-FAILS] writes NO row when no POS has ever landed", async () => {
    const { db, notifications, producer } = build();
    db.tables.pos_checks.push(check());
    const tally = await producer.sweepTenant(
      TENANT,
      ZONE,
      AUDIENCE,
      NOW,
      false,
    );
    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
    expect(tally.emitted).toBe(0);
    expect(tally.withheldReason).toMatch(/No POS check has ever landed/);
    expect(tally.withheldReason).toMatch(/A zero here would be a claim/);
  });

  it("[REVERT-FAILS] a connected POS with no check on the day writes no zero record", async () => {
    const { notifications, producer } = build();
    const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW, true);
    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
    expect(tally.withheldReason).toMatch(
      /a closed day and a failed import look identical/,
    );
  });

  it("records the settled day with covers, revenue and the best seller", async () => {
    const { db, notifications, producer } = build();
    db.tables.pos_checks.push(check());
    db.tables.pos_checks.push(
      check({ covers: 2, total: 96, items: [{ name: "Sancerre 2022", qty: 1, price: 62 }] }),
    );
    const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW, true);

    expect(tally.emitted).toBe(2);
    const call = notifications.persistForRestaurant.calls[0][1];
    expect(call.title).toBe("Service record for 2026-09-02");
    expect(call.message).toContain("2 checks, $314.40.");
    expect(call.message).toContain("6 covers.");
    expect(call.message).toContain("Best seller by revenue: Sancerre 2022");
    expect(call.metadata.serviceDate).toBe("2026-09-02");
    expect(call.metadata.covers).toBe(6);
    expect(call.metadata.dayClosedRule).toBe("settle_after_midnight");
    // A record, not a summons — low priority keeps it out of the push fan-out.
    expect(call.priority).toBe("low");
    expect(call.type).toBe("service_closed");
  });

  it("[REVERT-FAILS] a second sweep of the same day writes nothing", async () => {
    const { db, notifications, producer } = build();
    db.tables.pos_checks.push(check());
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW, true);
    const second = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW, true);
    expect(notifications.persistForRestaurant.calls).toHaveLength(1);
    expect(second.emitted).toBe(0);
    expect(second.alreadyClaimed).toBeGreaterThan(0);
  });

  it("[REVERT-FAILS] never counts another restaurant's checks", async () => {
    const { db, notifications, producer } = build();
    db.tables.pos_checks.push(check({ restaurant_id: OTHER, total: 9999 }));
    const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW, true);
    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
    expect(tally.withheldReason).toMatch(/recorded no check/);
  });

  it("excludes voided checks from the revenue", async () => {
    const { db, notifications, producer } = build();
    db.tables.pos_checks.push(check());
    db.tables.pos_checks.push(check({ voided: true, total: 500, covers: 9 }));
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW, true);
    const meta = notifications.persistForRestaurant.calls[0][1].metadata;
    expect(meta.revenue).toBe(218.4);
    expect(meta.covers).toBe(4);
  });

  it("[REVERT-FAILS] covers are null when no check reported one, never zero", async () => {
    const { db, notifications, producer } = build();
    db.tables.pos_checks.push(check({ covers: null }));
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW, true);
    const call = notifications.persistForRestaurant.calls[0][1];
    expect(call.metadata.covers).toBeNull();
    expect(call.message).toContain("No check reported a cover count");
    expect(call.message).not.toContain("0 covers");
  });

  it("says how many checks lacked a cover count when only some did", async () => {
    const { db, notifications, producer } = build();
    db.tables.pos_checks.push(check());
    db.tables.pos_checks.push(check({ covers: null, total: 50 }));
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW, true);
    const call = notifications.persistForRestaurant.calls[0][1];
    expect(call.message).toContain("4 covers across the 1 checks that reported one; 1 did not.");
    expect(call.metadata.checksWithoutCovers).toBe(1);
  });

  it("[REVERT-FAILS] with no line detail there is no best seller to name", async () => {
    const { db, notifications, producer } = build();
    db.tables.pos_checks.push(check({ items: [] }));
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW, true);
    const call = notifications.persistForRestaurant.calls[0][1];
    expect(call.metadata.topItem).toBeNull();
    expect(call.message).toContain("no best seller to name");
  });

  it("does not write the day before it has settled", async () => {
    const { db, notifications, producer } = build();
    db.tables.pos_checks.push(check());
    // 2026-09-03 08:00 UTC = 04:00 New York, before the 06:00 margin.
    const early = new Date("2026-09-03T08:00:00Z");
    const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, early, true);
    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
    expect(tally.withheldReason).toMatch(/not settled until/);
  });

  it("throws when the checks cannot be read — never a zero-revenue record", async () => {
    const { db, producer } = build();
    db.failures.pos_checks = "statement timeout";
    await expect(
      producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW, true),
    ).rejects.toThrow(/pos_checks/);
  });

  it("[REVERT-FAILS] writes no emoji", async () => {
    const { db, notifications, producer } = build();
    db.tables.pos_checks.push(check());
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW, true);
    const call = notifications.persistForRestaurant.calls[0][1];
    const emoji =
      /(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]|\u{FE0F}|\u{20E3})/u;
    expect(emoji.test(call.title)).toBe(false);
    expect(emoji.test(call.message)).toBe(false);
  });
});

describe("service-day — when a day's data is in", () => {
  it("unknown hours settle a stated margin past local midnight, and say so", () => {
    const verdict = serviceDaySettled(null, ZONE, "2026-09-02", NOW);
    expect(verdict.rule).toBe("settle_after_midnight");
    expect(verdict.settled).toBe(true);
    expect(verdict.note).toMatch(/operating hours are not recorded/);
    // 2026-09-03 00:00 New York + 6h = 06:00 New York = 10:00 UTC.
    expect(verdict.settledAt.toISOString()).toBe("2026-09-03T10:00:00.000Z");
    expect(SETTLE_HOURS_AFTER_MIDNIGHT).toBe(6);
  });

  it("known hours settle an hour after the last window ends", () => {
    const hours = {
      mon: [], tue: [], wed: [{ open: "17:00", close: "23:00" }],
      thu: [], fri: [], sat: [], sun: [],
    };
    // 2026-09-02 is a Wednesday. 23:00 New York = 03:00 UTC on the 3rd; +1h.
    const verdict = serviceDaySettled(hours, ZONE, "2026-09-02", NOW);
    expect(verdict.rule).toBe("operating_hours");
    expect(verdict.settledAt.toISOString()).toBe("2026-09-03T04:00:00.000Z");
    expect(verdict.settled).toBe(true);
  });

  it("[REVERT-FAILS] a day the venue is closed is a verdict, not 'not settled yet'", () => {
    const hours = {
      mon: [], tue: [], wed: [], thu: [], fri: [], sat: [], sun: [],
    };
    const verdict = serviceDaySettled(hours, ZONE, "2026-09-02", NOW);
    expect(verdict.rule).toBe("closed_day");
    expect(verdict.settled).toBe(false);
    expect(verdict.note).toMatch(/no service window/);
  });

  it("unparseable hours fall back with a reason rather than blocking the day for ever", () => {
    const verdict = serviceDaySettled(
      { mon: "not an array" },
      ZONE,
      "2026-09-02",
      NOW,
    );
    expect(verdict.rule).toBe("settle_after_midnight");
    expect(verdict.note).toMatch(/could not be read/);
  });

  it("local date arithmetic crosses a month boundary", () => {
    expect(shiftLocalDate("2026-09-01", -1)).toBe("2026-08-31");
    expect(shiftLocalDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(localDateIn(new Date("2026-09-03T02:00:00Z"), ZONE)).toBe(
      "2026-09-02",
    );
  });
});
