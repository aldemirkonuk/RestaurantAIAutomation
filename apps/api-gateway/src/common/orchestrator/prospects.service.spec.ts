/**
 * ProspectsService.promote — a vendor is created only on a check that was READ.
 *
 * supabase-js resolves { data, error } rather than throwing. Before this file,
 * promote bound only `data`, so a failed dedupe read looked exactly like "no
 * vendor with this email yet" and a second vendor was inserted; a failed
 * prospect read looked like "no such prospect"; and a failed status update
 * still answered { promoted: true }.
 *
 * The fake below scripts one result per (table, operation), in call order, and
 * records every chain so a test can say which writes did NOT happen.
 */
import { ServiceUnavailableException } from "@nestjs/common";
import { ProspectsService } from "./prospects.service";

const HOUSE = "11111111-1111-4111-8111-111111111111";
const PROSPECT = "33333333-3333-4333-8333-333333333333";

type Result = { data: unknown; error: unknown };
type Kind = "select" | "insert" | "update";

function fakeDb(script: Partial<Record<`${string}:${Kind}`, Result[]>>) {
  const calls: Array<{ table: string; ops: Array<[string, unknown[]]> }> = [];
  const next = (table: string, ops: Array<[string, unknown[]]>): Result => {
    const names = ops.map(([n]) => n);
    const kind: Kind = names.includes("insert")
      ? "insert"
      : names.includes("update")
        ? "update"
        : "select";
    const queue = script[`${table}:${kind}`];
    return queue && queue.length ? queue.shift()! : { data: null, error: null };
  };
  const supabase = {
    from(table: string) {
      const entry = { table, ops: [] as Array<[string, unknown[]]> };
      calls.push(entry);
      const b: Record<string, unknown> = {};
      for (const m of [
        "select",
        "insert",
        "update",
        "eq",
        "is",
        "ilike",
        "limit",
        "order",
        "in",
      ]) {
        b[m] = (...args: unknown[]) => {
          entry.ops.push([m, args]);
          return b;
        };
      }
      b.maybeSingle = async () => next(table, entry.ops);
      b.single = async () => next(table, entry.ops);
      b.then = (res: (v: Result) => unknown, rej: (e: unknown) => unknown) =>
        Promise.resolve(next(table, entry.ops)).then(res, rej);
      return b;
    },
  };
  const wrote = (table: string, kind: "insert" | "update") =>
    calls.some((c) => c.table === table && c.ops.some(([n]) => n === kind));
  return { db: { supabase }, calls, wrote };
}

const config = { get: () => undefined };

const PROSPECT_ROW = {
  id: PROSPECT,
  domain: "vendor.example",
  sender_email: "rep@vendor.example",
  sender_name: "Vendor Rep",
  status: "new",
};

function service(db: unknown) {
  return new ProspectsService(db as any, config as any);
}

