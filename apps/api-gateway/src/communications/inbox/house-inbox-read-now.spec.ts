/**
 * 'Check now' (DD-r106-9 / DD-r108-47): one read of the house's mailbox sooner
 * than the 5-minute run, at most once a minute, and never overlapping another
 * read of the same grant.
 *
 * The database here is a small stateful fake whose `house_inbox_claim_read`
 * follows the migration's rule (check_now_reads_the_house_mailbox_once_a_minute_at_most):
 * a held, unexpired lease refuses; a floor above 0 refuses inside the minute of
 * the last read or the last accepted press. The SQL itself was replayed in
 * PGlite; what these specs pin is that the service never reads without it.
 */

import { DatabaseService } from "../../database/database.service";
import { IntegrationsOauthService } from "../../integrations/integrations-oauth.service";
import { OrchestratorService } from "../../common/orchestrator/orchestrator.service";
import { HouseLettersService } from "../letters/house-letters.service";
import { HouseSenderService } from "../letters/house-sender.service";
import {
  GMAIL_READ_SCOPE,
  HouseInboxService,
  READ_NOW_FLOOR_SECONDS,
} from "./house-inbox.service";

const HOUSE = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const GRANT = "eeeeeeee-0000-4000-8000-eeeeeeeeeeee";
const VENDOR = "fikri@fikritarim.com";
const T0 = 1_800_000_000_000;

interface Cursor {
  connection_id: string;
  restaurant_id: string;
  last_internal_date: number;
  last_read_at: string | null;
  read_now_at: string | null;
  reading_until: string | null;
  reading_token: string | null;
}

/** The database: one cursor row with state, everything else static. */
function house(opts: { claimFails?: boolean } = {}) {
  const clock = { now: T0 };
  const cursor: Cursor = {
    connection_id: GRANT,
    restaurant_id: HOUSE,
    last_internal_date: T0 - 3_600_000,
    last_read_at: new Date(T0 - 10 * 60_000).toISOString(),
    read_now_at: null,
    reading_until: null,
    reading_token: null,
  };
  const claims: Array<{ floor: number; claimed: boolean }> = [];
  let tokens = 0;
  const statics: Record<string, unknown[]> = {
    integration_oauth_connections: [
      {
        id: GRANT,
        user_id: "dddddddd-0000-4000-8000-dddddddddddd",
        restaurant_id: HOUSE,
        integration_id: "gmail_read",
        scopes: [GMAIL_READ_SCOPE],
        revoked_at: null,
      },
    ],
    restaurant_feature_flags: [{ enable_house_inbox_read: true }],
    providers: [
      { id: "p1", name: "Fikri", contact_email: VENDOR, primary_contact: { name: "F", email: VENDOR } },
    ],
    provider_contacts: [],
  };

  const chain = (table: string) => {
    const filters: Record<string, unknown> = {};
    let patch: Record<string, unknown> | null = null;
    const self: Record<string, unknown> = {};
    const pass = () => self;
    for (const k of ["select", "in", "is", "or", "lte", "gte", "order", "limit", "insert"]) self[k] = pass;
    self.eq = (col: string, v: unknown) => {
      filters[col] = v;
      return self;
    };
    self.update = (body: Record<string, unknown>) => {
      patch = body;
      return self;
    };
    const settle = () => {
      if (table !== "house_inbox_cursors") return { data: statics[table] ?? [], error: null };
      const hit = Object.entries(filters).every(
        ([k, v]) => (cursor as unknown as Record<string, unknown>)[k] === v,
      );
      if (patch && hit) Object.assign(cursor, patch);
      return { data: hit ? [cursor] : [], error: null };
    };
    self.maybeSingle = () => {
      const r = settle();
      return Promise.resolve({ data: r.data[0] ?? null, error: null });
    };
    self.single = self.maybeSingle;
    self.then = (resolve: (v: unknown) => unknown) => Promise.resolve(settle()).then(resolve);
    return self;
  };

  const rpc = async (fn: string, a: Record<string, unknown>) => {
    if (fn !== "house_inbox_claim_read") throw new Error(`unexpected rpc ${fn}`);
    if (opts.claimFails) return { data: null, error: { message: "function does not exist" } };
    const now = clock.now;
    const floor = Number(a.p_floor_seconds);
    const lease = Number(a.p_lease_seconds);
    if (a.p_connection_id !== cursor.connection_id || a.p_restaurant_id !== cursor.restaurant_id) {
      return { data: { claimed: false, exists: false }, error: null };
    }
    const t = (s: string | null) => (s ? Date.parse(s) : -Infinity);
    const held = t(cursor.reading_until) > now;
    const since = Math.max(t(cursor.read_now_at), t(cursor.last_read_at));
    const early = floor > 0 && since > now - floor * 1000;
    if (!held && !early) {
      tokens += 1;
      cursor.reading_token = `lease-${tokens}`;
      cursor.reading_until = new Date(now + lease * 1000).toISOString();
      if (floor > 0) cursor.read_now_at = new Date(now).toISOString();
      claims.push({ floor, claimed: true });
      return { data: { claimed: true, token: cursor.reading_token }, error: null };
    }
    claims.push({ floor, claimed: false });
    return {
      data: {
        claimed: false,
        exists: true,
        busy: held,
        wait_seconds: floor > 0 && since > -Infinity ? Math.max(0, Math.ceil((since + floor * 1000 - now) / 1000)) : 0,
      },
      error: null,
    };
  };

  const db = { client: { from: (table: string) => chain(table), rpc } } as unknown as DatabaseService;
  return { db, cursor, clock, claims };
}

