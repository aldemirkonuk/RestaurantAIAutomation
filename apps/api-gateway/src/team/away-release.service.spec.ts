/**
 * What waited for a person who was Away is delivered when they are back (ADR
 * 0218, the founder's round-2 answer 3, 2026-09-21).
 *
 * The release service runs for real over an in-memory Supabase that applies
 * its filters, with the real hold service, the real Away reader and the real
 * notes service. Only the two outbound edges are fakes: the notification
 * funnel (its own suites cover it) and the push service (it would reach Expo).
 */
import { AreaRoutingService } from "../areas/area-routing.service";
import { NotificationsService } from "../notifications/notifications.service";
import { TextSenderService } from "../communications/text/text-sender.service";
import { textCollaborators } from "../communications/text/testing/text-collaborators";
import { AwayHoldService } from "./away-hold.service";
import { LEFT_BEFORE_RETURN, STALE_CLAIM_MS } from "./away-hold";
import { AwayReleaseService } from "./away-release.service";
import { NotesService } from "./notes.service";
import { TeamService } from "./team.service";
import { asDatabaseService, makeStubDb, type StubDb } from "./testing/supabase-stub";

const HOUSE = "11111111-1111-1111-1111-111111111111";
const OTHER = "22222222-2222-2222-2222-222222222222";
const MANAGER = "aaaaaaaa-0000-0000-0000-000000000001";
const SAM = "aaaaaaaa-0000-0000-0000-000000000002";
const RAY = "aaaaaaaa-0000-0000-0000-000000000003";
const LEFT = "aaaaaaaa-0000-0000-0000-000000000004";
const M_SAM = "bbbbbbbb-0000-0000-0000-000000000002";
const NOTE = "cccccccc-0000-0000-0000-000000000001";

// Noon on the 25th in the house's zone (UTC); Sam's Away ended on the 24th.
const NOW = new Date("2026-09-25T12:00:00Z");

function message(userId: string, over: Record<string, any> = {}) {
  return {
    id: `held-${userId}`,
    restaurant_id: HOUSE,
    user_id: userId,
    kind: "team_message",
    note_id: null,
    member_id: null,
    title: "Saturday",
    body: "Saturday moves to seven.",
    channels: ["inbox", "push"],
    sent_by: MANAGER,
    away_until: "2026-09-24",
    created_at: "2026-09-21T10:00:00Z",
    claimed_at: null,
    ...over,
  };
}

function seed(extra: Partial<Record<string, any[]>> = {}): StubDb {
  return makeStubDb({
    restaurants: [
      { id: HOUSE, timezone: "UTC" },
      { id: OTHER, timezone: "UTC" },
    ],
    user_restaurant_access: [
      { user_id: MANAGER, restaurant_id: HOUSE, role: "manager", is_active: true },
      { user_id: SAM, restaurant_id: HOUSE, role: "staff", is_active: true },
      { user_id: RAY, restaurant_id: HOUSE, role: "staff", is_active: true },
      // LEFT's access row was switched off: they no longer belong here.
      { user_id: LEFT, restaurant_id: HOUSE, role: "staff", is_active: false },
    ],
    users: [
      { user_id: MANAGER, restaurant_id: HOUSE, role: "manager", name: "Moe" },
      { user_id: SAM, restaurant_id: HOUSE, role: "staff", name: "Sam" },
      { user_id: RAY, restaurant_id: HOUSE, role: "staff", name: "Ray" },
      { user_id: LEFT, restaurant_id: OTHER, role: "staff", name: "Lee" },
    ],
    team_members: [
      { id: M_SAM, created_at: "2026-01-02T00:00:00Z", restaurant_id: HOUSE, user_id: SAM, display_name: "Sam", status: "active" },
    ],
    house_away: [],
    house_away_held: [],
    notification_preferences: [],
    team_notes: [],
    team_note_deliveries: [],
    house_text_senders: [],
    person_text_consents: [],
    notifications: [],
    ...extra,
  });
}

function harness(db: StubDb, opts: { inboxWrites?: number } = {}) {
  const dbs = asDatabaseService(db);
  const team = new TeamService(dbs);
  const routing = new AreaRoutingService(dbs);
  const hold = new AwayHoldService(dbs, routing);
  const notifications = {
    persistForRestaurant: jest.fn(async (_rid: string, _p: any, o: any) => ({
      inserted: opts.inboxWrites ?? (o?.onlyUserIds?.length ?? 0),
      ids: [],
    })),
  } as any;
  const push = {
    sendToUsers: jest.fn(async (ids: string[]) => ({
      outcome: "accepted_by_service" as const,
      tokens: ids.length,
      detail: "Handed to Expo.",
    })),
    devicesByUser: jest.fn(async (ids: string[]) => new Map(ids.map((id) => [id, 1]))),
  } as any;
  const co = textCollaborators(dbs);
  const text = new TextSenderService(dbs, co.transports, co.usage);
  const notes = new NotesService(dbs, team, notifications, push, text, hold);
  const release = new AwayReleaseService(dbs, hold, routing, notes, notifications, push, team);
  return { release, notifications, push };
}

