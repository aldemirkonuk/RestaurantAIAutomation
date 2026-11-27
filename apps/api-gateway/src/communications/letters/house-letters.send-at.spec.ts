/**
 * Send at a house-clock time (r110 mail-gap g1).
 *
 * The writer picks a choice, the server reads it on the house's clock: local
 * wall time first, then UTC, so 08:00 stays 08:00 across a DST change, and a
 * minute that does not exist goes to the next one that does. Owners and
 * managers only; a house with no zone is refused in words. A letter set for
 * later re-reads its writer's standing when it is due.
 *
 * Queue: the by-table stub of a-reply-from-mail-answers-its-letter.spec.ts.
 * Dispatch: the filtering fake database of queued-letter-keeps-its-mailbox.spec.ts.
 */
import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { HouseLettersService, LETTER_STATUS } from "./house-letters.service";
import { HouseSenderService, GMAIL_SEND_SCOPE } from "./house-sender.service";
import { houseClockSendAt, houseWallToInstant, sendAtOutOfBounds, SEND_AT_MAX_MS } from "./send-at";
import { HOUSE as FAKE_HOUSE, ME, G_MINE, fakeDb, grants } from "../mail-setup/fake-db.testing";

const HOUSE = "aaaaaaaa-0000-4000-8000-aaaaaaaaaaaa";
const PROVIDER = "cccccccc-0000-4000-8000-cccccccccccc";
const PERSON = "dddddddd-0000-4000-8000-dddddddddddd";
const BERLIN = "Europe/Berlin";
const iso = (ms: number) => new Date(ms).toISOString();

describe("a choice read on the house's clock", () => {
  it("tomorrow 08:00 is 08:00 in Berlin on both sides of 2027-03-28", () => {
    // Friday 26th, winter time (+01:00): Saturday 08:00 is 07:00Z.
    const fri = houseClockSendAt("tomorrow_0800", Date.parse("2027-03-26T12:00:00Z"), BERLIN);
    expect(iso(fri.atMs)).toBe("2027-03-27T07:00:00.000Z");
    expect(fri.chosen).toEqual({ choice: "tomorrow_0800", local: "2027-03-27 08:00", zone: BERLIN });
    // Saturday 27th, still winter time; Sunday 08:00 is summer time (+02:00): 06:00Z.
    const sat = houseClockSendAt("tomorrow_0800", Date.parse("2027-03-27T12:00:00Z"), BERLIN);
    expect(iso(sat.atMs)).toBe("2027-03-28T06:00:00.000Z");
    expect(sat.chosen.local).toBe("2027-03-28 08:00");
  });

  it("tomorrow is the house's tomorrow, not UTC's", () => {
    // 23:30Z on the 27th is already 00:30 on the 28th in Berlin.
    const late = houseClockSendAt("tomorrow_0800", Date.parse("2027-03-27T23:30:00Z"), BERLIN);
    expect(late.chosen.local).toBe("2027-03-29 08:00");
    expect(iso(late.atMs)).toBe("2027-03-29T06:00:00.000Z");
  });

  it("Monday 08:00 is the next Monday, never today", () => {
    const sat = houseClockSendAt("monday_0800", Date.parse("2027-03-27T12:00:00Z"), BERLIN);
    expect(sat.chosen.local).toBe("2027-03-29 08:00");
    expect(iso(sat.atMs)).toBe("2027-03-29T06:00:00.000Z");
    const mon = houseClockSendAt("monday_0800", Date.parse("2027-03-29T05:00:00Z"), BERLIN);
    expect(mon.chosen.local).toBe("2027-04-05 08:00");
  });

  it("Istanbul has no DST: 08:00 is 05:00Z", () => {
    const out = houseClockSendAt("tomorrow_0800", Date.parse("2027-03-27T12:00:00Z"), "Europe/Istanbul");
    expect(iso(out.atMs)).toBe("2027-03-28T05:00:00.000Z");
  });

  it("in an hour is an hour, recorded as the house's wall time", () => {
    const now = Date.parse("2027-03-28T00:30:00Z"); // 01:30 CET; +1 h crosses the gap
    const out = houseClockSendAt("in_1h", now, BERLIN);
    expect(out.atMs).toBe(now + 3_600_000);
    expect(out.chosen.local).toBe("2027-03-28 03:30");
  });

  it("a minute inside the spring-forward gap goes to the next minute that exists", () => {
    // 02:30 on 2027-03-28 does not exist in Berlin; 03:00 CEST is 01:00Z.
    expect(iso(houseWallToInstant("2027-03-28", "02:30", BERLIN))).toBe("2027-03-28T01:00:00.000Z");
    expect(iso(houseWallToInstant("2027-03-28", "02:00", BERLIN))).toBe("2027-03-28T01:00:00.000Z");
    // The same minute a day earlier exists and is kept.
    expect(iso(houseWallToInstant("2027-03-27", "02:30", BERLIN))).toBe("2027-03-27T01:30:00.000Z");
    expect(iso(houseWallToInstant("2027-03-28", "03:01", BERLIN))).toBe("2027-03-28T01:01:00.000Z");
  });

  it("bounds: no earlier than the undo window, no later than 30 days", () => {
    const now = 1_000_000_000;
    expect(sendAtOutOfBounds(now + 119_999, now, 120_000)).toMatch(/sooner than the window/);
    expect(sendAtOutOfBounds(now + 120_000, now, 120_000)).toBeNull();
    expect(sendAtOutOfBounds(now + SEND_AT_MAX_MS, now, 120_000)).toBeNull();
    expect(sendAtOutOfBounds(now + SEND_AT_MAX_MS + 1, now, 120_000)).toMatch(/at most 30 days/);
  });
});

