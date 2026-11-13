/**
 * QA round 4 B1 (2026-11-07): the alert funnel pushed every non-low alert to
 * every member's phone and read no preference, so push switched off and quiet
 * hours 22:00-08:00 still buzzed the phone at 2am. Now
 * `ExpoPushService.pushGate` applies each person's own settings on the house's
 * clock (`push/push-gate.ts`) before the funnel's one `sendToUsers` call.
 *
 * Run through the real `NotificationsService` and the real `ExpoPushService`
 * over the in-memory Supabase that applies its filters; only Expo's HTTP call
 * is replaced, by a recorder.
 */
import {
  makeStubDb,
  asDatabaseService,
  type StubDb,
} from "../team/testing/supabase-stub";
import { NotificationsService } from "./notifications.service";
import { ExpoPushService } from "../push/expo-push.service";
import { pushHoldFor, pushPreferenceFromRow } from "../push/push-gate";

const HOUSE = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const GM = "u-gm";
const COOK = "u-cook";

// 02:00 in New York on a November night (EST, UTC-5) is 07:00Z.
const TWO_AM_NY = new Date("2026-11-08T07:00:00Z");
// 14:00 in New York.
const TWO_PM_NY = new Date("2026-11-08T19:00:00Z");

const QUIET = {
  quiet_hours_enabled: true,
  quiet_hours_start: "22:00",
  quiet_hours_end: "08:00",
};

function seed(prefs: any[], extra: Record<string, any[]> = {}): StubDb {
  return makeStubDb({
    restaurants: [{ id: HOUSE, timezone: "America/New_York", country: "US" }],
    user_restaurant_access: [
      { user_id: GM, restaurant_id: HOUSE, role: "manager", is_active: true },
      { user_id: COOK, restaurant_id: HOUSE, role: "staff", is_active: true },
    ],
    mobile_devices: [
      { user_id: GM, expo_push_token: "ExponentPushToken[gm]" },
      { user_id: COOK, expo_push_token: "ExponentPushToken[cook]" },
    ],
    notifications: [],
    notification_preferences: prefs,
    ...extra,
  });
}

function build(db: StubDb, now: Date) {
  const tokens: string[][] = [];
  const expo = new ExpoPushService(asDatabaseService(db));
  (expo as any).sendToTokens = async (t: string[]) =>
    void tokens.push([...t].sort());
  const realGate = expo.pushGate.bind(expo);
  (expo as any).pushGate = (r: string, ids: string[], o: any = {}) =>
    realGate(r, ids, { ...o, now });
  const socket = { server: { to: () => ({ emit: () => undefined }) } };
  const svc = new NotificationsService(
    socket as never,
    { get: () => undefined } as never,
    asDatabaseService(db),
    undefined,
    expo,
  );
  return { svc, expo, tokens };
}

const ALERT = {
  type: "inventory",
  title: "Gin is running out",
  message: "2 bottles left",
  priority: "medium" as const,
};

