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
