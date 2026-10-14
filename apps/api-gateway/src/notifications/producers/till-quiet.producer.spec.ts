/**
 * F-1651: when every till of a house that has sent checks before has been
 * silent for 48 hours, the owners and managers are told once for that quiet
 * stretch, honouring quiet hours. Against FakeDb and the real
 * ProducerLedgerService, as the sibling producers are proven
 * (mail-grant-absent.producer.spec.ts).
 */

import * as fs from "fs";
import * as path from "path";
import { TillQuietProducer, TILL_QUIET_AFTER_MS } from "./till-quiet.producer";
import { ProducerLedgerService } from "./producer-ledger.service";
import { FakeDb, fakeDatabase, fakeNotifications } from "./testing/fake-db";

const TENANT = "rest-1";
const OTHER = "rest-2";
const OWNER = "user-owner";
const MANAGER = "user-manager";
const STAFF = "user-staff";
const MEMBERS = [OWNER, MANAGER, STAFF];
const ZONE = "Europe/Istanbul";
const AUDIENCE = { ready: [...MEMBERS], deferred: [] as string[] };
const NOW = new Date("2026-10-14T09:00:00Z");
const HOUR = 3_600_000;
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString();

function build() {
  const db = new FakeDb();
  const database = fakeDatabase(db, MEMBERS);
  const notifications = fakeNotifications(MEMBERS);
  const ledger = new ProducerLedgerService(
    database as any,
    notifications as any,
  );
  const producer = new TillQuietProducer(database as any, ledger);
  db.tables.user_restaurant_access.push(
    { user_id: OWNER, restaurant_id: TENANT, role: "owner", is_active: true },
    {
      user_id: MANAGER,
      restaurant_id: TENANT,
      role: "manager",
      is_active: true,
    },
    { user_id: STAFF, restaurant_id: TENANT, role: "staff", is_active: true },
  );
  return { db, notifications, producer };
}

function check(db: FakeDb, source: string, openedAt: string, house = TENANT) {
  db.tables.pos_checks.push({
    id: db.id("chk"),
    restaurant_id: house,
    source,
    opened_at: openedAt,
  });
}

describe("F-1651: TillQuietProducer", () => {
  it("says nothing for a house whose tills never sent a check", async () => {
    const { db, notifications, producer } = build();
    check(db, "generic_webhook", ago(1 * HOUR), OTHER);
    const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
    expect(tally.withheldReason).toMatch(
      /no till of this house has sent a check/,
    );
    expect(await producer.wouldFire(TENANT, NOW)).toBe(false);
  });

  it("says nothing while a till sent a check in the last 48 hours", async () => {
    const { db, notifications, producer } = build();
    check(db, "generic_webhook", ago(72 * HOUR));
    check(db, "square", ago(47 * HOUR));
    const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
    expect(tally.withheldReason).toMatch(/within the last 48 hours/);
  });

  it("rings the owner and manager once when every till has been quiet 48 hours", async () => {
    const { db, notifications, producer } = build();
    check(db, "generic_webhook", "2026-10-12T05:30:00Z");
    expect(await producer.wouldFire(TENANT, NOW)).toBe(true);
    const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(tally.emitted).toBe(2);
    const [, payload, opts] = notifications.persistForRestaurant.calls[0];
    expect([...opts.onlyUserIds].sort()).toEqual([MANAGER, OWNER].sort());
    expect(payload.type).toBe("pos_till_quiet");
    expect(payload.priority).toBe("high");
    expect(payload.actionUrl).toBe("/connections");
    // On the house's own clock: 05:30 UTC is 08:30 in Istanbul.
    expect(payload.title).toBe(
      "No sale has come from your till since Monday, October 12",
    );
    expect(payload.message).toContain("on Monday, October 12 at 8:30 AM");
    expect(payload.message).toContain(
      "If the house has been open, its sales and stock are not being recorded.",
    );

    // Idempotent: the same quiet stretch, swept again, writes nothing more.
    const again = await producer.sweepTenant(
      TENANT,
      ZONE,
      AUDIENCE,
      new Date(NOW.getTime() + 5 * HOUR),
    );
    expect(again.emitted).toBe(0);
    expect(notifications.persistForRestaurant.calls).toHaveLength(1);
  });

  it("rings again for a new quiet stretch after the till sent once more", async () => {
    const { db, notifications, producer } = build();
    check(db, "generic_webhook", ago(50 * HOUR));
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    check(db, "generic_webhook", ago(1 * HOUR));
    const later = new Date(NOW.getTime() + 60 * HOUR);
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, later);
    expect(notifications.persistForRestaurant.calls).toHaveLength(2);
  });

  it("a member in quiet hours is told after they end, not dropped and not told twice", async () => {
    const { db, notifications, producer } = build();
    check(db, "generic_webhook", ago(50 * HOUR));
    await producer.sweepTenant(
      TENANT,
      ZONE,
      { ready: [OWNER, STAFF], deferred: [MANAGER] },
      NOW,
    );
    expect(notifications.persistForRestaurant.calls[0][2].onlyUserIds).toEqual([
      OWNER,
    ]);
    await producer.sweepTenant(
      TENANT,
      ZONE,
      AUDIENCE,
      new Date(NOW.getTime() + HOUR),
    );
    expect(notifications.persistForRestaurant.calls).toHaveLength(2);
    expect(notifications.persistForRestaurant.calls[1][2].onlyUserIds).toEqual([
      MANAGER,
    ]);
  });

  it("a file import is not a till sending, and a switched-off till is silent on purpose", async () => {
    const { db, notifications, producer } = build();
    check(db, "generic_webhook", ago(50 * HOUR));
    check(db, "csv_import", ago(1 * HOUR));
    check(db, "square", ago(2 * HOUR));
    (db.tables.pos_connections ??= []).push({
      restaurant_id: TENANT,
      provider: "square",
      enabled: false,
    });
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(notifications.persistForRestaurant.calls).toHaveLength(1);
    expect(notifications.persistForRestaurant.calls[0][1].metadata.source).toBe(
      "generic_webhook",
    );
  });

  it("an unreadable check table is a failure, never quiet and never fine", async () => {
    const { db, notifications, producer } = build();
    check(db, "generic_webhook", ago(50 * HOUR));
    db.failures.pos_checks = "statement timeout";
    const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
    expect(tally.failed).toBe(1);
    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
    expect(await producer.wouldFire(TENANT, NOW)).toBeNull();
  });

  it("uses the same gap as the Connections row", () => {
    const web = fs.readFileSync(
      path.resolve(
        __dirname,
        "../../../../web/src/pages/connections/next/ConnectionsNext.tsx",
      ),
      "utf8",
    );
    const m = /const TILL_QUIET_AFTER_MS = (\d+) \* 3_600_000;/.exec(web);
    expect(m).not.toBeNull();
    expect(Number(m![1]) * HOUR).toBe(TILL_QUIET_AFTER_MS);
  });
});