describe("ProspectsService.promote", () => {
  it("creates the vendor inside the house and marks the prospect promoted", async () => {
    const f = fakeDb({
      "email_prospects:select": [{ data: PROSPECT_ROW, error: null }],
      "providers:select": [{ data: [], error: null }],
      "providers:insert": [{ data: { id: "p-new" }, error: null }],
      "email_prospects:update": [{ data: null, error: null }],
    });
    await expect(service(f.db).promote(HOUSE, PROSPECT)).resolves.toEqual({
      promoted: true,
      providerId: "p-new",
      reused: false,
    });
    const insert = f.calls.find(
      (c) => c.table === "providers" && c.ops.some(([n]) => n === "insert"),
    );
    expect(insert?.ops.find(([n]) => n === "insert")?.[1][0]).toMatchObject({
      restaurant_id: HOUSE,
      contact_email: "rep@vendor.example",
    });
  });

  it("reuses an existing vendor with the same email and inserts nothing", async () => {
    const f = fakeDb({
      "email_prospects:select": [{ data: PROSPECT_ROW, error: null }],
      "providers:select": [{ data: [{ id: "p-old" }], error: null }],
      "email_prospects:update": [{ data: null, error: null }],
    });
    await expect(service(f.db).promote(HOUSE, PROSPECT)).resolves.toEqual({
      promoted: true,
      providerId: "p-old",
      reused: true,
    });
    expect(f.wrote("providers", "insert")).toBe(false);
  });

  it("keeps a prospect that is not in this house answering { promoted: false }", async () => {
    const f = fakeDb({
      "email_prospects:select": [{ data: null, error: null }],
    });
    await expect(service(f.db).promote(HOUSE, PROSPECT)).resolves.toEqual({
      promoted: false,
    });
    expect(f.wrote("providers", "insert")).toBe(false);
  });

  it("refuses with 503 when the prospect read FAILS, instead of calling it not found", async () => {
    const f = fakeDb({
      "email_prospects:select": [{ data: null, error: { message: "boom" } }],
    });
    await expect(service(f.db).promote(HOUSE, PROSPECT)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(f.wrote("providers", "insert")).toBe(false);
  });

  it("refuses with 503 when the dedupe read FAILS, and inserts no second vendor", async () => {
    const f = fakeDb({
      "email_prospects:select": [{ data: PROSPECT_ROW, error: null }],
      "providers:select": [{ data: null, error: { message: "boom" } }],
      "providers:insert": [{ data: { id: "p-dup" }, error: null }],
    });
    await expect(service(f.db).promote(HOUSE, PROSPECT)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(f.wrote("providers", "insert")).toBe(false);
    expect(f.wrote("email_prospects", "update")).toBe(false);
  });

  it("refuses with 503 when the race re-read FAILS after a refused insert", async () => {
    const f = fakeDb({
      "email_prospects:select": [{ data: PROSPECT_ROW, error: null }],
      "providers:select": [
        { data: [], error: null },
        { data: null, error: { message: "boom" } },
      ],
      "providers:insert": [{ data: null, error: { message: "duplicate key" } }],
    });
    await expect(service(f.db).promote(HOUSE, PROSPECT)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(f.wrote("email_prospects", "update")).toBe(false);
  });

  it("does not answer promoted: true when marking the prospect promoted FAILS", async () => {
    const f = fakeDb({
      "email_prospects:select": [{ data: PROSPECT_ROW, error: null }],
      "providers:select": [{ data: [], error: null }],
      "providers:insert": [{ data: { id: "p-new" }, error: null }],
      "email_prospects:update": [{ data: null, error: { message: "boom" } }],
    });
    await expect(service(f.db).promote(HOUSE, PROSPECT)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});

/**
 * QA round 25, item 6: both provider lookups in `promote` (the dedupe read
 * and the re-read after a lost insert race) carried the round-24 escaping
 * with no test that fails without it. Here they run over a store that does
 * ILIKE as PostgREST does, so a raw `_____@bigdist.com` would link the
 * house's `sales@bigdist.com`.
 */
describe("ProspectsService.promote matches a vendor exactly (QA round 25)", () => {
  const VENDOR = {
    id: "prov-sales",
    restaurant_id: HOUSE,
    contact_email: "sales@bigdist.com",
    deleted_at: null,
  };
  const prospectFrom = (sender: string) => ({
    id: PROSPECT,
    restaurant_id: HOUSE,
    domain: "bigdist.com",
    sender_email: sender,
    sender_name: null,
    status: "new",
  });

  it("the dedupe read does not take a pattern-shaped sender for another vendor", async () => {
    const { memoryDb } =
      await import("../../communications/testing/mail-store");
    const db = memoryDb({
      email_prospects: [prospectFrom("_____@bigdist.com")],
      providers: [VENDOR],
    });
    const out = await service(db).promote(HOUSE, PROSPECT);
    expect(out).toMatchObject({ promoted: true, reused: false });
    expect(out.providerId).not.toBe("prov-sales");
    expect(db.inserts.map((i) => i.row.contact_email)).toEqual([
      "_____@bigdist.com",
    ]);
  });

  it("the dedupe read still reuses the same address in another case", async () => {
    const { memoryDb } =
      await import("../../communications/testing/mail-store");
    const db = memoryDb({
      email_prospects: [prospectFrom("Sales@BigDist.com")],
      providers: [VENDOR],
    });
    expect(await service(db).promote(HOUSE, PROSPECT)).toMatchObject({
      promoted: true,
      reused: true,
      providerId: "prov-sales",
    });
    expect(db.inserts).toEqual([]);
  });

  it("the re-read after a refused insert does not link a pattern-shaped sender to another vendor", async () => {
    const { memoryDb } =
      await import("../../communications/testing/mail-store");
    // The dedupe read misses (the vendor is not there yet), the insert is
    // refused, and the vendor is there by the re-read: the race the re-read
    // exists for, with the house's real vendor as the row a pattern catches.
    const tables: any = {
      email_prospects: [prospectFrom("%@bigdist.com")],
      providers: [],
    };
    const db = memoryDb(tables, [], ["providers"]);
    const from = db.supabase.from;
    db.supabase.from = (t: string) => {
      const q = from(t);
      const insert = q.insert;
      q.insert = (p: any) => (tables.providers.push(VENDOR), insert(p));
      return q;
    };
    expect(await service(db).promote(HOUSE, PROSPECT)).toEqual({
      promoted: false,
    });
  });
});

describe("ProspectsService.holdUnattributed (QA round 25)", () => {
  it("holds a letter with no house, whatever DEFAULT_RESTAURANT_ID or the house count says", async () => {
    const { memoryDb } =
      await import("../../communications/testing/mail-store");
    const db = memoryDb({ restaurants: [{ id: HOUSE }], email_prospects: [] });
    const svc = new ProspectsService(
      db as any,
      {
        get: (k: string) => (k === "DEFAULT_RESTAURANT_ID" ? HOUSE : undefined),
      } as any,
    );
    const out = await svc.holdUnattributed({
      senderEmail: "sales@bigdist.com",
      subject: "Re: order",
      body: "Plain text, no attachment, not an offer.",
      gmailMessageId: "m-1",
      gmailThreadId: "gt-1",
      why: "vendor_in_many_houses",
    });
    expect(out).toMatchObject({
      captured: true,
      isTriage: true,
      restaurantId: null,
    });
    expect(db.inserts).toHaveLength(1);
    expect(db.inserts[0].row).toMatchObject({
      restaurant_id: null,
      sender_email: "sales@bigdist.com",
      subject: "Re: order",
      capture_reason: "no_house:vendor_in_many_houses",
      gmail_message_id: "m-1",
      gmail_thread_id: "gt-1",
    });
  });
});