function message(id: string, internalDate: number) {
  return {
    id,
    threadId: `thread-${id}`,
    internalDate: String(internalDate),
    payload: {
      mimeType: "text/plain",
      headers: [
        { name: "From", value: `Fikri <${VENDOR}>` },
        { name: "Subject", value: `Order ${id}` },
        { name: "Message-ID", value: `<${id}@mail.example>` },
      ],
      body: { data: Buffer.from("ok", "utf-8").toString("base64url") },
    },
  };
}

/** Gmail, with the listing held until `open()` so two reads can overlap. */
function gmail(ids: string[]) {
  const urls: string[] = [];
  let open!: () => void;
  const gate = new Promise<void>((r) => (open = r));
  const impl = (async (input: unknown) => {
    const url = String(input);
    urls.push(url);
    if (url.includes("/messages?")) {
      await gate;
      return { ok: true, status: 200, json: async () => ({ messages: ids.map((id) => ({ id, threadId: `thread-${id}` })) }) };
    }
    const id = /\/messages\/([^?/]+)/.exec(url)?.[1] ?? "";
    const i = ids.indexOf(id);
    return { ok: true, status: 200, json: async () => (i >= 0 ? message(id, T0 - 60_000 + i) : null) };
  }) as unknown as typeof fetch;
  return { urls, impl, open: () => open() };
}

function serviceOver(db: DatabaseService) {
  const publish = jest.fn().mockResolvedValue(undefined);
  const oauth = { getAccessToken: jest.fn().mockResolvedValue("ya29.token") } as unknown as IntegrationsOauthService;
  const sender = new HouseSenderService(db, { get: () => undefined } as never);
  const letters = new HouseLettersService(db, sender, oauth);
  const service = new HouseInboxService(db, { publishEvent: publish } as unknown as OrchestratorService, oauth, letters);
  return { service, publish };
}

const filed = (publish: jest.Mock) =>
  publish.mock.calls.map((c) => (c[2] as { gmail_message_id?: string })?.gmail_message_id ?? JSON.stringify(c));