// ── queue ────────────────────────────────────────────────────────────────────

function stub(rows: Record<string, unknown[]>) {
  const inserts: Record<string, any>[] = [];
  const chain = (data: unknown[]) => {
    const self: any = {};
    for (const m of ["select", "eq", "in", "is", "or", "lte", "gte", "order", "limit", "update"]) self[m] = () => self;
    self.insert = (body: Record<string, any>) => (inserts.push(body), self);
    self.single = () => Promise.resolve({ data: { id: "letter-1" }, error: null });
    self.maybeSingle = () => Promise.resolve({ data: data[0] ?? null, error: null });
    self.then = (res: any) => Promise.resolve({ data, error: null }).then(res);
    return self;
  };
  return { db: { client: { from: (t: string) => chain(rows[t] ?? []) } } as any, inserts };
}

const BOOK = {
  providers: [{ id: PROVIDER, name: "Fikri", contact_email: "fikri@fikritarim.com", primary_contact: null }],
  provider_contacts: [],
  analytics_insights: [],
  procurement_conversations: [],
  integration_oauth_connections: [
    {
      id: "conn-1",
      user_id: PERSON,
      integration_id: "gmail_send",
      provider: "google",
      account_email: "siparis@lokanta.example",
      scopes: [GMAIL_SEND_SCOPE, "openid"],
      restaurant_id: HOUSE,
      revoked_at: null,
    },
  ],
};

const NOW = Date.parse("2027-03-27T12:00:00Z");

function queueWith(opts: { role?: string; restaurant?: Record<string, unknown> | null; extra?: Record<string, unknown> }) {
  const { db, inserts } = stub({
    ...BOOK,
    restaurants: opts.restaurant === null ? [] : [opts.restaurant ?? { timezone: BERLIN, country: "DE" }],
  });
  const sender = new HouseSenderService(db, { get: () => undefined } as any);
  const oauth = { getAccessToken: jest.fn().mockResolvedValue("ya29.token") } as any;
  const redeem = jest.fn(async () => ({ sealId: "seal-1" }));
  const authority = {
    assertMaySend: async () => ({ mode: "send", basis: "manager", grant: null, role: "manager" }),
    witnessGrantUse: async () => undefined,
  };
  const requests = { one: jest.fn(), claim: jest.fn(), unclaim: jest.fn() };
  const svc = new HouseLettersService(db, sender, oauth, authority as any, { redeem } as any, requests as any);
  const run = svc.queue({
    restaurantId: HOUSE,
    userId: PERSON,
    role: opts.role ?? "manager",
    dto: {
      providerId: PROVIDER,
      to: "fikri@fikritarim.com",
      subject: "Order for Monday",
      body: "Two cases, please.",
      sendAt: "tomorrow_0800",
      ...opts.extra,
    } as any,
  });
  return { run, inserts, redeem, requests, svc };
}