describe("AwayReleaseService — a held message arrives when they are back", () => {
  it("delivers to that one person's inbox and phone, then deletes what it kept", async () => {
    const db = seed({ house_away_held: [message(SAM)] });
    const { release, notifications, push } = harness(db);

    const tally = await release.sweep(NOW);

    expect(tally).toMatchObject({ considered: 1, released: 1, failed: 0, unreadable: 0 });
    expect(notifications.persistForRestaurant).toHaveBeenCalledTimes(1);
    const [rid, payload, o] = notifications.persistForRestaurant.mock.calls[0];
    expect(rid).toBe(HOUSE);
    expect(o).toEqual({ onlyUserIds: [SAM], skipMobilePush: true });
    expect(payload).toMatchObject({ title: "Saturday", message: "Saturday moves to seven." });
    expect(push.sendToUsers).toHaveBeenCalledWith([SAM], expect.objectContaining({ body: "Saturday moves to seven." }));
    // KVKK: the words lived in the hold table only while they waited.
    expect(db.tables.house_away_held).toEqual([]);
  });

  it("keeps waiting while they are still Away (the dates were extended)", async () => {
    const db = seed({
      house_away_held: [message(SAM)],
      house_away: [{ restaurant_id: HOUSE, user_id: SAM, away_from: "2026-09-20", away_until: "2026-09-27" }],
    });
    const { release, notifications } = harness(db);
    const tally = await release.sweep(NOW);
    expect(tally).toMatchObject({ stillAway: 1, released: 0 });
    expect(notifications.persistForRestaurant).not.toHaveBeenCalled();
    expect(db.tables.house_away_held).toHaveLength(1);
    expect(db.tables.house_away_held[0].claimed_at).toBeNull();
  });

  it("waits out their quiet hours on the day they are back", async () => {
    const db = seed({
      house_away_held: [message(SAM)],
      notification_preferences: [
        { user_id: SAM, restaurant_id: HOUSE, quiet_hours_enabled: true, quiet_hours_start: "22:00", quiet_hours_end: "08:00" },
      ],
    });
    const { release, notifications } = harness(db);
    const tally = await release.sweep(new Date("2026-09-25T06:30:00Z"));
    expect(tally).toMatchObject({ quietHours: 1, released: 0 });
    expect(notifications.persistForRestaurant).not.toHaveBeenCalled();
    expect(db.tables.house_away_held).toHaveLength(1);
  });

  it("honours a push opt-out read at delivery time, and still writes the inbox row", async () => {
    const db = seed({
      house_away_held: [message(SAM)],
      notification_preferences: [{ user_id: SAM, restaurant_id: HOUSE, push_enabled: false }],
    });
    const { release, notifications, push } = harness(db);
    await release.sweep(NOW);
    expect(notifications.persistForRestaurant).toHaveBeenCalledTimes(1);
    expect(push.sendToUsers).not.toHaveBeenCalled();
    expect(db.tables.house_away_held).toEqual([]);
  });

  it("drops what waited for someone who left the house, and delivers nothing", async () => {
    const db = seed({ house_away_held: [message(LEFT)] });
    const { release, notifications, push } = harness(db);
    const tally = await release.sweep(NOW);
    expect(tally).toMatchObject({ leftHouse: 1, released: 0 });
    expect(notifications.persistForRestaurant).not.toHaveBeenCalled();
    expect(push.sendToUsers).not.toHaveBeenCalled();
    expect(db.tables.house_away_held).toEqual([]);
  });

  it("hands the claim back when the inbox row was not written, and sends no push", async () => {
    const db = seed({ house_away_held: [message(SAM)] });
    const { release, push } = harness(db, { inboxWrites: 0 });
    const tally = await release.sweep(NOW);
    expect(tally).toMatchObject({ failed: 1, released: 0 });
    expect(push.sendToUsers).not.toHaveBeenCalled();
    expect(db.tables.house_away_held).toHaveLength(1);
    expect(db.tables.house_away_held[0].claimed_at).toBeNull();
  });

  it("leaves a fresh claim to the release that holds it, and takes over a stale one", async () => {
    const fresh = new Date(NOW.getTime() - 60_000).toISOString();
    const stale = new Date(NOW.getTime() - STALE_CLAIM_MS - 60_000).toISOString();
    const db = seed({
      house_away_held: [message(SAM, { claimed_at: fresh }), message(RAY, { claimed_at: stale })],
    });
    const { release, notifications } = harness(db);
    const tally = await release.sweep(NOW);
    expect(tally).toMatchObject({ claimedElsewhere: 1, released: 1 });
    expect(notifications.persistForRestaurant.mock.calls.map((c: any[]) => c[2].onlyUserIds)).toEqual([[RAY]]);
    expect(db.tables.house_away_held.map((r: any) => r.user_id)).toEqual([SAM]);
  });

  it("moves nothing when Away cannot be read — delayed, never guessed", async () => {
    const db = seed({ house_away_held: [message(SAM)] });
    db.errors["house_away:select"] = { message: "down" };
    const { release, notifications } = harness(db);
    const tally = await release.sweep(NOW);
    expect(tally).toMatchObject({ unreadable: 1, released: 0 });
    expect(notifications.persistForRestaurant).not.toHaveBeenCalled();
    expect(db.tables.house_away_held).toHaveLength(1);
  });

  it("moves nothing when membership cannot be read — never 'they left'", async () => {
    const db = seed({ house_away_held: [message(SAM)] });
    db.errors["user_restaurant_access:select"] = { message: "down" };
    const { release } = harness(db);
    const tally = await release.sweep(NOW);
    expect(tally).toMatchObject({ unreadable: 1, leftHouse: 0 });
    expect(db.tables.house_away_held).toHaveLength(1);
  });

  it("says so when the hold table cannot be read, instead of reporting nothing waiting", async () => {
    const db = seed({ house_away_held: [message(SAM)] });
    db.errors["house_away_held:select"] = { message: "down" };
    const { release } = harness(db);
    expect((await release.sweep(NOW)).unreadable).toBe(1);
  });

  it("releaseFor delivers only that person's items in that house", async () => {
    const db = seed({ house_away_held: [message(SAM), message(RAY)] });
    const { release, notifications } = harness(db);
    const tally = await release.releaseFor(HOUSE, SAM, NOW);
    expect(tally.released).toBe(1);
    expect(notifications.persistForRestaurant.mock.calls.map((c: any[]) => c[2].onlyUserIds)).toEqual([[SAM]]);
    expect(db.tables.house_away_held.map((r: any) => r.user_id)).toEqual([RAY]);
  });
});

