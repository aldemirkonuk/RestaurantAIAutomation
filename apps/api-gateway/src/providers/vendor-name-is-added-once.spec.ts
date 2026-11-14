import "reflect-metadata";
import {
  ConflictException,
  HttpException,
  ServiceUnavailableException,
} from "@nestjs/common";
import { ProvidersController } from "./providers.controller";
import { ProvidersService } from "./providers.service";
import { foldVendorName } from "./vendor-name";

/**
 * A vendor's name is added once per house (r34 walk w1 F1, 2026-11-13).
 *
 * The walker added a custom vendor whose name was already on the house's
 * vendors: `POST /providers` answered 201 and wrote a second row, so the
 * onboarding sheet's "already on your vendors" sentence (#1469) could never
 * be reached. `createProvider` now reads the house's live vendors, folds each
 * name (`foldVendorName`) and refuses a match with 409 naming the row it
 * already is.
 *
 * The stub below honours the filters the service sends (house, deleted_at,
 * order, range), so "another house's vendor does not count" and "a removed
 * vendor does not count" are answered by the query, not by the stub's
 * choice of rows.
 */

const HOUSE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const HOUSE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

type Row = {
  id: string;
  name: string | null;
  restaurant_id: string;
  deleted_at: string | null;
};

function world(rows: Row[], opts: { readFails?: boolean } = {}) {
  const inserted: Record<string, unknown>[] = [];
  const ranges: Array<[number, number]> = [];
  const from = (table: string) => {
    if (table === "user_onboarding_progress") {
      return { update: () => ({ eq: () => Promise.resolve({ error: null }) }) };
    }
    if (table !== "providers") throw new Error(`unexpected table ${table}`);
    const filters: Array<(r: Row) => boolean> = [];
    let ordered = false;
    let payload: Record<string, unknown> | null = null;
    const q: Record<string, any> = {};
    q.select = () => q;
    q.eq = (col: keyof Row, v: unknown) => {
      filters.push((r) => r[col] === v);
      return q;
    };
    q.is = (col: keyof Row, v: unknown) => {
      filters.push((r) => r[col] === v);
      return q;
    };
    q.order = (col: string) => {
      ordered = col === "id";
      return q;
    };
    q.range = async (lo: number, hi: number) => {
      ranges.push([lo, hi]);
      if (opts.readFails) {
        return { data: null, error: { message: "statement timeout" } };
      }
      if (!ordered) throw new Error("a paged read must be ordered");
      const all = rows
        .filter((r) => filters.every((f) => f(r)))
        .sort((a, b) => a.id.localeCompare(b.id));
      // PostgREST's cap: never more than 1000 rows per answer.
      return { data: all.slice(lo, Math.min(hi + 1, lo + 1000)), error: null };
    };
    q.insert = (p: Record<string, unknown>) => {
      payload = p;
      inserted.push(p);
      return q;
    };
    q.single = async () => ({
      data: { id: "new-row", ...(payload ?? {}) },
      error: null,
    });
    return q;
  };
  const service = new ProvidersService(
    { supabase: { from } } as never,
    { createEvent: async () => undefined } as never,
    {} as never,
  );
  return { service, inserted, ranges };
}

const row = (id: string, name: string | null, over: Partial<Row> = {}): Row => ({
  id,
  name,
  restaurant_id: HOUSE_A,
  deleted_at: null,
  ...over,
});

const refusal = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e;
  }
  throw new Error("the add was not refused");
};

describe("foldVendorName: what counts as the same name", () => {
  it.each([
    ["Ege Supply", "ege supply"],
    ["EGE SUPPLY", "Ege Supply"],
    ["  Ege   Supply ", "Ege Supply"],
    ["Ege Supply.", "Ege Supply"],
    ["Ege-Supply", "Ege Supply"],
    ["KAVAKLIDERE", "Kavaklıdere"],
    ["kavaklidere", "Kavaklıdere"],
    ["İZMİR ŞARAP", "izmir sarap"],
    ["Süt Evi", "Sut Evi"],
    ["Çiftlik Gıda", "ciftlik gida"],
  ])("%j and %j are one name", (a, b) => {
    expect(foldVendorName(a)).toBe(foldVendorName(b));
    expect(foldVendorName(a)).not.toBe("");
  });

  it.each([
    ["Ege Supply", "Ege Supplies"],
    ["Ege Supply", "Ege Supply 2"],
    ["Москва Вина", "Москва Пиво"],
  ])("%j and %j are two names", (a, b) => {
    expect(foldVendorName(a)).not.toBe(foldVendorName(b));
  });

  it("keeps the letters of every script, never folding them to nothing", () => {
    expect(foldVendorName("Москва Вина")).toBe("москва вина");
    expect(foldVendorName("Москва  Вина!")).toBe(foldVendorName("москва вина"));
  });

  it("a name with no letter or digit folds to nothing", () => {
    expect(foldVendorName(" - . ")).toBe("");
    expect(foldVendorName(null)).toBe("");
  });
});

