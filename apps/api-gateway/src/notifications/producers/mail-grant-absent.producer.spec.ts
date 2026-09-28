/**
 * The ninth producer got only service-level wiring (`notification-producers
 * .service.spec.ts`, via a stub) — this file exercises its own logic: the
 * enabled/granted/unknown branch matrix, owner/manager-only audience
 * narrowing, and the weekly dedupe key, all against `FakeDb` and a real
 * `ProducerLedgerService` the way every sibling producer is proven (see
 * `grant-suspended.producer.spec.ts`, whose structure this mirrors).
 *
 * `HouseInboxService.statusFor` itself reads two tables `FakeDb` does not
 * model (`integration_oauth_connections`, `house_inbox_cursors`) and is
 * already proven on its own terms elsewhere — so it is stubbed here to the
 * shape this producer actually consumes, and only that method. Everything
 * downstream of the stub (the ledger, the claims table, the audience query)
 * is the real thing.
 */

import { MailGrantAbsentProducer } from "./mail-grant-absent.producer";
import { ProducerLedgerService } from "./producer-ledger.service";
import { FakeDb, fakeDatabase, fakeNotifications } from "./testing/fake-db";
import type { HouseInboxService } from "../../communications/inbox/house-inbox.service";

const TENANT = "rest-1";
const OTHER = "rest-2";
const OWNER = "user-owner";
const MANAGER = "user-manager";
const STAFF = "user-staff";
const MEMBERS = [OWNER, MANAGER, STAFF];
const ZONE = "America/New_York";
const AUDIENCE = { ready: [...MEMBERS], deferred: [] as string[] };
// An exact epoch-week boundary (Math.floor(ms / 7 days) ticks over here), so
// "+6.9 days" below is provably still inside the same bucket and "+7 days" is
// provably the next one — not an artifact of where in its own week NOW falls.
const NOW = new Date("2026-09-03T00:00:00Z");

type Status = Awaited<ReturnType<HouseInboxService["statusFor"]>>;

/** `granted: false, enabled: true` — the standing case this producer exists for. */
function status(over: Partial<Status> = {}): Status {
  return {
    granted: false,
    enabled: true,
    grantOwnerUserId: null,
    startedAt: null,
    lastReadAt: null,
    lastError: null,
    ...over,
  };
}

function build(result: Status | (() => Promise<Status>)) {
  const db = new FakeDb();
  const database = fakeDatabase(db, MEMBERS);
  const notifications = fakeNotifications(MEMBERS);
  const ledger = new ProducerLedgerService(database as any, notifications as any);
  const statusFor =
    typeof result === "function"
      ? jest.fn(result)
      : jest.fn(async () => result);
  const inbox = { statusFor } as unknown as HouseInboxService;
  const producer = new MailGrantAbsentProducer(database as any, inbox, ledger);
  return { db, notifications, producer, statusFor };
}

/** Owner, manager and one member of staff, all active in this house. */
function house(db: FakeDb, over: Array<Record<string, any>> = []) {
  db.tables.user_restaurant_access.push(
    { user_id: OWNER, restaurant_id: TENANT, role: "owner", is_active: true },
    { user_id: MANAGER, restaurant_id: TENANT, role: "manager", is_active: true },
    { user_id: STAFF, restaurant_id: TENANT, role: "staff", is_active: true },
    ...over,
  );
}