describe("AwayReleaseService — a held note arrives, and its receipts say what happened", () => {
  function noteSeed(userId: string, memberId: string) {
    return seed({
      team_members: [
        { id: memberId, created_at: "2026-01-02T00:00:00Z", restaurant_id: HOUSE, user_id: userId, display_name: "Sam", status: "active" },
      ],
      team_notes: [{ id: NOTE, restaurant_id: HOUSE, week_start: "2026-09-21", body: "Kitchen meeting at four.", author_user_id: MANAGER }],
      team_note_deliveries: ["inbox", "push", "whatsapp", "sms"].map((channel) => ({
        id: `d-${channel}`,
        note_id: NOTE,
        member_id: memberId,
        channel,
        state: "held_away",
        detail: "Away until 24 Sep. It waits and is delivered when they are back, outside their quiet hours.",
      })),
      house_away_held: [
        {
          ...message(userId),
          id: "held-note",
          kind: "team_note",
          note_id: NOTE,
          member_id: memberId,
          title: null,
          body: null,
          channels: [],
        },
      ],
    });
  }

  it("delivers the note and rewrites every waiting receipt", async () => {
    const db = noteSeed(SAM, M_SAM);
    const { release, notifications, push } = harness(db);
    const tally = await release.sweep(NOW);
    expect(tally.released).toBe(1);
    expect(notifications.persistForRestaurant).toHaveBeenCalledWith(
      HOUSE,
      expect.objectContaining({ message: "Kitchen meeting at four." }),
      { onlyUserIds: [SAM] },
    );
    expect(push.sendToUsers).toHaveBeenCalledWith([SAM], expect.anything());
    const byChannel = Object.fromEntries(
      db.tables.team_note_deliveries.map((d: any) => [d.channel, d.state]),
    );
    expect(byChannel).toEqual({
      inbox: "delivered",
      push: "accepted_by_service",
      // No house on this deployment has a text sender; the receipt says so.
      whatsapp: "no_sender",
      sms: "no_sender",
    });
    expect(db.tables.team_note_deliveries.some((d: any) => d.state === "held_away")).toBe(false);
    expect(db.tables.house_away_held).toEqual([]);
  });

  it("closes the receipts with the reason when the person left before coming back", async () => {
    const M_LEFT = "bbbbbbbb-0000-0000-0000-000000000004";
    const db = noteSeed(LEFT, M_LEFT);
    const { release, notifications } = harness(db);
    const tally = await release.sweep(NOW);
    expect(tally.leftHouse).toBe(1);
    expect(notifications.persistForRestaurant).not.toHaveBeenCalled();
    expect(db.tables.team_note_deliveries.every((d: any) => d.state === "failed" && d.detail === LEFT_BEFORE_RETURN)).toBe(true);
    expect(db.tables.house_away_held).toEqual([]);
  });

  it("hands a held note back when its inbox row was not written: no push, the receipts still wait", async () => {
    const db = noteSeed(SAM, M_SAM);
    const { release, push } = harness(db, { inboxWrites: 0 });
    const tally = await release.sweep(NOW);
    expect(tally).toMatchObject({ failed: 1, released: 0 });
    // Nothing went out behind a receipt that says "delivered".
    expect(push.sendToUsers).not.toHaveBeenCalled();
    expect(db.tables.team_note_deliveries.every((d: any) => d.state === "held_away")).toBe(true);
    expect(db.tables.house_away_held).toHaveLength(1);
    expect(db.tables.house_away_held[0].claimed_at).toBeNull();
  });

  it("counts a note deleted while it waited as gone, not as released", async () => {
    const db = noteSeed(SAM, M_SAM);
    db.tables.team_notes = [];
    const { release, notifications } = harness(db);
    const tally = await release.sweep(NOW);
    expect(tally).toMatchObject({ gone: 1, released: 0 });
    expect(notifications.persistForRestaurant).not.toHaveBeenCalled();
  });
});

