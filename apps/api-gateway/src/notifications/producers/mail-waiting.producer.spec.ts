/**
 * MailWaitingProducer (r110 mail-gap g4): a letter waiting 24 h brings an owner or a manager to it,
 * once per thread per house day, never between 23:00 and 07:00 house time, with the name and the
 * wait only. Driven through the real ProducerLedgerService over the fake store, so the dedupe is
 * the claim index's, not the spec's.
 */

import { MailWaitingProducer, NO_ZONE_NOTE, MAIL_WAITING_PEOPLE_CAP } from "./mail-waiting.producer";
import { ProducerLedgerService } from "./producer-ledger.service";
import { FakeDb, fakeDatabase, fakeNotifications } from "./testing/fake-db";

const TENANT = "rest-1";
const OTHER = "rest-2";
const OWNER = "user-owner";
const MANAGER = "user-manager";
const STAFF = "user-staff";
const MEMBERS = [OWNER, MANAGER, STAFF];
const AUDIENCE = { ready: [...MEMBERS], deferred: [] as string[] };
const ZONE = "America/New_York"; // UTC-5 in November
const V1 = "11111111-1111-4111-8111-111111111111";
const V2 = "22222222-2222-4222-8222-222222222222";
const H = 3_600_000;
/** 09:00 on 27 Nov in the house. */
const NINE = new Date("2026-11-27T14:00:00Z");
const ago = (now: Date, ms: number) => new Date(now.getTime() - ms).toISOString();

type Thread = { provider_id: string; thread_key: string; waiting: boolean; waiting_since: string | null; house?: string };
type Person = { key: string; provider_id: string; name: string | null; waiting: boolean; waiting_since: string | null; house?: string };

function build(opts: { zone?: string | null; people?: Person[]; threads?: Thread[] } = {}) {
  const db = new FakeDb();
  const database = fakeDatabase(db, MEMBERS);
  const notifications = fakeNotifications(MEMBERS);
  const ledger = new ProducerLedgerService(database as any, notifications as any);
  const producer = new MailWaitingProducer(database as any, ledger);
  db.tables.restaurants.push(
    opts.zone === null ? { id: TENANT, timezone: null, country: null } : { id: TENANT, timezone: opts.zone ?? ZONE, country: "US" },
  );
  db.tables.user_restaurant_access.push(
    { user_id: OWNER, restaurant_id: TENANT, role: "owner", is_active: true },
    { user_id: MANAGER, restaurant_id: TENANT, role: "manager", is_active: true },
    { user_id: STAFF, restaurant_id: TENANT, role: "staff", is_active: true },
  );
  const people = opts.people ?? [];
  const threads = opts.threads ?? [];
  const asked: Array<[string, Record<string, any>]> = [];
  db.rpcHandlers.list_mail_people = (a) => {
    asked.push(["list_mail_people", a]);
    // The SQL's own rule: only this house, only the waiting.
    const rows = people.filter((p) => (p.house ?? TENANT) === a.p_restaurant_id && (!a.p_waiting_only || p.waiting));
    return { data: rows.slice(0, a.p_limit), error: null };
  };
  db.rpcHandlers.mail_thread_states = (a) => {
    asked.push(["mail_thread_states", a]);
    const rows = threads.filter((t) => (t.house ?? TENANT) === a.p_restaurant_id && t.provider_id === a.p_provider_id);
    return { data: rows, error: null };
  };
  return { db, notifications, producer, asked };
}

const fikri = (since: string, over: Partial<Person> = {}): Person => ({
  key: `vendor:${V1}`, provider_id: V1, name: "Fikri Tarım", waiting: true, waiting_since: since, ...over,
});
const thread = (key: string, since: string | null, waiting = true, over: Partial<Thread> = {}): Thread => ({
  provider_id: V1, thread_key: key, waiting, waiting_since: since, ...over,
});
const sent = (n: ReturnType<typeof fakeNotifications>) => n.persistForRestaurant.calls.map((c) => c[1]);

