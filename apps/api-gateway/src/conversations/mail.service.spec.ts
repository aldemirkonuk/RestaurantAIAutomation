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
    "or",
    "not",
    "order",
    "limit",
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
  };
}

describe("listPeople", () => {
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
  // Newest first, as the page query orders them.
  return {
    id: `d0000000-0000-4000-8000-${String(1000 - i).padStart(12, "0")}`,
    direction: i % 2 ? "outbound" : "INBOUND",
    channel: "email",
    message_text: `Subject: Order 12\nLetter ${i}`,
    ai_generated: false,
    status: "SENT",
    sent_at: null,
    received_at: null,
    created_at: `2026-11-07 10:${String(59 - (i % 60)).padStart(2, "0")}:00.000001+00`,
    raw_deleted_at: null,
    mirrored_by_grant_id: null,
    // A store that grew these columns must still not leak them.
    email_headers: { "message-id": "<x@y>" },
    gmail_message_id: "g-1",
    message_id: "<x@y>",
  };
}

function threadResolver(pageRows: unknown[]): (q: Query) => Result {
  return (q) => {
    const select = String(
      q.calls.find((c) => c.method === "select")?.args[0] ?? "",
    );
    if (select.includes("providers (")) {
      return {
        data: [
          {
            provider_id: VENDOR,
            message_text: "Subject: Order 12\nHello",
            subject: null,
            subject_cap: null,
            providers: { id: VENDOR, name: "Ali" },
          },
        ],
        error: null,
      };
    }
    if (select.includes("procurement_orders")) return { data: [], error: null };
    return { data: pageRows, error: null };
  };
}

describe("getThread", () => {
  it("holds at most 50 letters, oldest to newest, with a `before` cursor", async () => {
    const rows = Array.from({ length: MAIL_THREAD_PAGE + 1 }, (_, i) =>
      letter(i),
    );
    resolve = threadResolver(rows);
    const page = await service().getThread(HOUSE, "owner", { key: "t-1" });

    expect(page.messages).toHaveLength(50);
    expect(page.messages[0].id).toBe(rows[49].id);
    expect(page.messages[49].id).toBe(rows[0].id);
    expect(page.before).not.toBeNull();
    expect(decodeMailCursor(page.before!)).toEqual({
      at: rows[49].created_at,
      key: rows[49].id,
    });
    expect(page.subject).toBe("Order 12");
    expect(page.person?.name).toBe("Ali");

    const pageQuery = queries.find((q) =>
      String(q.calls.find((c) => c.method === "select")?.args[0]).startsWith(
        "id,",
      ),
    )!;
    expect(pageQuery.calls).toContainEqual({ method: "limit", args: [51] });
    expect(pageQuery.calls).toContainEqual({
      method: "eq",
      args: ["restaurant_id", HOUSE],
    });
    const columns = String(
      pageQuery.calls.find((c) => c.method === "select")!.args[0],
    );
    expect(columns).not.toMatch(/email_headers|gmail|message_id/);
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

  it("reads the older page from the cursor, keyed on time then id", async () => {
    const before = encodeMailCursor(
      "2026-11-07 10:00:00.000001+00",
      letter(3).id,
    );
    resolve = threadResolver([]);
    await service().getThread(HOUSE, "staff", { key: "t-1", before });
    const pageQuery = queries.find((q) =>
      String(q.calls.find((c) => c.method === "select")?.args[0]).startsWith(
        "id,",
      ),
    )!;
    const ors = pageQuery.calls
      .filter((c) => c.method === "or")
      .map((c) => String(c.args[0]));
    // Two withholding filters for staff, then the page boundary.
    expect(ors).toHaveLength(3);
    expect(ors[2]).toBe(
      `created_at.lt."2026-11-07 10:00:00.000001+00",and(created_at.eq."2026-11-07 10:00:00.000001+00",id.lt.${letter(3).id})`,
    );
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
    });
  });
});

describe("getThread: one key, two vendors", () => {
  // One Gmail thread from the house mailbox to two vendors (a `gm:` key): the
  // migration groups by (provider_id, thread_key), so the list shows two
  // thread rows. The resolver answers like PostgREST — every `eq` filters.
  const V1 = VENDOR;
  const V2 = "c0000000-0000-4000-8000-000000000002";
  const stored = [
    {
      id: "d0000000-0000-4000-8000-000000000001",
      restaurant_id: HOUSE,
      thread_key: "gm:shared",
      provider_id: V1,
      direction: "INBOUND",
      channel: "email",
      message_text: "Subject: Prices\nfrom v1",
      ai_generated: false,
      status: "RECEIVED",
      sent_at: null,
      received_at: null,
      created_at: "2026-11-07 09:00:00.000001+00",
      raw_deleted_at: null,
      mirrored_by_grant_id: null,
      subject: null,
      subject_cap: null,
      providers: { id: V1, name: "Vendor One" },
    },
    {
      id: "d0000000-0000-4000-8000-000000000002",
      restaurant_id: HOUSE,
      thread_key: "gm:shared",
      provider_id: V2,
      direction: "INBOUND",
      channel: "email",
      message_text: "Subject: Prices\nfrom v2",
      ai_generated: false,
      status: "RECEIVED",
      sent_at: null,
      received_at: null,
      created_at: "2026-11-07 10:00:00.000001+00",
      raw_deleted_at: null,
      mirrored_by_grant_id: null,
      subject: null,
      subject_cap: null,
      providers: { id: V2, name: "Vendor Two" },
    },
  ];
  const filtering = (q: Query): Result => {
    const select = String(
      q.calls.find((c) => c.method === "select")?.args[0] ?? "",
    );
    if (select.includes("procurement_orders")) return { data: [], error: null };
    let rows = stored.filter((r) =>
      q.calls
        .filter((c) => c.method === "eq")
        .every((c) => (r as any)[c.args[0] as string] === c.args[1]),
    );
    const asc = q.calls.find((c) => c.method === "order")?.args[1] as any;
    rows = rows
      .slice()
      .sort((a, b) =>
        asc?.ascending
          ? a.created_at.localeCompare(b.created_at)
          : b.created_at.localeCompare(a.created_at),
      );
    return { data: rows, error: null };
  };

  it("`with` holds only that vendor's letters and names that vendor", async () => {
    resolve = filtering;
    const page = await service().getThread(HOUSE, "owner", {
      key: "gm:shared",
      with: `vendor:${V2.toUpperCase()}`,
    });
    expect(page.person).toEqual({
      key: `vendor:${V2}`,
      kind: "vendor",
      providerId: V2,
      name: "Vendor Two",
    });
    expect(page.messages.map((m) => m.text)).toEqual(["from v2"]);
    // Every read (head, order, page) is scoped to the person.
    expect(queries).toHaveLength(3);
    for (const q of queries) {
      expect(q.calls).toContainEqual({
        method: "eq",
        args: ["provider_id", V2],
      });
    }
  });

  it("the other vendor's row reads the other vendor's letter", async () => {
    resolve = filtering;
    const page = await service().getThread(HOUSE, "owner", {
      key: "gm:shared",
      with: `vendor:${V1}`,
    });
    expect(page.person?.name).toBe("Vendor One");
    expect(page.messages.map((m) => m.text)).toEqual(["from v1"]);
  });

  it("a `with` that names no stored person is an empty page and reads nothing", async () => {
    resolve = filtering;
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

  it("without `with`, the key alone is read as before (no person filter)", async () => {
    resolve = filtering;
    await service().getThread(HOUSE, "owner", { key: "gm:shared" });
    for (const q of queries) {
      expect(q.calls.some((c) => c.args[0] === "provider_id")).toBe(false);
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
};

describe("summary", () => {
  it("with no inbound domain, never reads the address table and says so", async () => {
    resolve = () => ({ data: [SUMMARY_ROW], error: null });
    const s = await service().summary(HOUSE, "staff");
    expect(queries.map((q) => q.name)).toEqual(["mail_inbox_summary"]);
    expect(queries[0].payload).toEqual({
      p_restaurant_id: HOUSE,
      p_withhold_house_letters: true,
    });
    expect(s).toEqual({
      waitingPeople: 3,
      oldestWaitAt: "2026-11-06 09:00:00+00",
      inToday: 5,
      outToday: 2,
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
    resolve = (q) =>
      q.kind === "rpc"
        ? { data: [SUMMARY_ROW], error: null }
        : { data: [{ address: "house-1@in.example.test" }], error: null };
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
    resolve = (q) =>
      q.kind === "rpc"
        ? { data: [SUMMARY_ROW], error: null }
        : { data: [], error: null };
    const s = await service().summary(HOUSE, "owner");
    expect(s.address).toEqual({ configured: true, address: null });
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
    resolve = () => ({ data: [], error: null });
    await expect(service().summary(HOUSE, "owner")).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it("summary: a failed address read is a failure, not 'no address'", async () => {
    inboundDomain = "in.example.test";
    resolve = (q) =>
      q.kind === "rpc" ? { data: [SUMMARY_ROW], error: null } : boom;
    await expect(service().summary(HOUSE, "owner")).rejects.toThrow(
      ServiceUnavailableException,
    );
  });
});
