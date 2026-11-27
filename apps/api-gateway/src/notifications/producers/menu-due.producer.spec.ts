/**
 * The due digest (DD-r108-17): the house's owners and managers hear once when
 * the current menu falls due by its own cadence, once more if it goes overdue,
 * and never from another house. Real ProducerLedgerService over FakeDb, as the
 * sibling producers are proven (mail-grant-absent.producer.spec.ts).
 */

import { MenuDueProducer, menuDueWords } from "./menu-due.producer";
import { ProducerLedgerService } from "./producer-ledger.service";
import { FakeDb, fakeDatabase, fakeNotifications } from "./testing/fake-db";

const TENANT = "rest-1";
const OWNER = "user-owner";
const MANAGER = "user-manager";
const STAFF = "user-staff";
const MEMBERS = [OWNER, MANAGER, STAFF];
const ZONE = "Europe/Istanbul";
const AUDIENCE = { ready: [...MEMBERS], deferred: [] as string[] };
const MADE = "2026-10-01T09:00:00Z";
const DAY = 86_400_000;
const at = (days: number) => new Date(Date.parse(MADE) + days * DAY);

function build(menus: Array<Record<string, any>>) {
  const db = new FakeDb();
  db.tables.restaurant_menus = menus;
  db.tables.user_restaurant_access.push(
    { user_id: OWNER, restaurant_id: TENANT, role: "owner", is_active: true },
    { user_id: MANAGER, restaurant_id: TENANT, role: "manager", is_active: true },
    { user_id: STAFF, restaurant_id: TENANT, role: "staff", is_active: true },
    { user_id: "user-outsider", restaurant_id: "rest-2", role: "manager", is_active: true },
  );
  const database = fakeDatabase(db, MEMBERS);
  const notifications = fakeNotifications(MEMBERS);
  const ledger = new ProducerLedgerService(database as any, notifications as any);
  return { db, notifications, producer: new MenuDueProducer(database as any, ledger) };
}

const current = (over: Record<string, any> = {}) => ({
  id: "m-cur",
  restaurant_id: TENANT,
  status: "active",
  cadence: "monthly",
  made_current_at: MADE,
  ...over,
});

describe("MenuDueProducer (DD-r108-17)", () => {
  it("says nothing before the menu is due, and nothing for a menu with no cadence", async () => {
    for (const [menu, days] of [[current(), 29], [current({ cadence: "none" }), 400], [current({ cadence: null }), 400]] as const) {
      const { notifications, producer } = build([menu]);
      const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, at(days));
      expect(notifications.persistForRestaurant.calls).toHaveLength(0);
      expect(tally.emitted).toBe(0);
      expect(tally.withheldReason).toBeTruthy();
    }
  });

  it("tells owners and managers, not staff and not another house, once the menu is due", async () => {
    const { notifications, producer } = build([current(), { ...current(), id: "m-other", restaurant_id: "rest-2" }]);
    const tally = await producer.sweepTenant(TENANT, ZONE, { ready: [...MEMBERS, "user-outsider"], deferred: [] }, at(35));
    expect(tally.emitted).toBe(2);
    const [house, payload, opts] = notifications.persistForRestaurant.calls[0];
    expect(house).toBe(TENANT);
    expect([...opts.onlyUserIds].sort()).toEqual([MANAGER, OWNER].sort());
    expect(payload).toMatchObject({ type: "menu_due", priority: "low", actionUrl: "/menu", title: "A newer menu is due" });
    expect(payload.message).toBe(
      "This menu was made current 5 weeks ago and you keep it monthly, so a newer one is due. Nothing on the menu has changed. Read the new one on the Menu page.",
    );
    expect(payload.metadata).toMatchObject({ menuId: "m-cur", state: "due", cadence: "monthly", daysSince: 35 });
  });

  it("rings once per state: due once, overdue once more, then nothing until another menu is current", async () => {
    const { notifications, producer } = build([current()]);
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, at(31));
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, at(40));
    expect(notifications.persistForRestaurant.calls).toHaveLength(1);
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, at(46));
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, at(90));
    expect(notifications.persistForRestaurant.calls).toHaveLength(2);
    expect(notifications.persistForRestaurant.calls[1][1].title).toBe("A newer menu is overdue");
    expect(notifications.persistForRestaurant.calls[1][1].message).toMatch(/so a newer one is overdue\./);
  });

  it("a kept menu made current again rings due again in its new stint, and still once within it", async () => {
    const { db, notifications, producer } = build([current()]);
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, at(35));
    expect(notifications.persistForRestaurant.calls).toHaveLength(1);
    // Make current on the same (kept) menu id: a later made_current_at, same row.
    const again = "2026-12-15T09:00:00Z";
    db.tables.restaurant_menus[0].made_current_at = again;
    const later = (days: number) => new Date(Date.parse(again) + days * DAY);
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, later(10));
    expect(notifications.persistForRestaurant.calls).toHaveLength(1);
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, later(35));
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, later(36));
    expect(notifications.persistForRestaurant.calls).toHaveLength(2);
  });

  it("reports an unreadable menu table as a failure, never as 'not due'", async () => {
    const { db, notifications, producer } = build([current()]);
    db.failures.restaurant_menus = "statement timeout";
    const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, at(35));
    expect(tally.failed).toBe(1);
    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
  });

  it("says nothing with no current menu", async () => {
    const { notifications, producer } = build([current({ status: "draft" })]);
    const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, at(35));
    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
    expect(tally.withheldReason).toMatch(/no current menu/);
  });

  it("the words tell due from overdue, as the page does", () => {
    expect(menuDueWords({ state: "due", cadence: "quarterly", daysSince: 100 }).message).toMatch(/^This menu was made current 3 months ago and you keep it every quarter, so a newer one is due\./);
    expect(menuDueWords({ state: "overdue", cadence: "weekly", daysSince: 11 }).title).toBe("A newer menu is overdue");
  });
});