describe("createProvider: a custom vendor already on the house's vendors", () => {
  it("[REVERT-FAILS] refuses the same name in another case with 409 naming the row it already is", async () => {
    const w = world([row("p-1", "Ege Supply")]);
    const e = await refusal(
      w.service.createProvider({ name: "ege  SUPPLY" } as never, HOUSE_A),
    );
    expect(e).toBeInstanceOf(ConflictException);
    expect((e as HttpException).getStatus()).toBe(409);
    expect((e as HttpException).getResponse()).toEqual({
      statusCode: 409,
      message: "Ege Supply is already on your vendors.",
      existingId: "p-1",
      existingName: "Ege Supply",
    });
    expect(w.inserted).toEqual([]);
  });

  it("[REVERT-FAILS] folds Turkish i's and marks: KAVAKLIDERE is Kavaklıdere", async () => {
    const w = world([row("p-1", "Kavaklıdere")]);
    const e = await refusal(
      w.service.createProvider({ name: "KAVAKLIDERE" } as never, HOUSE_A),
    );
    expect((e as HttpException).getStatus()).toBe(409);
    expect(w.inserted).toEqual([]);
  });

  it("another house's vendor of that name does not count: 201", async () => {
    const w = world([row("p-b", "Ege Supply", { restaurant_id: HOUSE_B })]);
    const out = await w.service.createProvider(
      { name: "Ege Supply" } as never,
      HOUSE_A,
    );
    expect(out.id).toBe("new-row");
    expect(w.inserted).toHaveLength(1);
    expect(w.inserted[0]).toMatchObject({
      name: "Ege Supply",
      restaurant_id: HOUSE_A,
    });
  });

  it("a removed vendor of that name does not count: 201", async () => {
    const w = world([
      row("p-1", "Ege Supply", { deleted_at: "2026-11-01T00:00:00Z" }),
    ]);
    await w.service.createProvider({ name: "Ege Supply" } as never, HOUSE_A);
    expect(w.inserted).toHaveLength(1);
  });

  it("a different name is added", async () => {
    const w = world([row("p-1", "Ege Supply")]);
    await w.service.createProvider({ name: "Ege Supplies" } as never, HOUSE_A);
    expect(w.inserted).toHaveLength(1);
  });

  it("[REVERT-FAILS] reads past the first 1000 vendors: a match on the second page is still refused", async () => {
    const rows: Row[] = [];
    for (let i = 0; i < 1500; i++) {
      rows.push(row(`p-${String(i).padStart(5, "0")}`, `Vendor ${i}`));
    }
    rows.push(row("p-zzzzz", "Ege Supply"));
    const w = world(rows);
    const e = await refusal(
      w.service.createProvider({ name: "Ege Supply" } as never, HOUSE_A),
    );
    expect((e as HttpException).getStatus()).toBe(409);
    expect((e as HttpException).getResponse()).toMatchObject({
      existingId: "p-zzzzz",
    });
    expect(w.ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(w.inserted).toEqual([]);
  });

  it("stops reading at a short page, and adds when no page matched", async () => {
    const rows: Row[] = [];
    for (let i = 0; i < 1000; i++) {
      rows.push(row(`p-${String(i).padStart(5, "0")}`, `Vendor ${i}`));
    }
    const w = world(rows);
    await w.service.createProvider({ name: "Ege Supply" } as never, HOUSE_A);
    expect(w.ranges).toEqual([
      [0, 999],
      [1000, 1999],
    ]);
    expect(w.inserted).toHaveLength(1);
  });

  it("[REVERT-FAILS] a lookup that cannot run refuses the add with 503 and writes nothing", async () => {
    const w = world([], { readFails: true });
    const e = await refusal(
      w.service.createProvider({ name: "Ege Supply" } as never, HOUSE_A),
    );
    expect(e).toBeInstanceOf(ServiceUnavailableException);
    expect((e as HttpException).message).toMatch(/Nothing was added/);
    expect(w.inserted).toEqual([]);
  });

  it("a name of only punctuation is not compared, and is added as typed", async () => {
    const w = world([row("p-1", "--")]);
    await w.service.createProvider({ name: "-" } as never, HOUSE_A);
    expect(w.inserted).toHaveLength(1);
  });

  it("a bulk import adds the first of two same-named rows and reports the second", async () => {
    const w = world([]);
    // The stub does not see its own inserts, so seed what the first insert
    // would have made visible to the second lookup.
    const out = await w.service.bulkImportProviders(
      { providers: [{ name: "Ege Supply" }] } as never,
      HOUSE_A,
    );
    expect(out).toEqual({ imported: 1, failed: 0, errors: [] });
    const w2 = world([row("p-1", "Ege Supply")]);
    const again = await w2.service.bulkImportProviders(
      { providers: [{ name: "EGE SUPPLY" }, { name: "Fish Co" }] } as never,
      HOUSE_A,
    );
    expect(again).toEqual({
      imported: 1,
      failed: 1,
      errors: ["EGE SUPPLY: Ege Supply is already on your vendors."],
    });
  });
});

describe("POST /providers keeps the 409 the service gives", () => {
  it("passes the ConflictException through, body and all", async () => {
    const conflict = new ConflictException({
      statusCode: 409,
      message: "Ege Supply is already on your vendors.",
      existingId: "p-1",
      existingName: "Ege Supply",
    });
    const controller = new ProvidersController(
      {
        createProvider: async () => {
          throw conflict;
        },
      } as never,
      {} as never,
    );
    const e = await refusal(
      controller.createProvider(
        { name: "ege supply" } as never,
        { userId: "u", restaurantId: HOUSE_A } as never,
      ),
    );
    expect(e).toBe(conflict);
  });
});
