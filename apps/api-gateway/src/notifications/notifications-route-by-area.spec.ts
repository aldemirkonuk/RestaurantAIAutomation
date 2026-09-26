/**
 * The notification funnel routes a broadcast by its area label and by Away
 * (ADR 0218) — asserted on the rows written, the push list and the socket
 * rooms, through the real `NotificationsService` and the real
 * `AreaRoutingService` over an in-memory Supabase that applies its filters.
 */
import { makeStubDb, type StubDb } from "../team/testing/supabase-stub";
import { NotificationsService } from "./notifications.service";
import { AreaRoutingService } from "../areas/area-routing.service";
import { ProducerLedgerService } from "./producers/producer-ledger.service";
import { houseLocalDay } from "../areas/area-routing";

const HOUSE = "11111111-1111-1111-1111-111111111111";
const OWNER = "u-owner";
const MANAGER = "u-manager";
const COOK = "u-cook";
const BARTENDER = "u-bar";

const TODAY = houseLocalDay(new Date(), "UTC");
const plus = (days: number) =>
  new Date(Date.parse(`${TODAY}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

function seed(extra: Partial<Record<string, any[]>> = {}): StubDb {
  return makeStubDb({
    restaurants: [{ id: HOUSE, timezone: "UTC" }],
    user_restaurant_access: [
      { user_id: OWNER, restaurant_id: HOUSE, role: "owner", is_active: true },
      { user_id: MANAGER, restaurant_id: HOUSE, role: "manager", is_active: true },
      { user_id: COOK, restaurant_id: HOUSE, role: "staff", is_active: true },
      { user_id: BARTENDER, restaurant_id: HOUSE, role: "staff", is_active: true },
    ],
    team_members: [
      { id: "m-cook", restaurant_id: HOUSE, user_id: COOK, display_name: "Cook" },
      { id: "m-bar", restaurant_id: HOUSE, user_id: BARTENDER, display_name: "Bar" },
    ],
    house_areas: [],
    house_area_members: [],
    house_away: [],
    notifications: [],
    notification_preferences: [],
    ...extra,
  });
}

/** A DatabaseService-shaped object; the member read mirrors the real one. */
function dbService(db: StubDb): any {
  return {
    supabase: db.supabase,
    client: db.supabase,
    getClient: () => db.supabase,
    getRestaurantMemberIds: async (rid: string) =>
      (db.tables.user_restaurant_access ?? [])
        .filter((r) => r.restaurant_id === rid && r.is_active)
        .map((r) => r.user_id),
  };
}

function build(db: StubDb, withRouting = true) {
  const rooms: string[][] = [];
  const pushed: string[][] = [];
  const socket = {
    server: {
      to: (room: string | string[]) => {
        rooms.push(Array.isArray(room) ? room : [room]);
        return { emit: () => undefined };
      },
    },
  };
  const expo = { sendToUsers: async (ids: string[]) => void pushed.push(ids) };
  const database = dbService(db);
  const routing = withRouting ? new AreaRoutingService(database) : undefined;
  const svc = new NotificationsService(
    socket as never,
    { get: () => undefined } as never,
    database,
    undefined,
    expo as never,
    routing,
  );
  return { svc, rooms, pushed, routing, database };
}

const PAYLOAD = { type: "inventory", title: "Gin is running out", message: "2 bottles left", priority: "high" as const };
const rowsFor = (db: StubDb) => db.tables.notifications.map((r) => r.user_id).sort();

describe("a house with nobody in any area and nobody Away", () => {
  it("writes, pushes and pings exactly as before — every member, the restaurant room", async () => {
    const db = seed();
    const { svc, rooms, pushed } = build(db);
    const out = await svc.persistForRestaurant(HOUSE, PAYLOAD, { area: "bar" });
    expect(out.inserted).toBe(4);
    expect(rowsFor(db)).toEqual([BARTENDER, COOK, MANAGER, OWNER].sort());
    expect(pushed).toEqual([[OWNER, MANAGER, COOK, BARTENDER]]);
    expect(rooms).toEqual([[`restaurant:${HOUSE}`]]);
    expect(out.routing).toMatchObject({ step: "everyone", heldAway: 0, degraded: null });
  });
});

describe("a house that uses areas", () => {
  const areas = {
    house_area_members: [
      { id: "hm1", restaurant_id: HOUSE, member_id: "m-bar", kind: "bar", is_lead: false },
      { id: "hm2", restaurant_id: HOUSE, member_id: "m-cook", kind: "kitchen", is_lead: true },
    ],
  };

  it("alerts the bar for a bar item; owners and managers get the row without the push; the cook gets nothing", async () => {
    const db = seed(areas);
    const { svc, rooms, pushed } = build(db);
    const out = await svc.persistForRestaurant(HOUSE, PAYLOAD, { area: "bar" });
    expect(rowsFor(db)).toEqual([BARTENDER, MANAGER, OWNER].sort());
    expect(pushed).toEqual([[BARTENDER]]);
    // Never the restaurant room: that would ping the cook.
    expect(rooms[0].sort()).toEqual([`user:${BARTENDER}`, `user:${MANAGER}`, `user:${OWNER}`].sort());
    expect(db.tables.notifications.every((r) => r.metadata.area === "bar")).toBe(true);
    expect(out.routing).toMatchObject({ step: "area", alerted: 1, inboxOnly: 2 });
  });

  it("still writes a house-wide item to everyone", async () => {
    const db = seed(areas);
    const { svc } = build(db);
    await svc.persistForRestaurant(HOUSE, PAYLOAD);
    expect(rowsFor(db)).toEqual([BARTENDER, COOK, MANAGER, OWNER].sort());
  });

  it("leaves a targeted write alone — its caller chose the people", async () => {
    const db = seed(areas);
    const { svc, pushed } = build(db);
    await svc.persistForRestaurant(HOUSE, PAYLOAD, { area: "bar", onlyUserIds: [COOK] });
    expect(rowsFor(db)).toEqual([COOK]);
    expect(pushed).toEqual([[COOK]]);
  });
});

describe("Away", () => {
  it("holds every alert back from the person who is Away, and names the count", async () => {
    const db = seed({
      house_away: [{ restaurant_id: HOUSE, user_id: COOK, away_from: plus(-1), away_until: plus(3) }],
    });
    const { svc, pushed, rooms } = build(db);
    const out = await svc.persistForRestaurant(HOUSE, PAYLOAD);
    expect(rowsFor(db)).not.toContain(COOK);
    expect(pushed[0]).not.toContain(COOK);
    expect(rooms[0]).not.toContain(`restaurant:${HOUSE}`);
    expect(out.routing?.heldAway).toBe(1);
  });

  it("lands silently in the owners' inboxes when everyone is Away — no push, no ping", async () => {
    const all = [OWNER, MANAGER, COOK, BARTENDER].map((user_id) => ({
      restaurant_id: HOUSE,
      user_id,
      away_from: TODAY,
      away_until: plus(2),
    }));
    const db = seed({ house_away: all });
    const { svc, pushed, rooms } = build(db);
    const out = await svc.persistForRestaurant(HOUSE, PAYLOAD);
    expect(rowsFor(db)).toEqual([OWNER]);
    expect(pushed).toEqual([]);
    expect(rooms).toEqual([]);
    expect(out.routing?.step).toBe("owners_inbox_only");
  });
});

describe("an unreadable register", () => {
  it("falls back to every member — never to nobody — and says it was degraded", async () => {
    const db = seed({
      house_away: [{ restaurant_id: HOUSE, user_id: COOK, away_from: TODAY, away_until: plus(2) }],
    });
    db.errors["house_away:select"] = { message: "relation does not exist" };
    const { svc } = build(db);
    const out = await svc.persistForRestaurant(HOUSE, PAYLOAD, { area: "bar" });
    expect(out.inserted).toBe(4);
    expect(out.routing?.degraded).toMatch(/house_away could not be read/);
  });
});

describe("the producers' audience", () => {
  it("sets a person who is Away apart from both the awake and the quiet-hours halves", async () => {
    const db = seed({
      house_away: [{ restaurant_id: HOUSE, user_id: BARTENDER, away_from: TODAY, away_until: plus(1) }],
    });
    const { svc, routing, database } = build(db);
    const ledger = new ProducerLedgerService(database, svc, undefined, routing);
    const audience = await ledger.audienceFor(HOUSE, "UTC", new Date());
    expect(audience.ready).not.toContain(BARTENDER);
    expect(audience.deferred).not.toContain(BARTENDER);
    expect(audience.away).toEqual([BARTENDER]);
  });

  it("fails open on an unreadable Away register, rather than silencing the house", async () => {
    const db = seed({
      house_away: [{ restaurant_id: HOUSE, user_id: BARTENDER, away_from: TODAY, away_until: plus(1) }],
    });
    db.errors["house_away:select"] = { message: "boom" };
    const { svc, routing, database } = build(db);
    const ledger = new ProducerLedgerService(database, svc, undefined, routing);
    const audience = await ledger.audienceFor(HOUSE, "UTC", new Date());
    expect(audience.ready).toContain(BARTENDER);
    expect(audience.away).toBeUndefined();
  });
});