describe("Check now and the 5-minute run never read one grant at once", () => {
  it("files each message once when a press overlaps the run, whichever starts first", async () => {
    for (const pressFirst of [false, true]) {
      const { db, claims } = house();
      const { service, publish } = serviceOver(db);
      const g = gmail(["m1", "m2"]);
      service.fetchImpl = g.impl;

      const first = pressFirst ? service.readNow(HOUSE, T0) : service.readDue(T0);
      await new Promise((r) => setImmediate(r));
      const second = pressFirst ? service.readDue(T0) : service.readNow(HOUSE, T0);
      await new Promise((r) => setImmediate(r));
      g.open();
      const [a, b] = await Promise.all([first, second]);

      expect(publish).toHaveBeenCalledTimes(2);
      expect(new Set(filed(publish)).size).toBe(2);
      expect(claims.filter((c) => c.claimed)).toHaveLength(1);
      // The one that lost says so, and read nothing.
      const run = pressFirst ? b : a;
      const press = pressFirst ? a : b;
      if (pressFirst) {
        expect((run as { outcomes: Array<{ outcome: string }> }).outcomes[0].outcome).toBe("busy");
        expect((press as { outcome: string }).outcome).toBe("read");
      } else {
        expect((press as { outcome: string }).outcome).toBe("busy");
      }
      // Gmail was listed once, by the winner.
      expect(g.urls.filter((u) => u.includes("/messages?"))).toHaveLength(1);
    }
  });

  it("releases the lease when the read ends, so the next run is not locked out", async () => {
    const { db, cursor } = house();
    const { service } = serviceOver(db);
    const g = gmail(["m1"]);
    g.open();
    service.fetchImpl = g.impl;
    await service.readDue(T0);
    expect(cursor.reading_token).toBeNull();
    expect(cursor.reading_until).toBeNull();
  });
});

describe("a press is taken at most once a minute, and the minute is in the database", () => {
  it("refuses a second press inside 60 s without asking Gmail, and takes one after", async () => {
    const { db, clock, cursor } = house();
    const { service, publish } = serviceOver(db);
    const g = gmail([]);
    g.open();
    service.fetchImpl = g.impl;

    const one = await service.readNow(HOUSE, clock.now);
    expect(one.outcome).toBe("read");
    expect(cursor.read_now_at).not.toBeNull();
    const listings = g.urls.length;

    clock.now += 20_000;
    const two = await service.readNow(HOUSE, clock.now);
    expect(two.outcome).toBe("too_soon");
    expect(two.retryAfterSeconds).toBeGreaterThan(0);
    expect(two.retryAfterSeconds).toBeLessThanOrEqual(READ_NOW_FLOOR_SECONDS);
    expect(two.says).toMatch(/less than a minute ago/);
    expect(g.urls.length).toBe(listings);

    clock.now += (READ_NOW_FLOOR_SECONDS + 1) * 1000;
    const three = await service.readNow(HOUSE, clock.now);
    expect(three.outcome).toBe("read");
    expect(publish).not.toHaveBeenCalled();
  });

  it("is refused inside the minute after the 5-minute run read the mailbox", async () => {
    const { db, clock, cursor } = house();
    cursor.last_read_at = new Date(clock.now - 15_000).toISOString();
    const { service } = serviceOver(db);
    const g = gmail([]);
    g.open();
    service.fetchImpl = g.impl;
    const r = await service.readNow(HOUSE, clock.now);
    expect(r.outcome).toBe("too_soon");
    expect(g.urls).toHaveLength(0);
  });

  it("reads nothing when the lease cannot be checked", async () => {
    const { db } = house({ claimFails: true });
    const { service, publish } = serviceOver(db);
    const g = gmail(["m1"]);
    g.open();
    service.fetchImpl = g.impl;
    const press = await service.readNow(HOUSE, T0);
    const run = await service.readDue(T0);
    expect(press.outcome).toBe("error");
    expect(run.outcomes[0].outcome).toBe("error");
    expect(run.outcomes[0].says).toMatch(/could file a letter twice/);
    expect(g.urls).toHaveLength(0);
    expect(publish).not.toHaveBeenCalled();
  });

  it("reads only the asking house's grants", async () => {
    const { db } = house();
    const { service } = serviceOver(db);
    const g = gmail([]);
    g.open();
    service.fetchImpl = g.impl;
    const other = await service.readNow("bbbbbbbb-0000-4000-8000-bbbbbbbbbbbb", T0);
    expect(other.outcome).toBe("no_grant");
    expect(g.urls).toHaveLength(0);
  });
});