describe("MailWaitingProducer", () => {
  it("fires at 24 hours exactly, and not a minute before", async () => {
    const at24 = build({ people: [fikri(ago(NINE, 24 * H))], threads: [thread("t1", ago(NINE, 24 * H))] });
    await at24.producer.sweepTenant(TENANT, ZONE, AUDIENCE, NINE);
    expect(at24.notifications.persistForRestaurant.calls).toHaveLength(1);

    const early = ago(NINE, 24 * H - 60_000);
    const before = build({ people: [fikri(early)], threads: [thread("t1", early)] });
    const tally = await before.producer.sweepTenant(TENANT, ZONE, AUDIENCE, NINE);
    expect(before.notifications.persistForRestaurant.calls).toHaveLength(0);
    expect(tally.withheldReason).toMatch(/No letter has waited 24 hours/);
  });

  it("says the name and the wait, opens the thread, and carries no letter text", async () => {
    const { notifications, producer } = build({ people: [fikri(ago(NINE, 26 * H))], threads: [thread("t1", ago(NINE, 26 * H))] });
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NINE);
    const [p] = sent(notifications);
    expect(p).toMatchObject({
      type: "mail_waiting",
      title: "Fikri Tarım has waited 26 hours for an answer",
      message: "Fikri Tarım's letter has waited 26 hours for an answer from the house.",
      actionUrl: `/communications?tab=mail&with=vendor%3A${V1}&thread=t1`,
      actionLabel: "Open the letter",
    });
    expect(p.metadata).toMatchObject({ threadKey: "t1", waitedHours: 26, houseDate: "2026-11-27", houseZone: ZONE, quietHours: "23:00-07:00" });
    expect(p.metadata.noZone).toBeUndefined();
  });

  it("days from two days on", async () => {
    const { notifications, producer } = build({ people: [fikri(ago(NINE, 50 * H))], threads: [thread("t1", ago(NINE, 50 * H))] });
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NINE);
    expect(sent(notifications)[0].title).toBe("Fikri Tarım has waited 2 days for an answer");
  });

  it("once per thread per house day, counted in the house's zone across UTC midnight", async () => {
    const since = ago(NINE, 30 * H);
    const { notifications, producer } = build({ people: [fikri(since)], threads: [thread("t1", since)] });
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NINE);
    // 22:30 on 27 Nov in the house, but already 28 Nov in UTC: the same house day.
    const t2 = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, new Date("2026-11-28T03:30:00Z"));
    expect(t2.alreadyClaimed).toBe(1);
    expect(notifications.persistForRestaurant.calls).toHaveLength(1);
    // 07:15 on 28 Nov in the house: a new house day.
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, new Date("2026-11-28T12:15:00Z"));
    expect(notifications.persistForRestaurant.calls).toHaveLength(2);
    expect(sent(notifications)[1].metadata.houseDate).toBe("2026-11-28");
  });

  it("one thread key to two vendors is two waiting letters, each told once", async () => {
    // A mid:/gm: key can be shared by one price request sent to two vendors; Mail's thread is
    // (provider, key), so the dedupe is per person too.
    const since = ago(NINE, 30 * H);
    const V2KEY = `vendor:${V2}`;
    const { notifications, producer } = build({
      people: [fikri(since), fikri(since, { key: V2KEY, provider_id: V2, name: "Ege Süt" })],
      threads: [thread("gm:k", since), thread("gm:k", since, true, { provider_id: V2 })],
    });
    const t = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NINE);
    expect(t.alreadyClaimed).toBe(0);
    expect(sent(notifications).map((p) => p.metadata.personKey).sort()).toEqual([`vendor:${V1}`, V2KEY].sort());
  });

  it("nothing goes out 23:00-07:00 house time; everyone is deferred, then told at 07:00", async () => {
    const since = ago(NINE, 30 * H);
    const { notifications, producer } = build({ people: [fikri(since)], threads: [thread("t1", since)] });
    for (const at of ["2026-11-28T04:00:00Z", "2026-11-28T11:59:00Z"]) {
      const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, new Date(at)); // 23:00, 06:59
      expect(tally.deferredQuietHours).toBe(2);
      expect(tally.emitted).toBe(0);
    }
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, new Date("2026-11-28T03:59:00Z")); // 22:59
    expect(notifications.persistForRestaurant.calls).toHaveLength(1);
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, new Date("2026-11-28T12:00:00Z")); // 07:00
    expect(notifications.persistForRestaurant.calls).toHaveLength(2);
  });

  it("a house with no zone has no quiet hours, dates its day in UTC, and says so", async () => {
    const at = new Date("2026-11-28T03:00:00Z");
    const since = ago(at, 30 * H);
    const { notifications, producer } = build({ zone: null, people: [fikri(since)], threads: [thread("t1", since)] });
    await producer.sweepTenant(TENANT, "UTC", AUDIENCE, at);
    const [p] = sent(notifications);
    expect(p.metadata).toMatchObject({ houseZone: null, quietHours: null, noZone: NO_ZONE_NOTE, houseDate: "2026-11-28" });
  });

  it("owners and managers only: staff are never told", async () => {
    const since = ago(NINE, 30 * H);
    const { notifications, producer } = build({ people: [fikri(since)], threads: [thread("t1", since)] });
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NINE);
    expect(notifications.persistForRestaurant.calls[0][2].onlyUserIds.sort()).toEqual([MANAGER, OWNER]);
  });

  it("when who the managers are cannot be read, nobody is told", async () => {
    const since = ago(NINE, 30 * H);
    const { db, notifications, producer } = build({ people: [fikri(since)], threads: [thread("t1", since)] });
    db.failures.user_restaurant_access = "connection reset";
    const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NINE);
    expect(tally.failed).toBe(1);
    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
  });

  it("reads only this house: another house's waiting letter is never read or said", async () => {
    const since = ago(NINE, 30 * H);
    const { notifications, producer, asked } = build({
      people: [fikri(since, { house: OTHER })],
      threads: [thread("theirs", since, true, { house: OTHER })],
    });
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NINE);
    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
    expect(asked.every(([, a]) => a.p_restaurant_id === TENANT)).toBe(true);
    expect(asked[0][1]).toMatchObject({ p_waiting_only: true, p_withhold_house_letters: false });
  });

  it("an answered thread is silent, while the same person's waiting one is said", async () => {
    const since = ago(NINE, 30 * H);
    const { notifications, producer } = build({
      people: [fikri(since)],
      threads: [thread("answered", null, false), thread("not-now", since, false), thread("waits", since), thread("recent", ago(NINE, 2 * H))],
    });
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NINE);
    expect(sent(notifications).map((p) => p.metadata.threadKey)).toEqual(["waits"]);
  });

  it("a person the list does not call waiting is not read further", async () => {
    const since = ago(NINE, 30 * H);
    const { notifications, producer, asked } = build({
      people: [fikri(since, { waiting: false }), fikri(since, { key: `vendor:${V2}`, provider_id: V2, waiting_since: ago(NINE, H) })],
      threads: [thread("t1", since), thread("t2", since, true, { provider_id: V2 })],
    });
    await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NINE);
    expect(notifications.persistForRestaurant.calls).toHaveLength(0);
    expect(asked.filter(([n]) => n === "mail_thread_states")).toHaveLength(0);
  });

  it("a failed read is a failure, never 'nobody is waiting'", async () => {
    const { db, producer } = build();
    db.rpcHandlers.list_mail_people = () => ({ data: null, error: { message: "timeout" } });
    const tally = await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NINE);
    expect(tally.failed).toBe(1);
    expect(tally.withheldReason).toBeNull();
  });

  it("more waiting people than one sweep reads marks the run truncated", async () => {
    const people = Array.from({ length: MAIL_WAITING_PEOPLE_CAP + 1 }, (_, i) =>
      fikri(ago(NINE, H), { key: `vendor:${i}`, provider_id: `p-${i}` }),
    );
    const { producer } = build({ people });
    expect((await producer.sweepTenant(TENANT, ZONE, AUDIENCE, NINE)).truncated).toBe(true);
  });
});