describe("queue with a chosen time", () => {
  beforeEach(() => jest.spyOn(Date, "now").mockReturnValue(NOW));
  afterEach(() => jest.restoreAllMocks());

  it("an owner's letter waits until 08:00 on the house's clock, and says so", async () => {
    const { run, inserts, redeem } = queueWith({ role: "owner" });
    const out = await run;
    expect(inserts).toHaveLength(1);
    expect(inserts[0].scheduled_send_at).toBe("2027-03-28T06:00:00.000Z");
    expect(inserts[0].email_headers.send_at_chosen).toEqual({
      choice: "tomorrow_0800",
      local: "2027-03-28 08:00",
      zone: BERLIN,
    });
    expect(out.dispatchAt).toBe("2027-03-28T06:00:00.000Z");
    expect(out.sendAtChosen).toEqual(inserts[0].email_headers.send_at_chosen);
    expect(out.says).toContain("2027-03-28 08:00 on the house's clock (Europe/Berlin)");
    // The seal is over the words, not the time.
    expect(JSON.stringify((redeem.mock.calls[0] as any[])[0].args)).not.toMatch(/sendAt|tomorrow/);
  });

  it("a house with no zone of its own reads its country's only zone", async () => {
    const { run, inserts } = queueWith({ restaurant: { timezone: null, country: "TR" } });
    await run;
    expect(inserts[0].scheduled_send_at).toBe("2027-03-28T05:00:00.000Z");
    expect(inserts[0].email_headers.send_at_chosen.zone).toBe("Europe/Istanbul");
  });

  it("a letter with no choice still leaves after the undo window, with nothing recorded", async () => {
    const { run, inserts } = queueWith({ extra: { sendAt: undefined } });
    const out = await run;
    expect(inserts[0].email_headers).not.toHaveProperty("send_at_chosen");
    expect(Date.parse(out.dispatchAt) - NOW).toBe(out.undoMs ?? 0);
    expect(out.sendAtChosen).toBeNull();
  });

  it("a staff member's letter with a time is a 400, and nothing is queued", async () => {
    const { run, inserts, redeem } = queueWith({ role: "staff" });
    await expect(run).rejects.toBeInstanceOf(BadRequestException);
    await expect(run).rejects.toThrow(/owner or a manager can set a letter to leave later/);
    expect(inserts).toHaveLength(0);
    expect(redeem).not.toHaveBeenCalled();
  });

  it("a released request with a time is a 400, before the request is read or taken", async () => {
    const { run, inserts, requests } = queueWith({ extra: { requestId: "eeeeeeee-0000-4000-8000-eeeeeeeeeeee" } });
    await expect(run).rejects.toBeInstanceOf(BadRequestException);
    await expect(run).rejects.toThrow(/released request leaves now/);
    expect(requests.one).not.toHaveBeenCalled();
    expect(requests.claim).not.toHaveBeenCalled();
    expect(inserts).toHaveLength(0);
  });

  it("a house with no zone is refused in words, never read as UTC", async () => {
    for (const restaurant of [{ timezone: null, country: "US" }, null]) {
      const { run, inserts } = queueWith({ restaurant });
      await expect(run).rejects.toBeInstanceOf(ConflictException);
      await expect(run).rejects.toThrow(/time zone isn't set/);
      expect(inserts).toHaveLength(0);
    }
  });

  it("a staff member's ask with a time is a 400", async () => {
    const { svc, run } = queueWith({});
    await run; // the queue half is the case above; this one is the ask
    await expect(
      svc.ask({
        restaurantId: HOUSE,
        userId: PERSON,
        dto: { providerId: PROVIDER, to: "fikri@fikritarim.com", subject: "s", body: "b", sendAt: "in_1h" } as any,
      }),
    ).rejects.toThrow(/when it leaves is theirs to choose/);
  });
});

// ── dispatch ─────────────────────────────────────────────────────────────────

describe("a letter set for later re-reads its writer when it is due", () => {
  const realFetch = globalThis.fetch;
  afterEach(() => {
    (globalThis as any).fetch = realFetch;
  });

  function due(headers: Record<string, unknown>, assertMaySend: jest.Mock) {
    const db = fakeDb({
      integration_oauth_connections: { rows: grants() },
      users: { rows: [] },
      house_mail_sender_choice: { rows: [] },
      procurement_conversations: {
        rows: [
          {
            id: "letter-1",
            restaurant_id: FAKE_HOUSE,
            provider_id: "p-1",
            status: LETTER_STATUS.QUEUED,
            scheduled_send_at: "2027-03-28T06:00:00.000Z",
            message_text: "Two cases, please.",
            email_headers: {
              to: "vendor@vendor.test",
              subject: "Order",
              written_by: ME,
              sender_connection_id: G_MINE,
              sender_address: "me@house.test",
              ...headers,
            },
          },
        ],
      },
    });
    const sender = new HouseSenderService(db as any, { get: () => undefined } as any);
    const oauth = { getAccessToken: jest.fn().mockResolvedValue("ya29.token") };
    const svc = new HouseLettersService(db as any, sender, oauth as any, { assertMaySend } as any);
    const sent: string[] = [];
    (globalThis as any).fetch = jest.fn(async () => {
      sent.push("x");
      return { ok: true, status: 200, json: async () => ({ id: "g-1" }), text: async () => "" };
    });
    return { db, svc, sent, oauth };
  }
  const CHOSEN = { send_at_chosen: { choice: "tomorrow_0800", local: "2027-03-28 08:00", zone: BERLIN } };
  const failure = (db: ReturnType<typeof fakeDb>) =>
    db.writes.find((w) => w.payload?.status === LETTER_STATUS.FAILED)?.payload?.constraint_flags?.house_letter_failure;
  const AT = Date.parse("2027-03-28T06:01:00Z");

  it("a writer removed from the house since: HOUSE_FAILED, in words, and nothing leaves", async () => {
    const assertMaySend = jest.fn(async () => {
      throw new ForbiddenException("You are not a member of this house.");
    });
    const { db, svc, sent, oauth } = due(CHOSEN, assertMaySend);
    expect(await svc.dispatchDue(AT)).toMatchObject({ sent: 0, failed: 1 });
    expect(assertMaySend).toHaveBeenCalledWith(ME, FAKE_HOUSE, "send this letter", { canAsk: false });
    expect(sent).toEqual([]);
    expect(oauth.getAccessToken).not.toHaveBeenCalled();
    expect(failure(db)).toBe(
      "the person who wrote it can no longer send for this house, so it did not leave at the time chosen; nothing was sent",
    );
  });

  it("a standing that cannot be read is not a send either", async () => {
    const assertMaySend = jest.fn(async () => {
      throw new Error("timeout");
    });
    const { db, svc, sent } = due(CHOSEN, assertMaySend);
    expect(await svc.dispatchDue(AT)).toMatchObject({ sent: 0, failed: 1 });
    expect(sent).toEqual([]);
    expect(failure(db)).toContain("could not be read (timeout)");
  });

  it("a writer who still may send: it leaves through its pinned grant", async () => {
    const assertMaySend = jest.fn(async () => ({ mode: "send" }));
    const { svc, sent, oauth } = due(CHOSEN, assertMaySend);
    expect(await svc.dispatchDue(AT)).toMatchObject({ sent: 1, failed: 0 });
    expect(sent).toHaveLength(1);
    expect(oauth.getAccessToken).toHaveBeenCalledWith(ME, FAKE_HOUSE, "gmail_send");
  });

  it("a letter with no chosen time is not re-read (the undo-window path is unchanged)", async () => {
    const assertMaySend = jest.fn(async () => {
      throw new ForbiddenException("x");
    });
    const { svc, sent } = due({}, assertMaySend);
    expect(await svc.dispatchDue(AT)).toMatchObject({ sent: 1 });
    expect(assertMaySend).not.toHaveBeenCalled();
    expect(sent).toHaveLength(1);
  });
});