describe("MailGrantAbsentProducer", () => {
  it("does nothing, and says so, when the house never turned the flag on", async () => {
    const { db, notifications, producer } = build(status({ enabled: false }));
    house(db);

    const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);

    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
    expect(tally.emitted).toBe(0);
    expect(tally.withheldReason).toMatch(/enable_house_inbox_read is off/);
  });

  it("reports a failure, never a negative answer, when the grant register cannot be read", async () => {
    const { db, notifications, producer } = build(status({ granted: "unknown", lastError: "statement timeout" }));
    house(db);

    const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);

    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
    expect(tally.failed).toBe(1);
    expect(tally.emitted).toBe(0);
  });

  it("does nothing, and says so, when the grant is live", async () => {
    const { db, notifications, producer } = build(status({ granted: true }));
    house(db);

    const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);

    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
    expect(tally.withheldReason).toMatch(/grant is live/);
  });

  it("counts a thrown status read as a failure, not a write", async () => {
    const { db, notifications, producer } = build(async () => {
      throw new Error("network unreachable");
    });
    house(db);

    const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);

    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
    expect(tally.failed).toBe(1);
  });

  it("writes the standing alert once the flag is on and no grant backs it", async () => {
    const { db, notifications, producer } = build(status({ lastError: null }));
    house(db);

    const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);

    expect(tally.emitted).toBe(2); // owner + manager, staff excluded
    const call = notifications.persistForRestaurant.calls[0][1];
    expect(call.type).toBe("mail_grant_absent");
    expect(call.priority).toBe("high");
    expect(call.actionUrl).toBe("/connections");
    expect(call.title).toBe("The house's mail reading is on, and nothing is backing it");
    expect(call.message).toContain(
      "No live Gmail read grant is recorded for this house",
    );
    expect(call.metadata.enabled).toBe(true);
    expect(call.metadata.granted).toBe(false);
  });

  it("carries the last read error in the message when there is one", async () => {
    const { db, notifications, producer } = build(status({ lastError: "invalid_grant" }));
    house(db);

    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);

    const call = notifications.persistForRestaurant.calls[0][1];
    expect(call.message).toContain("The last read attempt failed: invalid_grant");
  });

  it("writes to owners and managers only", async () => {
    const { db, notifications, producer } = build(status());
    house(db);

    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);

    const opts = notifications.persistForRestaurant.calls[0][2];
    expect([...opts.onlyUserIds].sort()).toEqual([MANAGER, OWNER].sort());
    expect(opts.onlyUserIds).not.toContain(STAFF);
  });

  it("never reaches a manager of another house", async () => {
    const { db, notifications, producer } = build(status());
    house(db, [
      { user_id: "user-outsider", restaurant_id: OTHER, role: "manager", is_active: true },
    ]);

    await producer.sweepTenant(
      TENANT,
      ZONE,
      { ready: [...MEMBERS, "user-outsider"], deferred: [] },
      NOW,
    );

    const opts = notifications.persistForRestaurant.calls[0][2];
    expect(opts.onlyUserIds).not.toContain("user-outsider");
  });

  it("does not write to a manager whose access is inactive", async () => {
    const { db, notifications, producer } = build(status());
    db.tables.user_restaurant_access.push(
      { user_id: OWNER, restaurant_id: TENANT, role: "owner", is_active: true },
      { user_id: MANAGER, restaurant_id: TENANT, role: "manager", is_active: false },
    );

    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);

    const opts = notifications.persistForRestaurant.calls[0][2];
    expect(opts.onlyUserIds).toEqual([OWNER]);
  });

  it("a house with no owner or manager writes nothing and says so", async () => {
    const { db, notifications, producer } = build(status());
    db.tables.user_restaurant_access.push(
      { user_id: STAFF, restaurant_id: TENANT, role: "staff", is_active: true },
    );

    const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);

    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
    expect(tally.emitted).toBe(0);
    expect(tally.withheldReason).toMatch(/nobody who could act on this/);
  });

  it("falls back to the full audience, rather than silently telling nobody, when the role read fails", async () => {
    const { db, notifications, producer } = build(status());
    house(db);
    db.failures.user_restaurant_access = "statement timeout";

    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);

    const opts = notifications.persistForRestaurant.calls[0][2];
    expect([...opts.onlyUserIds].sort()).toEqual(MEMBERS.sort());
  });

  describe("the weekly dedupe key", () => {
    it("says nothing more inside the same week, however many sweeps run", async () => {
      const { db, notifications, producer } = build(status());
      house(db);

      await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
      for (const days of [1, 3, 6.9]) {
        await producer.sweepTenant(
          TENANT,
          ZONE,
          AUDIENCE,
          new Date(NOW.getTime() + days * 86_400_000),
        );
      }

      expect(notifications.persistForRestaurant.calls).toHaveLength(1);
    });

    it("re-says once a new calendar week starts, and keeps a distinct key per week", async () => {
      const { db, notifications, producer } = build(status());
      house(db);

      await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
      await producer.sweepTenant(
        TENANT,
        ZONE,
        AUDIENCE,
        new Date(NOW.getTime() + 7 * 86_400_000),
      );
      await producer.sweepTenant(
        TENANT,
        ZONE,
        AUDIENCE,
        new Date(NOW.getTime() + 14 * 86_400_000),
      );

      expect(notifications.persistForRestaurant.calls).toHaveLength(3);
      const keys = db.tables.notification_producer_claims.map((r: any) => r.dedupe_key);
      expect(new Set(keys).size).toBe(3);
      for (const k of keys) expect(k).toMatch(/^mail-grant-absent:rest-1:week\d+$/);
    });

    it("a second sweep in the same week is claimed, not re-emitted", async () => {
      const { db, notifications, producer } = build(status());
      house(db);

      await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);
      const second = await producer.sweepTenant(
        TENANT,
        ZONE,
        AUDIENCE,
        new Date(NOW.getTime() + 2 * 86_400_000),
      );

      expect(second.alreadyClaimed).toBe(1);
      expect(second.emitted).toBe(0);
      expect(notifications.persistForRestaurant.calls).toHaveLength(1);
    });
  });

  describe("wouldFire", () => {
    it("is false when the flag is off", async () => {
      const { producer } = build(status({ enabled: false }));
      await expect(producer.wouldFire(TENANT)).resolves.toBe(false);
    });

    it("is null when the grant register cannot be read", async () => {
      const { producer } = build(status({ granted: "unknown" }));
      await expect(producer.wouldFire(TENANT)).resolves.toBeNull();
    });

    it("is false when the grant is live", async () => {
      const { producer } = build(status({ granted: true }));
      await expect(producer.wouldFire(TENANT)).resolves.toBe(false);
    });

    it("is true when the flag is on and nothing backs it", async () => {
      const { producer } = build(status());
      await expect(producer.wouldFire(TENANT)).resolves.toBe(true);
    });

    it("is null, never a throw, when the status read itself throws", async () => {
      const { producer } = build(async () => {
        throw new Error("network unreachable");
      });
      await expect(producer.wouldFire(TENANT)).resolves.toBeNull();
    });
  });

  it("writes no emoji", async () => {
    const { db, notifications, producer } = build(status());
    house(db);

    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NOW);

    const call = notifications.persistForRestaurant.calls[0][1];
    const emoji =
      /(?:[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}]|\u{FE0F}|\u{20E3})/u;
    expect(emoji.test(call.title)).toBe(false);
    expect(emoji.test(call.message)).toBe(false);
  });
});
