/**
 * MailService — the read model behind the /communications Mail tab.
 *
 * The database is a recording fake: every `from(...)` / `rpc(...)` call and
 * every chained filter is kept, and each read answers from a resolver the test
 * sets. Nothing leaves this process. The pure rules (cursor, page size, role,
 * door, Subject line) are proven in mail.read-rules.spec.ts.
 */
import {
  BadRequestException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { MailService } from "./mail.service";
import {
  MAIL_THREAD_PAGE,
  decodeMailCursor,
  encodeMailCursor,
} from "./mail.read-rules";

const HOUSE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const VENDOR = "c0000000-0000-4000-8000-000000000001";

type Call = { method: string; args: unknown[] };
type Query = {
  kind: "from" | "rpc";
  name: string;
  payload?: unknown;
  calls: Call[];
};
type Result = { data: unknown; error: { message: string } | null };

let queries: Query[] = [];
let resolve: (q: Query) => Result = () => ({ data: [], error: null });

function builder(q: Query): any {
  const chain: any = {};
  for (const m of [
    "select",
    "eq",
    "in",
    "or",
    "not",
    "order",
    "limit",
    "maybeSingle",
    "insert",
    "upsert",
    "update",
    "delete",
  ]) {
    chain[m] = (...args: unknown[]) => {
      q.calls.push({ method: m, args });
      return chain;
    };
  }
  chain.then = (ok: (r: Result) => unknown, bad?: (e: unknown) => unknown) =>
    Promise.resolve(resolve(q)).then(ok, bad);
  return chain;
}

const db = {
  supabase: {
    from: (name: string) => {
      const q: Query = { kind: "from", name, calls: [] };
      queries.push(q);
      return builder(q);
    },
    rpc: (name: string, payload: unknown) => {
      const q: Query = { kind: "rpc", name, payload, calls: [] };
      queries.push(q);
      return builder(q);
    },
  },
};

let inboundDomain: string | undefined;
const config = {
  get: (k: string) =>
    k === "INBOUND_EMAIL_DOMAIN" ? inboundDomain : undefined,
};

const service = () => new MailService(db as any, config as any);

beforeEach(() => {
  queries = [];
  resolve = () => ({ data: [], error: null });
  inboundDomain = undefined;
});

const BAD_CURSOR_WORDS = /not one this list made/;

function person(i: number) {
  return {
    key: `vendor:c0000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    kind: "vendor",
    provider_id: `c0000000-0000-4000-8000-${String(i).padStart(12, "0")}`,
    name: `Vendor ${i}`,
    last_at: `2026-11-07 10:00:00.00000${i % 10}+00`,
    last_line: "Hello",
    last_direction: "INBOUND",
    waiting: true,
    waiting_since: "2026-11-06 09:00:00+00",
    open_threads: 2,
    channels: ["email"],
    newest_open_order_id: null,
    newest_open_order_number: null,
    unsent_status: null,
  };
}

describe("listPeople", () => {
  it("keeps a vendor whose only letter has not left, and names its state (HARM 1)", async () => {
    resolve = () => ({
      data: [
        {
          ...person(4),
          last_line: "Please send 6 cases",
          last_direction: "outbound",
          waiting: false,
          waiting_since: null,
          open_threads: 0,
          unsent_status: "HOUSE_QUEUED",
        },
        person(5),
      ],
      error: null,
    });
    const page = await service().listPeople(HOUSE, "owner", {});
    expect(page.people.map((p) => p.unsentStatus)).toEqual([
      "HOUSE_QUEUED",
      null,
    ]);
    expect(page.people[0]).toMatchObject({
      waiting: false,
      lastDirection: "outbound",
      lastLine: "Please send 6 cases",
    });
  });


  it("a malformed cursor never reaches the database", async () => {
    await expect(
      service().listPeople(HOUSE, "owner", { after: "%%%" }),
    ).rejects.toThrow(BadRequestException);
    expect(queries).toHaveLength(0);
  });

  it("asks for one row more than the page and turns it into `next`", async () => {
    resolve = () => ({ data: [person(1), person(2), person(3)], error: null });
    const page = await service().listPeople(HOUSE, "owner", { limit: "2" });
    const rpc = queries[0];
    expect(rpc.name).toBe("list_mail_people");
    expect(rpc.payload).toMatchObject({
      p_restaurant_id: HOUSE,
      p_withhold_house_letters: false,
      p_limit: 3,
    });
    expect(page.people).toHaveLength(2);
    expect(page.people[0].lastDirection).toBe("inbound");
    expect(page.storedKinds).toEqual(["vendor"]);
    expect(page.next).not.toBeNull();
    expect(decodeMailCursor(page.next!)).toEqual({
      at: person(2).last_at,
      key: person(2).key,
    });
  });

  it("has no `next` on the last page", async () => {
    resolve = () => ({ data: [person(1), person(2)], error: null });
    const page = await service().listPeople(HOUSE, "staff", { limit: "2" });
    expect(page.next).toBeNull();
    expect(queries[0].payload).toMatchObject({
      p_withhold_house_letters: true,
    });
  });

  it("passes a cursor's time and key through untouched", async () => {
    const after = encodeMailCursor("2026-11-07 10:00:00.123456+00", "vendor:x");
    await service().listPeople(HOUSE, "owner", { after, waitingOnly: true });
    expect(queries[0].payload).toMatchObject({
      p_after_at: "2026-11-07 10:00:00.123456+00",
      p_after_key: "vendor:x",
      p_waiting_only: true,
    });
  });
});

describe("listThreads", () => {
  it.each(["", "vendor:not-a-uuid", `team:${VENDOR}`, VENDOR])(
    "%p names nobody: an empty page and no read",
    async (withKey) => {
      const page = await service().listThreads(HOUSE, "owner", {
        with: withKey,
      });
      expect(page).toEqual({ person: null, threads: [], next: null });
      expect(queries).toHaveLength(0);
    },
  );

  it("reads the person and the threads in this house, withheld for staff", async () => {
    resolve = (q) =>
      q.kind === "rpc"
        ? {
            data: [
              {
                thread_key: "t-1",
                subject: "Order 12",
                message_count: 4,
                last_at: "2026-11-07 10:00:00+00",
                last_direction: "outbound",
                waiting: false,
                order_id: null,
                order_number: null,
              },
            ],
            error: null,
          }
        : {
            data: [
              { provider_id: VENDOR, providers: { id: VENDOR, name: "Ali" } },
            ],
            error: null,
          };
    const page = await service().listThreads(HOUSE, "staff", {
      with: `vendor:${VENDOR}`,
    });
    expect(page.person).toEqual({
      key: `vendor:${VENDOR}`,
      kind: "vendor",
      providerId: VENDOR,
      name: "Ali",
    });
    expect(page.threads[0]).toMatchObject({
      key: "t-1",
      subject: "Order 12",
      messageCount: 4,
    });
    const lookup = queries.find((q) => q.kind === "from")!;
    expect(lookup.calls).toContainEqual({
      method: "eq",
      args: ["restaurant_id", HOUSE],
    });
    expect(lookup.calls.filter((c) => c.method === "or")).toHaveLength(2);
    expect(queries.find((q) => q.kind === "rpc")!.payload).toMatchObject({
      p_restaurant_id: HOUSE,
      p_provider_id: VENDOR,
      p_withhold_house_letters: true,
    });
  });
});

function letter(i: number) {
  // Newest first, as mail_thread_letters returns them. `at` is the letter's
  // own time (received for inbound, sent for outbound); created_at runs the
  // other way on purpose, as a mailbox backfill stores old letters last.
  return {
    id: `d0000000-0000-4000-8000-${String(1000 - i).padStart(12, "0")}`,
    provider_id: VENDOR,
    provider_name: "Ali",
    direction: i % 2 ? "outbound" : "inbound",
    channel: "email",
    message_text: `Subject: Order 12\nLetter ${i}`,
    ai_generated: false,
    status: "SENT",
    sent_at: null,
    received_at: null,
    at: `2026-11-07 10:${String(59 - (i % 60)).padStart(2, "0")}:00.000001+00`,
    created_at: `2026-11-08 10:${String(i % 60).padStart(2, "0")}:00.000001+00`,
    raw_deleted_at: null,
    mirrored_by_grant_id: null,
    thread_subject: "Order 12",
    order_id: null,
    order_number: null,
    order_status: null,
    // A function that grew these columns must still not leak them.
    email_headers: { "message-id": "<x@y>" },
    gmail_message_id: "g-1",
    message_id: "<x@y>",
  };
}

function threadResolver(pageRows: unknown[]): (q: Query) => Result {
  return (q) =>
    q.kind === "rpc" && q.name === "mail_thread_letters"
      ? { data: pageRows, error: null }
      : { data: null, error: { message: `unexpected read ${q.name}` } };
}

describe("getThread", () => {
  it("is one read of mail_thread_letters, never the table itself", async () => {
    resolve = threadResolver([letter(0)]);
    await service().getThread(HOUSE, "staff", { key: "t-1" });
    // The letters' files are read after, by the letters' own ids (gap 13),
    // and so is the mark a person left filing a held one (r37 w3 M-F2): the
    // letters themselves come only from mail_thread_letters.
    expect(queries.map((q) => `${q.kind}:${q.name}`)).toEqual([
      "rpc:mail_thread_letters",
      "from:conversation_attachments",
      "from:procurement_conversations",
    ]);
    expect(queries[0].payload).toEqual({
      p_restaurant_id: HOUSE,
      p_thread_key: "t-1",
      p_provider_id: null,
      p_withhold_house_letters: true,
      p_before_at: null,
      p_before_id: null,
      p_limit: MAIL_THREAD_PAGE + 1,
    });
  });

  it("holds at most 50 letters, oldest to newest, with a `before` cursor on the letter's own time", async () => {
    const rows = Array.from({ length: MAIL_THREAD_PAGE + 1 }, (_, i) =>
      letter(i),
    );
    resolve = threadResolver(rows);
    const page = await service().getThread(HOUSE, "owner", { key: "t-1" });

    expect(page.messages).toHaveLength(50);
    expect(page.messages[0].id).toBe(rows[49].id);
    expect(page.messages[49].id).toBe(rows[0].id);
    expect(page.before).not.toBeNull();
    // The cursor is (at, id) — the order the page is read in — never
    // created_at, which a backfill puts out of order (QA round 18, #895 T4).
    expect(decodeMailCursor(page.before!)).toEqual({
      at: rows[49].at,
      key: rows[49].id,
    });
    expect(page.subject).toBe("Order 12");
    expect(page.person?.name).toBe("Ali");
    expect(queries[0].payload).toMatchObject({
      p_withhold_house_letters: false,
    });
  });

  it("keeps the order the letters were written in, not the order they were stored", async () => {
    // Two letters: the inbound one was received first but stored last.
    const received = {
      ...letter(0),
      id: "d0000000-0000-4000-8000-00000000000a",
      direction: "inbound",
      received_at: "2026-11-07 09:00:00+00",
      at: "2026-11-07 09:00:00+00",
      created_at: "2026-11-07 12:00:00+00",
      message_text: "first written",
    };
    const sent = {
      ...letter(1),
      id: "d0000000-0000-4000-8000-00000000000b",
      sent_at: "2026-11-07 10:00:00+00",
      at: "2026-11-07 10:00:00+00",
      created_at: "2026-11-07 10:00:00+00",
      message_text: "answered",
    };
    resolve = threadResolver([sent, received]);
    const page = await service().getThread(HOUSE, "owner", { key: "t-1" });
    expect(page.messages.map((m) => m.text)).toEqual([
      "first written",
      "answered",
    ]);
  });

  it("names automatic mail (a bounce, an auto-reply) so it is never read as a letter (M-5)", async () => {
    resolve = threadResolver([
      { ...letter(0), automatic: true, message_text: "Delivery failed" },
      letter(1),
    ]);
    const page = await service().getThread(HOUSE, "owner", { key: "t-1" });
    expect(page.messages.map((m) => m.automatic)).toEqual([false, true]);
  });

  it("never answers with email headers, Gmail ids or message ids", async () => {
    resolve = threadResolver([letter(0), letter(1)]);
    const page = await service().getThread(HOUSE, "owner", { key: "t-1" });
    const text = JSON.stringify(page);
    expect(text).not.toMatch(/email_headers|gmail|message_id|messageId/i);
    expect(page.before).toBeNull();
  });

  it("strips the Subject line from each letter and names its door", async () => {
    resolve = threadResolver([letter(1), letter(0)]);
    const page = await service().getThread(HOUSE, "owner", { key: "t-1" });
    expect(page.messages.map((m) => m.text)).toEqual(["Letter 0", "Letter 1"]);
    expect(page.messages.map((m) => m.door)).toEqual([
      "mudavym_mail",
      "from_house",
    ]);
    expect(page.messages[0].direction).toBe("inbound");
  });

  it("names the thread's order from the function's columns", async () => {
    resolve = threadResolver([
      {
        ...letter(0),
        order_id: "e0000000-0000-4000-8000-000000000001",
        order_number: "PO-7",
        order_status: "SENT",
      },
    ]);
    const page = await service().getThread(HOUSE, "owner", { key: "t-1" });
    expect(page.order).toEqual({
      id: "e0000000-0000-4000-8000-000000000001",
      number: "PO-7",
      status: "SENT",
    });
  });

  it("reads the older page from the cursor, keyed on time then id", async () => {
    const before = encodeMailCursor(
      "2026-11-07 10:00:00.000001+00",
      letter(3).id,
    );
    resolve = threadResolver([]);
    await service().getThread(HOUSE, "staff", { key: "t-1", before });
    expect(queries[0].payload).toMatchObject({
      p_before_at: "2026-11-07 10:00:00.000001+00",
      p_before_id: letter(3).id,
    });
  });

  it("refuses a `before` cursor whose key is not a letter id", async () => {
    const before = encodeMailCursor("2026-11-07 10:00:00+00", "x),id.gt.0");
    await expect(
      service().getThread(HOUSE, "owner", { key: "t-1", before }),
    ).rejects.toThrow(BAD_CURSOR_WORDS);
    expect(queries).toHaveLength(0);
  });

  it("asks for a thread when none is named", async () => {
    await expect(
      service().getThread(HOUSE, "owner", { key: " " }),
    ).rejects.toThrow(BadRequestException);
  });

  it("a repeated parameter is a bad request or an empty page, never a crash", async () => {
    await expect(
      service().getThread(HOUSE, "owner", { key: ["a", "b"] }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service().getThread(HOUSE, "owner", { key: "t-1", before: ["a", "b"] }),
    ).rejects.toThrow(BAD_CURSOR_WORDS);
    const page = await service().getThread(HOUSE, "owner", {
      key: "t-1",
      with: [`vendor:${VENDOR}`, "vendor:x"],
    });
    expect(page.messages).toEqual([]);
    expect(queries).toHaveLength(0);
  });

  it("another house's thread key is an empty page, never theirs", async () => {
    resolve = () => ({ data: [], error: null });
    const page = await service().getThread(HOUSE, "owner", { key: "t-other" });
    expect(page).toEqual({
      key: "t-other",
      subject: null,
      person: null,
      order: null,
      messages: [],
      before: null,
      waiting: false,
      attachmentsRead: true,
      heldMarksRead: true,
    });
  });
});

describe("getThread: one key, two vendors", () => {
  // One Gmail thread from the house mailbox to two vendors (a `gm:` key) is
  // two threads: (V1, gm:shared) and (V2, gm:shared). Which letters belong to
  // which is decided in SQL (mail_thread_letters, proven on Postgres in
  // supabase/tests/20270421143700_the_mail_list_is_read_by_person_test.sql);
  // here the service must pass the person through and never widen the read.
  const V1 = VENDOR;
  const V2 = "c0000000-0000-4000-8000-000000000002";
  const v2Letter = {
    ...letter(0),
    id: "d0000000-0000-4000-8000-000000000002",
    provider_id: V2,
    provider_name: "Vendor Two",
    message_text: "Subject: Prices\nfrom v2",
  };

  it("`with` names the vendor to the database and the page is that vendor's", async () => {
    resolve = threadResolver([v2Letter]);
    const page = await service().getThread(HOUSE, "owner", {
      key: "gm:shared",
      with: `vendor:${V2.toUpperCase()}`,
    });
    expect(
      queries.filter(
        (q) => !["conversation_attachments", "procurement_conversations"].includes(q.name),
      ),
    ).toHaveLength(1);
    expect(queries[0].payload).toMatchObject({
      p_thread_key: "gm:shared",
      p_provider_id: V2,
    });
    expect(page.person).toEqual({
      key: `vendor:${V2}`,
      kind: "vendor",
      providerId: V2,
      name: "Vendor Two",
    });
    expect(page.messages.map((m) => m.text)).toEqual(["from v2"]);
  });

  it("the key alone is still one read, and the page names the one vendor it holds", async () => {
    // QA round 18 (#895 T1.0): the default route merged both vendors' letters
    // under the first vendor's name. Now the database picks one vendor (the
    // thread's first letter's) and the service shows exactly that.
    resolve = threadResolver([
      {
        ...letter(0),
        provider_id: V1,
        provider_name: "Vendor One",
        message_text: "from v1",
      },
    ]);
    const page = await service().getThread(HOUSE, "owner", {
      key: "gm:shared",
    });
    expect(queries.map((q) => q.name)).toEqual([
      "mail_thread_letters",
      "conversation_attachments",
      "procurement_conversations",
    ]);
    expect(queries[0].payload).toMatchObject({ p_provider_id: null });
    expect(page.person?.providerId).toBe(V1);
    expect(page.messages.map((m) => m.text)).toEqual(["from v1"]);
  });

  it("a `with` that names no stored person is an empty page and reads nothing", async () => {
    resolve = threadResolver([v2Letter]);
    for (const bad of ["x", "vendor:not-a-uuid", "staff:" + V1]) {
      queries = [];
      const page = await service().getThread(HOUSE, "owner", {
        key: "gm:shared",
        with: bad,
      });
      expect(page.messages).toEqual([]);
      expect(page.person).toBeNull();
      expect(queries).toHaveLength(0);
    }
  });
});

const SUMMARY_ROW = {
  waiting_people: 3,
  oldest_wait_at: "2026-11-06 09:00:00+00",
  in_today: 5,
  out_today: 2,
  house_mailbox_last_at: null,
  whatsapp_last_at: "2026-11-07 08:00:00+00",
  mudavym_mail_last_at: "2026-11-07 09:00:00+00",
  in_30d: 17,
};

/** The house row the zone is read from; Istanbul unless a test says otherwise. */
let houseRow: Result = {
  data: { timezone: "Europe/Istanbul", country: "TR" },
  error: null,
};
beforeEach(() => {
  houseRow = { data: { timezone: "Europe/Istanbul", country: "TR" }, error: null };
});
const withHouse =
  (rest: (q: Query) => Result) =>
  (q: Query): Result =>
    q.kind === "from" && q.name === "restaurants" ? houseRow : rest(q);

describe("summary", () => {
  it("with no inbound domain, never reads the address table and says so", async () => {
    resolve = withHouse(() => ({ data: [SUMMARY_ROW], error: null }));
    const s = await service().summary(HOUSE, "staff");
    expect(queries.map((q) => q.name)).toEqual([
      "restaurants",
      "mail_inbox_summary",
    ]);
    expect(queries[1].payload).toEqual({
      p_restaurant_id: HOUSE,
      p_withhold_house_letters: true,
      p_zone: "Europe/Istanbul",
    });
    expect(s).toEqual({
      waitingPeople: 3,
      oldestWaitAt: "2026-11-06 09:00:00+00",
      inToday: 5,
      outToday: 2,
      zone: { zone: "Europe/Istanbul", source: "house" },
      inLast30: 17,
      heldAtDoor: null,
      doors: {
        houseMailbox: { lastStoredAt: null },
        whatsapp: { lastStoredAt: "2026-11-07 08:00:00+00" },
        mudavymMail: { lastStoredAt: "2026-11-07 09:00:00+00" },
      },
      address: { configured: false, address: null },
    });
  });

  it("reads the existing address with a plain select and never provisions one", async () => {
    inboundDomain = "in.example.test";
    resolve = withHouse((q) =>
      q.kind === "rpc"
        ? { data: [SUMMARY_ROW], error: null }
        : { data: [{ address: "house-1@in.example.test" }], error: null });
    const s = await service().summary(HOUSE, "owner");
    const read = queries.find(
      (q) => q.name === "restaurant_inbound_addresses",
    )!;
    expect(read.calls.map((c) => c.method)).toEqual([
      "select",
      "eq",
      "eq",
      "order",
      "limit",
    ]);
    for (const q of queries) {
      expect(
        q.calls.some((c) =>
          ["insert", "upsert", "update", "delete"].includes(c.method),
        ),
      ).toBe(false);
    }
    expect(s.address).toEqual({
      configured: true,
      address: "house-1@in.example.test",
    });
  });

  it("a house with no address yet is configured with no address, not a new one", async () => {
    inboundDomain = "in.example.test";
    resolve = withHouse((q) =>
      q.kind === "rpc"
        ? { data: [SUMMARY_ROW], error: null }
        : { data: [], error: null });
    const s = await service().summary(HOUSE, "owner");
    expect(s.address).toEqual({ configured: true, address: null });
  });
});

describe("summary: the house's day (D7)", () => {
  it("a house with no zone counts today in its country's only zone", async () => {
    houseRow = { data: { timezone: null, country: "TR" }, error: null };
    resolve = withHouse(() => ({ data: [SUMMARY_ROW], error: null }));
    const s = await service().summary(HOUSE, "owner");
    const rpc = queries.find((q) => q.name === "mail_inbox_summary")!;
    expect((rpc.payload as any).p_zone).toBe("Europe/Istanbul");
    expect(s.zone).toEqual({ zone: "Europe/Istanbul", source: "country" });
    expect(s.inToday).toBe(5);
  });

  it("a house with no zone and a country of several zones has no today, never UTC", async () => {
    houseRow = { data: { timezone: "", country: "US" }, error: null };
    resolve = withHouse(() => ({
      data: [{ ...SUMMARY_ROW, in_today: null, out_today: null }],
      error: null,
    }));
    const s = await service().summary(HOUSE, "owner");
    const rpc = queries.find((q) => q.name === "mail_inbox_summary")!;
    expect((rpc.payload as any).p_zone).toBeNull();
    expect(s.zone).toEqual({ zone: null, source: "none" });
    expect(s.inToday).toBeNull();
    expect(s.outToday).toBeNull();
    // The 30-day figures need no zone.
    expect(s.inLast30).toBe(17);
  });

  it("a zone name nobody can read is no zone", async () => {
    houseRow = { data: { timezone: "Mars/Olympus", country: null }, error: null };
    resolve = withHouse(() => ({ data: [SUMMARY_ROW], error: null }));
    const s = await service().summary(HOUSE, "owner");
    expect(s.zone.zone).toBeNull();
    expect(s.inToday).toBeNull();
  });

  it("a failed read of the house row is a 503, never 'no zone'", async () => {
    houseRow = { data: null, error: { message: "connection reset" } };
    resolve = withHouse(() => ({ data: [SUMMARY_ROW], error: null }));
    const err = await service()
      .summary(HOUSE, "owner")
      .catch((e) => e);
    expect(err).toBeInstanceOf(ServiceUnavailableException);
    expect(queries.some((q) => q.name === "mail_inbox_summary")).toBe(false);
  });
});

describe("a failed read says it failed", () => {
  const boom = { data: null, error: { message: "connection reset" } };

  it.each([
    ["people", () => service().listPeople(HOUSE, "owner", {})],
    [
      "threads",
      () => service().listThreads(HOUSE, "owner", { with: `vendor:${VENDOR}` }),
    ],
    ["thread", () => service().getThread(HOUSE, "owner", { key: "t-1" })],
    ["summary", () => service().summary(HOUSE, "owner")],
  ])(
    "%s: a database error is a 503 in words, never an empty answer",
    async (_label, run) => {
      resolve = () => boom;
      const err = await run().catch((e) => e);
      expect(err).toBeInstanceOf(ServiceUnavailableException);
      expect(err.getStatus()).toBe(503);
      expect(err.message).toMatch(/could not be read/);
    },
  );

  it("summary: no row back is a failure, not zeros", async () => {
    resolve = withHouse(() => ({ data: [], error: null }));
    await expect(service().summary(HOUSE, "owner")).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it("summary: a failed address read is a failure, not 'no address'", async () => {
    inboundDomain = "in.example.test";
    resolve = withHouse((q) =>
      q.kind === "rpc" ? { data: [SUMMARY_ROW], error: null } : boom);
    await expect(service().summary(HOUSE, "owner")).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});

describe("getThread: a letter a person filed from Who is writing (r37 w3 M-F2)", () => {
  const VOUCHER = "e0000000-0000-4000-8000-000000000001";
  const held = { ...letter(0), message_text: "Subject: Bank details changed\nNew IBAN" };
  const plain = { ...letter(2) };
  const mark = {
    prospect_id: "p-1",
    held_reason: "sender_unconfirmed",
    by_user_id: VOUCHER,
    at: "2026-11-13T15:00:00Z",
    words_cut: false,
  };
  const answer =
    (over: { headers?: Result; users?: Result } = {}) =>
    (q: Query): Result => {
      if (q.kind === "rpc") return { data: [held, plain], error: null };
      if (q.name === "conversation_attachments") return { data: [], error: null };
      if (q.name === "procurement_conversations")
        return (
          over.headers ?? {
            data: [
              { id: held.id, email_headers: { from: "x@y.example", filed_from_held: mark } },
              { id: plain.id, email_headers: { from: "x@y.example" } },
            ],
            error: null,
          }
        );
      if (q.name === "users")
        return over.users ?? { data: [{ user_id: VOUCHER, name: "Deniz Kaya" }], error: null };
      return { data: null, error: { message: `unexpected read ${q.name}` } };
    };

  it("says who filed it, when, and why it was held; a plain letter carries no mark", async () => {
    resolve = answer();
    const page = await service().getThread(HOUSE, "owner", { key: "t-1" });
    const byId = new Map(page.messages.map((m) => [m.id, m]));
    expect(byId.get(held.id)?.filedFromHeld).toEqual({
      heldReason: "sender_unconfirmed",
      byName: "Deniz Kaya",
      byRecorded: true,
      at: "2026-11-13T15:00:00Z",
    });
    expect(byId.get(plain.id)?.filedFromHeld).toBeNull();
    expect(page.heldMarksRead).toBe(true);
    const read = queries.find((q) => q.name === "procurement_conversations")!;
    // Only this house's rows, and only the received letters of the page.
    expect(read.calls).toEqual(
      expect.arrayContaining([
        { method: "eq", args: ["restaurant_id", HOUSE] },
        { method: "in", args: ["id", [held.id, plain.id]] },
      ]),
    );
  });

  it("a person with no name on record is said to be recorded, not named", async () => {
    resolve = answer({ users: { data: [], error: null } });
    const page = await service().getThread(HOUSE, "owner", { key: "t-1" });
    expect(page.messages.find((m) => m.id === held.id)?.filedFromHeld).toMatchObject({
      byName: null,
      byRecorded: true,
    });
  });

  it("a failed read says the marks could not be read, never that there are none", async () => {
    for (const over of [
      { headers: { data: null, error: { message: "boom" } } },
      { users: { data: null, error: { message: "boom" } } },
    ]) {
      resolve = answer(over);
      const page = await service().getThread(HOUSE, "owner", { key: "t-1" });
      expect(page.heldMarksRead).toBe(false);
      expect(page.messages.every((m) => m.filedFromHeld === null)).toBe(true);
      // The letters are still shown.
      expect(page.messages).toHaveLength(2);
    }
  });
});