/**
 * One push path, against the REAL funnel (the #448 defect, mirrored here).
 *
 * Every test above hands the release a mocked `persistForRestaurant`, so none
 * can see the funnel's own "Mobile fan-out", which pushes the write audience
 * at any priority but "low" and reads no push switch. A released team message
 * is written at priority "high" and then pushed by this service's own
 * opt-out-aware leg — so without `skipMobilePush` the person was pushed twice,
 * an inbox-only message was pushed anyway, and a push opt-out was ignored.
 * Here the funnel is a real `NotificationsService` over the same stub, wired
 * to the SAME push fake the release uses (one spy, as one real device).
 */
function realFunnelHarness(db: StubDb) {
  const dbs = asDatabaseService(db);
  const team = new TeamService(dbs);
  const routing = new AreaRoutingService(dbs);
  const hold = new AwayHoldService(dbs, routing);
  const push = {
    sendToUsers: jest.fn(async (ids: string[]) => ({
      outcome: "accepted_by_service" as const,
      tokens: ids.length,
      detail: "Handed to Expo.",
    })),
    devicesByUser: jest.fn(async (ids: string[]) => new Map(ids.map((id) => [id, 1]))),
  } as any;
  const socket = { server: { to: () => ({ emit: () => undefined }) } };
  const notifications = new NotificationsService(
    socket as never,
    { get: () => undefined } as never,
    dbs,
    undefined,
    push,
    routing,
  );
  const co = textCollaborators(dbs);
  const text = new TextSenderService(dbs, co.transports, co.usage);
  const notes = new NotesService(dbs, team, notifications as any, push, text, hold);
  const release = new AwayReleaseService(dbs, hold, routing, notes, notifications as any, push, team);
  return { release, push };
}

describe("AwayReleaseService — one push path, against the real funnel", () => {
  it("[REVERT-FAILS] pushes a released message to that person exactly once", async () => {
    const db = seed({ house_away_held: [message(SAM)] });
    const { release, push } = realFunnelHarness(db);

    const tally = await release.sweep(NOW);

    expect(tally).toMatchObject({ released: 1, failed: 0 });
    expect(db.tables.notifications.map((r: any) => r.user_id)).toEqual([SAM]);
    // Dropping `skipMobilePush` makes this 2: the funnel's fan-out and the
    // release's own push leg each fire once.
    expect(push.sendToUsers).toHaveBeenCalledTimes(1);
    expect(push.sendToUsers.mock.calls[0][0]).toEqual([SAM]);
  });

  it("[REVERT-FAILS] never pushes an inbox-only held message", async () => {
    const db = seed({ house_away_held: [message(SAM, { channels: ["inbox"] })] });
    const { release, push } = realFunnelHarness(db);

    const tally = await release.sweep(NOW);

    expect(tally).toMatchObject({ released: 1, failed: 0 });
    expect(db.tables.notifications.map((r: any) => r.user_id)).toEqual([SAM]);
    expect(push.sendToUsers).not.toHaveBeenCalled();
  });

  it("[REVERT-FAILS] never pushes a person who switched push off", async () => {
    const db = seed({
      house_away_held: [message(SAM)],
      notification_preferences: [
        { user_id: SAM, restaurant_id: HOUSE, email_enabled: true, sms_enabled: true, push_enabled: false },
      ],
    });
    const { release, push } = realFunnelHarness(db);

    const tally = await release.sweep(NOW);

    expect(tally).toMatchObject({ released: 1, failed: 0 });
    expect(push.sendToUsers).not.toHaveBeenCalled();
  });
});