describe("B1 — the alert funnel's phone leg follows each person's settings", () => {
  it("does not push to someone who switched push off; the inbox row is still written", async () => {
    const db = seed([
      { user_id: GM, restaurant_id: HOUSE, push_enabled: false },
    ]);
    const { svc, tokens } = build(db, TWO_PM_NY);
    const out = await svc.persistForRestaurant(HOUSE, ALERT);
    expect(out.inserted).toBe(2);
    expect(tokens).toEqual([["ExponentPushToken[cook]"]]);
  });

  it("holds a medium alert at 2am house time for someone with quiet hours 22:00-08:00", async () => {
    const db = seed([{ user_id: GM, restaurant_id: HOUSE, ...QUIET }]);
    const { svc, tokens } = build(db, TWO_AM_NY);
    await svc.persistForRestaurant(HOUSE, ALERT);
    expect(tokens).toEqual([["ExponentPushToken[cook]"]]);
    expect(db.tables.notifications.map((r) => r.user_id).sort()).toEqual(
      [COOK, GM].sort(),
    );
  });

  it("pushes at 2pm in New York (19:00Z), outside the window", async () => {
    const db = seed([{ user_id: GM, restaurant_id: HOUSE, ...QUIET }]);
    const { svc, tokens } = build(db, TWO_PM_NY);
    await svc.persistForRestaurant(HOUSE, ALERT);
    expect(tokens).toEqual([
      ["ExponentPushToken[cook]", "ExponentPushToken[gm]"],
    ]);
  });

  // The two cases above agree on both clocks (07:00Z is inside 22:00-08:00 in
  // UTC too, 19:00Z is outside it), so neither proves the funnel hands the
  // gate the HOUSE's zone. These two instants are where the clocks disagree.
  it("holds at 07:30 in New York, which is 12:30Z and outside the window in UTC", async () => {
    const db = seed([{ user_id: GM, restaurant_id: HOUSE, ...QUIET }]);
    const { svc, tokens } = build(db, new Date("2026-11-08T12:30:00Z"));
    await svc.persistForRestaurant(HOUSE, ALERT);
    expect(tokens).toEqual([["ExponentPushToken[cook]"]]);
  });

  it("pushes at 18:00 in New York, which is 23:00Z and inside the window in UTC", async () => {
    const db = seed([{ user_id: GM, restaurant_id: HOUSE, ...QUIET }]);
    const { svc, tokens } = build(db, new Date("2026-11-08T23:00:00Z"));
    await svc.persistForRestaurant(HOUSE, ALERT);
    expect(tokens).toEqual([
      ["ExponentPushToken[cook]", "ExponentPushToken[gm]"],
    ]);
  });

  it("still pushes a CRITICAL alert inside quiet hours, the settings page's own rule", async () => {
    const db = seed([{ user_id: GM, restaurant_id: HOUSE, ...QUIET }]);
    const { svc, tokens } = build(db, TWO_AM_NY);
    await svc.persistForRestaurant(HOUSE, { ...ALERT, priority: "critical" });
    expect(tokens).toEqual([
      ["ExponentPushToken[cook]", "ExponentPushToken[gm]"],
    ]);
  });

  it("push off holds a critical alert too", async () => {
    const db = seed([
      { user_id: GM, restaurant_id: HOUSE, push_enabled: false },
    ]);
    const { svc, tokens } = build(db, TWO_AM_NY);
    await svc.persistForRestaurant(HOUSE, { ...ALERT, priority: "critical" });
    expect(tokens).toEqual([["ExponentPushToken[cook]"]]);
  });

  it("reads THIS house's row, not the person's row in another house", async () => {
    const db = seed([
      { user_id: GM, restaurant_id: OTHER, push_enabled: false },
    ]);
    const { svc, tokens } = build(db, TWO_PM_NY);
    await svc.persistForRestaurant(HOUSE, ALERT);
    expect(tokens).toEqual([
      ["ExponentPushToken[cook]", "ExponentPushToken[gm]"],
    ]);
  });

  // ADR 0281 fork 1, "Push anyway (Recommended)": a read that fails must not
  // turn into silence. Applied funnel-wide (push-gate.ts says why).
  it("a failed preference read pushes as before, and says so", async () => {
    const db = seed([
      { user_id: GM, restaurant_id: HOUSE, push_enabled: false },
    ]);
    db.errors["notification_preferences:select"] = { message: "boom" };
    const { svc, expo, tokens } = build(db, TWO_AM_NY);
    const out = await svc.persistForRestaurant(HOUSE, ALERT);
    expect(out.inserted).toBe(2);
    expect(tokens).toEqual([
      ["ExponentPushToken[cook]", "ExponentPushToken[gm]"],
    ]);
    const direct = await expo.pushGate(HOUSE, [GM, COOK]);
    expect(direct.send).toEqual([GM, COOK]);
    expect(direct.unjudged).toMatch(/could not be read \(boom\)/);
    expect(direct.detail).toMatch(/could not be read/);
  });

  it("a house with no zone does not judge quiet hours: pushed, and said, never read as UTC", async () => {
    // 03:00Z would be inside 22:00-08:00 if UTC were guessed.
    const db = seed([{ user_id: GM, restaurant_id: HOUSE, ...QUIET }], {
      restaurants: [{ id: HOUSE, timezone: null, country: null }],
    });
    const { expo } = build(db, new Date("2026-11-08T03:00:00Z"));
    const out = await expo.pushGate(HOUSE, [GM, COOK]);
    expect(out.send).toEqual([GM, COOK]);
    expect(out.held.quiet_hours).toEqual([]);
    expect(out.unjudged).toMatch(/time zone is not set/);
  });

  it("says who was held, and pushes nothing when everyone was", async () => {
    const db = seed([
      { user_id: GM, restaurant_id: HOUSE, push_enabled: false },
      { user_id: COOK, restaurant_id: HOUSE, ...QUIET },
    ]);
    const { svc, expo, tokens } = build(db, TWO_AM_NY);
    await svc.persistForRestaurant(HOUSE, ALERT);
    expect(tokens).toEqual([]);
    const out = await expo.pushGate(HOUSE, [GM, COOK]);
    expect(out.send).toEqual([]);
    expect(out.held).toEqual({ push_off: [GM], quiet_hours: [COOK] });
    expect(out.unjudged).toBeNull();
    expect(out.detail).toBe(
      "Not pushed to 1 switched push off, 1 inside their quiet hours.",
    );
  });
});

describe("push-gate — the rule, one row at a time", () => {
  it("no row means push, and only a literal false is an opt-out", () => {
    expect(
      pushHoldFor(undefined, TWO_AM_NY, "America/New_York", false),
    ).toBeNull();
    expect(
      pushHoldFor(
        pushPreferenceFromRow({ push_enabled: null }),
        TWO_PM_NY,
        "UTC",
        false,
      ),
    ).toBeNull();
    expect(
      pushHoldFor(
        pushPreferenceFromRow({ push_enabled: false }),
        TWO_PM_NY,
        "UTC",
        false,
      ),
    ).toBe("push_off");
  });

  it("an overnight window holds 07:30 local and releases 08:00 local", () => {
    const pref = pushPreferenceFromRow(QUIET);
    const at = (iso: string) =>
      pushHoldFor(pref, new Date(iso), "America/New_York", false);
    expect(at("2026-11-08T12:30:00Z")).toBe("quiet_hours"); // 07:30 EST
    expect(at("2026-11-08T13:00:00Z")).toBeNull(); // 08:00 EST
    expect(at("2026-11-08T03:00:00Z")).toBe("quiet_hours"); // 22:00 EST
  });
});
