import { HttpException, HttpStatus } from "@nestjs/common";
import {
  CountSessionsService,
  leafShelvesInScope,
  type HouseLocation,
} from "./count-sessions.service";
import { InventoryService } from "./inventory.service";
import {
  COUNT_PERIOD_GRACE_MS,
  CountPeriodRefused,
  filedMonth,
  periodChoiceAt,
  previousMonth,
  sessionPeriodFor,
} from "./count-period";

/**
 * F-1544, lane 1: the count session envelope. A session groups a walk of
 * leaf shelves; every count it causes goes through the existing per-item
 * count path as the person who counted (founder 2026-10-12, F2 a), and a
 * spot count with no session is exactly what it was.
 *
 * The database is an in-memory fake that applies the filters each statement
 * names, so a statement that forgets its house filter reads the other
 * house's rows here as it would in production. The SQL shape itself (same
 * house by construction, ended stays ended, RLS) is proven in PGlite:
 * supabase/tests/20270113000000_a_count_session_groups_a_walk_of_shelves_test.sql
 */

type Row = Record<string, any>;
const HOUSE = "house-a";
const OTHER = "house-b";
const ME = "user-bartender";
const AYSE = "user-ayse";
const BOSS = "user-manager";

function fakeDb(tables: Record<string, Row[]>) {
  let n = 0;
  const statements: Array<{ table: string; op: string; filters: string[] }> =
    [];
  const from = (table: string) => {
    const rows = (tables[table] ??= []);
    const filters: Array<{ text: string; ok: (r: Row) => boolean }> = [];
    let op: "select" | "insert" | "update" | "upsert" | "delete" = "select";
    let payload: any = null;
    let opts: any = {};
    let returning = false;
    let single: "one" | "maybe" | null = null;
    const q: any = {
      select: () => {
        if (op !== "select") returning = true;
        return q;
      },
      eq: (c: string, v: any) => (
        filters.push({ text: `eq ${c}`, ok: (r) => r[c] === v }),
        q
      ),
      is: (c: string, v: any) => (
        filters.push({ text: `is ${c}`, ok: (r) => (r[c] ?? null) === v }),
        q
      ),
      in: (c: string, vs: any[]) => (
        filters.push({ text: `in ${c}`, ok: (r) => vs.includes(r[c]) }),
        q
      ),
      or: (expr: string) => {
        // Only the shape the service uses: "<c>.is.null,<c>.lt.\"<iso>\"".
        const m = /^(\w+)\.is\.null,\1\.lt\."(.+)"$/.exec(expr);
        if (!m) throw new Error(`fake db: unsupported or(${expr})`);
        filters.push({
          text: `or ${m[1]}`,
          ok: (r) => r[m[1]] == null || r[m[1]] < m[2],
        });
        return q;
      },
      order: () => q,
      limit: () => q,
      insert: (p: any) => ((op = "insert"), (payload = p), q),
      update: (p: any) => ((op = "update"), (payload = p), q),
      upsert: (p: any, o: any) => (
        (op = "upsert"),
        (payload = p),
        (opts = o ?? {}),
        q
      ),
      delete: () => ((op = "delete"), q),
      maybeSingle: () => ((single = "maybe"), q),
      single: () => ((single = "one"), q),
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    const match = (r: Row) => filters.every((f) => f.ok(r));
    const run = () => {
      statements.push({ table, op, filters: filters.map((f) => f.text) });
      let out: Row[] = [];
      if (op === "select") out = rows.filter(match);
      if (op === "insert" || op === "upsert") {
        for (const p of Array.isArray(payload) ? payload : [payload]) {
          const keys: string[] =
            op === "upsert"
              ? String(opts.onConflict).split(",")
              : table === "stock_count_sessions"
                ? ["restaurant_id", "open_key"]
                : [];
          const clash =
            keys.length && p[keys[keys.length - 1]] != null
              ? rows.find((r) => keys.every((k) => r[k] === p[k]))
              : undefined;
          if (clash) {
            if (op === "upsert" && opts.ignoreDuplicates) continue;
            return {
              data: null,
              error: { code: "23505", message: "duplicate key" },
            };
          }
          // The defaults the migration gives a new row.
          const defaults: Row =
            table === "stock_count_sessions"
              ? { status: "open", opened_at: new Date().toISOString() }
              : table === "stock_count_parked_lines"
                ? { state: "parked" }
                : {};
          const row = { id: p.id ?? `id-${++n}`, ...defaults, ...p };
          rows.push(row);
          out.push(row);
        }
      }
      if (op === "update") {
        out = rows.filter(match);
        out.forEach((r) => Object.assign(r, payload));
      }
      if (op === "delete") {
        const keep = rows.filter((r) => !match(r));
        rows.splice(0, rows.length, ...keep);
      }
      const data = op === "select" || returning ? out : null;
      if (single) {
        if (single === "one" && (data ?? []).length !== 1) {
          return { data: null, error: { message: "not one row" } };
        }
        return { data: (data ?? [])[0] ?? null, error: null };
      }
      return { data, error: null };
    };
    return q;
  };
  return { client: { from }, statements, tables };
}

const loc = (id: string, over: Partial<HouseLocation> & Row = {}): Row => ({
  id,
  restaurant_id: HOUSE,
  parent_id: null,
  is_active: true,
  display_order: null,
  zone: id,
  section: null,
  name: id,
  deleted_at: null,
  ...over,
});

function setup(extra: Record<string, Row[]> = {}) {
  const db = fakeDb({
    storage_locations: [
      loc("Cellar", { display_order: 2 }),
      loc("Rack A", { parent_id: "Cellar", display_order: 1 }),
      loc("Shelf 2", { parent_id: "Rack A", display_order: 2 }),
      loc("Shelf 1", { parent_id: "Rack A", display_order: 1 }),
      loc("Bar", { display_order: 1 }),
      loc("Old fridge", { is_active: false }),
      loc("Their bar", { restaurant_id: OTHER }),
    ],
    users: [
      { user_id: ME, name: "Deniz" },
      { user_id: AYSE, name: "Ayşe" },
      { user_id: BOSS, name: "Selin" },
    ],
    restaurant_inventory: [
      {
        id: "item-yakut",
        restaurant_id: HOUSE,
        display_name: "Yakut 2020",
        wine_name: null,
        master_wine_id: null,
      },
      {
        id: "item-raki",
        restaurant_id: HOUSE,
        display_name: "Yeni Rakı",
        wine_name: null,
        master_wine_id: null,
      },
    ],
    inventory_lots: [
      {
        restaurant_id: HOUSE,
        inventory_id: "item-yakut",
        location_id: "Shelf 1",
        stock_state: "live",
        qty: 6,
        open_bottle_ml: 0,
      },
      {
        restaurant_id: HOUSE,
        inventory_id: "item-raki",
        location_id: "Bar",
        stock_state: "live",
        qty: 3,
        open_bottle_ml: 350,
      },
      // Rakı also has bottles the door booked with no shelf (F-945).
      {
        restaurant_id: HOUSE,
        inventory_id: "item-raki",
        location_id: null,
        stock_state: "live",
        qty: 2,
        open_bottle_ml: 0,
      },
      {
        restaurant_id: OTHER,
        inventory_id: "their-item",
        location_id: "Their bar",
        stock_state: "live",
        qty: 9,
        open_bottle_ml: 0,
      },
    ],
    ...extra,
  });
  const inventory = {
    recordSpotCount: jest.fn().mockResolvedValue({ count: {} }),
  };
  const svc = new CountSessionsService(
    { getClient: () => db.client } as any,
    inventory as unknown as InventoryService,
  );
  return { db, svc, inventory };
}

const yes = async () => true;
const no = async () => false;

describe("leafShelvesInScope -- the walk is the house's leaf shelves, in its own order", () => {
  const house = setup().db.tables.storage_locations.filter(
    (l) => l.restaurant_id === HOUSE,
  ) as HouseLocation[];

  it("offers only leaves, never a zone that holds zones, in tree order", () => {
    expect(leafShelvesInScope(house).map((l) => l.id)).toEqual([
      "Bar",
      "Shelf 1",
      "Shelf 2",
    ]);
  });

  it("scopes to the leaves under the chosen zone", () => {
    expect(leafShelvesInScope(house, ["Rack A"]).map((l) => l.id)).toEqual([
      "Shelf 1",
      "Shelf 2",
    ]);
  });

  it("a switched-off place is neither a shelf nor a parent", () => {
    const withChild = [
      ...house,
      {
        ...loc("Under old fridge", { parent_id: "Old fridge" }),
      } as HouseLocation,
    ];
    expect(leafShelvesInScope(withChild).map((l) => l.id)).toContain(
      "Under old fridge",
    );
    expect(leafShelvesInScope(withChild).map((l) => l.id)).not.toContain(
      "Old fridge",
    );
  });
});

describe("open -- an owner or manager opens one count over the chosen shelves", () => {
  it("writes the leaf shelves in walk order, all of this house", async () => {
    const { svc, db } = setup();
    const out: any = await svc.open(HOUSE, BOSS, { kind: "closing" });
    expect(out.shelves.map((s: any) => s.locationId)).toEqual([
      "Bar",
      "Shelf 1",
      "Shelf 2",
    ]);
    expect(
      db.tables.stock_count_session_shelves.every(
        (s) => s.restaurant_id === HOUSE,
      ),
    ).toBe(true);
    expect(db.tables.stock_count_sessions[0]).toMatchObject({
      restaurant_id: HOUSE,
      kind: "closing",
      opened_by: BOSS,
    });
  });

  it("refuses a kind it does not know and a zone of another house, opening nothing", async () => {
    const { svc, db } = setup();
    await expect(
      svc.open(HOUSE, BOSS, { kind: "weekly" }),
    ).rejects.toMatchObject({
      status: HttpStatus.BAD_REQUEST,
    });
    await expect(
      svc.open(HOUSE, BOSS, { kind: "full", zoneIds: ["Their bar"] }),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    expect(db.tables.stock_count_sessions ?? []).toHaveLength(0);
  });

  it("a retried open with the same key is the same count", async () => {
    const { svc, db } = setup();
    const a: any = await svc.open(HOUSE, BOSS, {
      kind: "full",
      openKey: "tap-1",
    });
    const b: any = await svc.open(HOUSE, BOSS, {
      kind: "full",
      openKey: "tap-1",
    });
    expect(b.id).toBe(a.id);
    expect(db.tables.stock_count_sessions).toHaveLength(1);
    expect(db.tables.stock_count_session_shelves).toHaveLength(3);
  });
});

describe("open -- a count states the month it is filed in (F-1544 lane 5, F1 b)", () => {
  // 00:30 on 1 November in Istanbul (UTC+3).
  beforeEach(() => {
    jest.useFakeTimers({
      now: new Date("2026-10-31T21:30:00Z"),
      doNotFake: ["nextTick", "setImmediate"],
    });
  });
  afterEach(() => jest.useRealTimers());
  const zoned = () =>
    setup({
      restaurants: [
        { id: HOUSE, timezone: "Europe/Istanbul", country: "TR" },
        { id: OTHER, timezone: "America/New_York", country: "US" },
      ],
    });

  it("is for October when the manager says so in the 6 hours after October ends", async () => {
    const { svc, db } = zoned();
    const out: any = await svc.open(HOUSE, BOSS, {
      kind: "month_end",
      period: "2026-10",
    });
    expect(db.tables.stock_count_sessions[0].attributed_period).toBe("2026-10");
    expect(out.period).toBe("2026-10");
    const list: any = await svc.listOpen(HOUSE);
    expect(list.periods).toEqual({ current: "2026-11", ended: "2026-10" });
    expect(list.sessions[0].period).toBe("2026-10");
  });

  it("is this month when no month is named, and an opening count has none", async () => {
    const { svc, db } = zoned();
    await svc.open(HOUSE, BOSS, { kind: "closing" });
    await svc.open(HOUSE, BOSS, { kind: "opening", period: "2026-10" });
    expect(
      db.tables.stock_count_sessions.map((r) => r.attributed_period),
    ).toEqual(["2026-11", null]);
  });

  it("refuses any other month and opens nothing", async () => {
    const { svc, db } = zoned();
    await expect(
      svc.open(HOUSE, BOSS, { kind: "month_end", period: "2026-09" }),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    expect(db.tables.stock_count_sessions ?? []).toHaveLength(0);
  });

  it("past the 6 hours offers no other month", async () => {
    jest.setSystemTime(new Date("2026-11-01T03:00:00Z"));
    const { svc } = zoned();
    const list: any = await svc.listOpen(HOUSE);
    expect(list.periods).toEqual({ current: "2026-11", ended: null });
    await expect(
      svc.open(HOUSE, BOSS, { kind: "month_end", period: "2026-10" }),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
  });
});

describe("pull -- a blind walk: which items, never how many", () => {
  it("lists the items expected on each shelf and no quantity at all", async () => {
    const { svc } = setup();
    const opened: any = await svc.open(HOUSE, BOSS, { kind: "closing" });
    const out: any = await svc.pull(HOUSE, opened.id, ME);
    const bar = out.shelves.find((s: any) => s.locationId === "Bar");
    expect(bar.items).toEqual([
      {
        inventoryId: "item-raki",
        name: "Yeni Rakı",
        producer: "",
        vintage: null,
        countWhole: true,
      },
    ]);
    const shelf1 = out.shelves.find((s: any) => s.locationId === "Shelf 1");
    expect(shelf1.items.map((i: any) => [i.inventoryId, i.countWhole])).toEqual(
      [["item-yakut", false]],
    );
    const text = JSON.stringify(out);
    for (const word of [
      "qty",
      "expected",
      "variance",
      "cost",
      "price",
      "open_bottle",
      "openMl",
    ]) {
      expect(text).not.toMatch(new RegExp(word, "i"));
    }
  });

  it("another house's count is not found", async () => {
    const { svc } = setup();
    const opened: any = await svc.open(HOUSE, BOSS, { kind: "closing" });
    await expect(svc.pull(OTHER, opened.id, ME)).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
    });
  });
});

describe("claim -- one counter per shelf", () => {
  async function opened() {
    const t = setup();
    const s: any = await t.svc.open(HOUSE, BOSS, { kind: "closing" });
    return { ...t, id: s.id as string };
  }

  it("a shelf someone holds is refused with their name; claiming twice is a no-op", async () => {
    const { svc, id } = await opened();
    await svc.claim(HOUSE, id, "Bar", AYSE, { isManager: no });
    await expect(
      svc.claim(HOUSE, id, "Bar", AYSE, { isManager: no }),
    ).resolves.toMatchObject({
      claimedByMe: true,
    });
    const refused = svc.claim(HOUSE, id, "Bar", ME, { isManager: no });
    await expect(refused).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
    });
    await expect(
      svc.claim(HOUSE, id, "Bar", ME, { isManager: no }),
    ).rejects.toThrow("Ayşe is counting this shelf");
  });

  it("a manager may take over a shelf a dead phone holds; staff may not", async () => {
    const { svc, id, db } = await opened();
    await svc.claim(HOUSE, id, "Bar", AYSE, { isManager: no });
    await expect(
      svc.claim(HOUSE, id, "Bar", ME, { takeOver: true, isManager: no }),
    ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
    await svc.claim(HOUSE, id, "Bar", BOSS, { takeOver: true, isManager: yes });
    expect(
      db.tables.stock_count_session_shelves.find((s) => s.location_id === "Bar")
        ?.claimed_by,
    ).toBe(BOSS);
  });

  it("an ended count takes no claims", async () => {
    const { svc, id } = await opened();
    await svc.abandon(HOUSE, id, BOSS);
    await expect(
      svc.claim(HOUSE, id, "Bar", ME, { isManager: no }),
    ).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
    });
  });
});

describe("shelf done -- the not-found items post as counts of 0, through the one count path", () => {
  async function opened(kind = "closing") {
    const t = setup();
    const s: any = await t.svc.open(HOUSE, BOSS, { kind });
    return { ...t, id: s.id as string };
  }

  it("posts each zero as this person, on this shelf, keyed for replay, then marks the shelf done", async () => {
    const { svc, id, inventory, db } = await opened();
    await svc.claim(HOUSE, id, "Shelf 1", ME, { isManager: no });
    const out: any = await svc.shelfDone(
      HOUSE,
      id,
      "Shelf 1",
      ME,
      {
        clientDoneId: "done-7",
        zeroItemIds: ["item-yakut"],
        countedAgoMs: 600000,
      },
      no,
    );
    expect(out).toMatchObject({
      done: true,
      posted: ["item-yakut"],
      refused: [],
    });
    expect(inventory.recordSpotCount).toHaveBeenCalledWith(
      HOUSE,
      "item-yakut",
      {
        countedQty: 0,
        stockState: "live",
        clientCountId: "shelf-done:done-7",
        reason: "Shelf done: not on the shelf",
        performedBy: ME,
        locationId: "Shelf 1",
        opening: false,
        countedAgoMs: 600000,
        // Lane 2: a line of this walk, and nothing open on the shelf either.
        sessionId: id,
        openMl: 0,
        role: null,
      },
    );
    const row = db.tables.stock_count_session_shelves.find(
      (s) => s.location_id === "Shelf 1",
    );
    expect(row?.done_by).toBe(ME);
    expect(row?.done_at).toBeTruthy();
  });

  it("a retried 'done' sends the same keys, so nothing is counted twice", async () => {
    const { svc, id, inventory } = await opened();
    const body = { clientDoneId: "done-8", zeroItemIds: ["item-yakut"] };
    await svc.shelfDone(HOUSE, id, "Shelf 1", ME, body, no);
    await svc.shelfDone(HOUSE, id, "Shelf 1", ME, body, no);
    const keys = inventory.recordSpotCount.mock.calls.map(
      (c: any[]) => c[2].clientCountId,
    );
    expect(new Set(keys)).toEqual(new Set(["shelf-done:done-8"]));
  });

  it("a retried 'done' whose zero already emptied the shelf replays, it is not refused", async () => {
    const { svc, id, inventory, db } = await opened();
    // The first send landed (the shelf now reads 0) but its answer was lost.
    db.tables.inventory_lots.find((l) => l.inventory_id === "item-yakut")!.qty =
      0;
    (db.tables.stock_counts ??= []).push({
      restaurant_id: HOUSE,
      inventory_id: "item-yakut",
      idempotency_key: "count:item-yakut:shelf-done:done-10",
    });
    const out: any = await svc.shelfDone(
      HOUSE,
      id,
      "Shelf 1",
      ME,
      { clientDoneId: "done-10", zeroItemIds: ["item-yakut"] },
      no,
    );
    expect(out).toMatchObject({ done: true, posted: ["item-yakut"] });
    expect(inventory.recordSpotCount).toHaveBeenCalledWith(
      HOUSE,
      "item-yakut",
      expect.objectContaining({ clientCountId: "shelf-done:done-10" }),
    );
  });

  it("a zero the stock overtook comes back as 'count this shelf again', and the shelf stays not done", async () => {
    const { svc, id, inventory, db } = await opened();
    inventory.recordSpotCount.mockRejectedValueOnce(
      new HttpException(
        "Bottles on this shelf were sold after this count was taken.",
        HttpStatus.CONFLICT,
      ),
    );
    const out: any = await svc.shelfDone(
      HOUSE,
      id,
      "Shelf 1",
      ME,
      {
        clientDoneId: "done-9",
        zeroItemIds: ["item-yakut"],
        countedAgoMs: 3_600_000,
      },
      no,
    );
    expect(out.done).toBe(false);
    expect(out.refused).toEqual([
      {
        inventoryId: "item-yakut",
        reason: "Bottles on this shelf were sold after this count was taken.",
      },
    ]);
    expect(
      db.tables.stock_count_session_shelves.find(
        (s) => s.location_id === "Shelf 1",
      )?.done_at ?? null,
    ).toBeNull();
  });

  it("a database outage fails the whole act so the phone keeps it", async () => {
    const { svc, id, inventory } = await opened();
    inventory.recordSpotCount.mockRejectedValueOnce(
      new HttpException("away", HttpStatus.SERVICE_UNAVAILABLE),
    );
    await expect(
      svc.shelfDone(
        HOUSE,
        id,
        "Shelf 1",
        ME,
        { clientDoneId: "d", zeroItemIds: ["item-yakut"] },
        no,
      ),
    ).rejects.toMatchObject({ status: HttpStatus.SERVICE_UNAVAILABLE });
  });

  it("an item not on this shelf's books is not counted, named back, and the rest of the shelf closes (F-1616)", async () => {
    const { svc, id, inventory, db } = await opened();
    // The last Yakut on Shelf 1 sold after the phone pulled its list; Rakı
    // was never there; "their-item" is another house's.
    db.tables.inventory_lots.find((l) => l.inventory_id === "item-yakut")!.qty =
      0;
    const out: any = await svc.shelfDone(
      HOUSE,
      id,
      "Shelf 1",
      ME,
      { clientDoneId: "d", zeroItemIds: ["item-yakut", "their-item"] },
      no,
    );
    expect(out).toMatchObject({
      done: true,
      posted: [],
      skipped: [
        { inventoryId: "item-yakut", name: "Yakut 2020" },
        { inventoryId: "their-item", name: "An item not on this shelf" },
      ],
    });
    expect(out.message).toContain("Yakut 2020");
    expect(inventory.recordSpotCount).not.toHaveBeenCalled();
    expect(
      db.tables.stock_count_session_shelves.find(
        (s) => s.location_id === "Shelf 1",
      )?.done_at,
    ).toBeTruthy();
  });

  it("a shelf with one item gone from its books still zeroes the others (F-1616)", async () => {
    const { svc, id, inventory, db } = await opened();
    db.tables.inventory_lots.push({
      restaurant_id: HOUSE,
      inventory_id: "item-raki",
      location_id: "Shelf 1",
      stock_state: "live",
      qty: 0,
      open_bottle_ml: 0,
    });
    const out: any = await svc.shelfDone(
      HOUSE,
      id,
      "Shelf 1",
      ME,
      { clientDoneId: "d2", zeroItemIds: ["item-yakut", "item-raki"] },
      no,
    );
    expect(out).toMatchObject({
      done: true,
      posted: ["item-yakut"],
      skipped: [{ inventoryId: "item-raki", name: "Yeni Rakı" }],
    });
    expect(inventory.recordSpotCount).toHaveBeenCalledTimes(1);
    expect(inventory.recordSpotCount).toHaveBeenCalledWith(
      HOUSE,
      "item-yakut",
      expect.objectContaining({ countedQty: 0, locationId: "Shelf 1" }),
    );
  });

  it("someone else's shelf is not closed by staff; an opening count is a manager's", async () => {
    const t = await opened();
    await t.svc.claim(HOUSE, t.id, "Shelf 1", AYSE, { isManager: no });
    await expect(
      t.svc.shelfDone(
        HOUSE,
        t.id,
        "Shelf 1",
        ME,
        { clientDoneId: "d", zeroItemIds: [] },
        no,
      ),
    ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });

    const o = await opened("opening");
    await expect(
      o.svc.shelfDone(
        HOUSE,
        o.id,
        "Shelf 1",
        ME,
        { clientDoneId: "d", zeroItemIds: ["item-yakut"] },
        no,
      ),
    ).rejects.toMatchObject({ status: HttpStatus.FORBIDDEN });
    await o.svc.shelfDone(
      HOUSE,
      o.id,
      "Shelf 1",
      BOSS,
      { clientDoneId: "d", zeroItemIds: ["item-yakut"] },
      yes,
    );
    expect(o.inventory.recordSpotCount).toHaveBeenCalledWith(
      HOUSE,
      "item-yakut",
      expect.objectContaining({ opening: true, performedBy: BOSS }),
    );
  });

  it("a shelf with nothing missing is done with no count posted", async () => {
    const { svc, id, inventory } = await opened();
    const out: any = await svc.shelfDone(
      HOUSE,
      id,
      "Shelf 2",
      ME,
      { clientDoneId: "d" },
      no,
    );
    expect(out).toMatchObject({ done: true, posted: [] });
    expect(inventory.recordSpotCount).not.toHaveBeenCalled();
  });

  it("an offline 'done' that lands after the count ended still lands (ADR 0241)", async () => {
    const { svc, id } = await opened();
    await svc.abandon(HOUSE, id, BOSS);
    await expect(
      svc.shelfDone(HOUSE, id, "Shelf 2", ME, { clientDoneId: "late" }, no),
    ).resolves.toMatchObject({ done: true, sessionStatus: "abandoned" });
  });
});

describe("park -- an item the house does not carry is parked once, nothing created", () => {
  it("parks once per client line id and refuses a shelf outside the count", async () => {
    const { svc, db } = setup();
    const s: any = await svc.open(HOUSE, BOSS, {
      kind: "full",
      zoneIds: ["Rack A"],
    });
    const body = {
      clientLineId: "line-1",
      locationId: "Shelf 1",
      description: "Unlabelled red",
      countedQty: 2,
    };
    const a = await svc.park(HOUSE, s.id, ME, body);
    const b = await svc.park(HOUSE, s.id, ME, body);
    expect(b.id).toBe(a.id);
    expect(db.tables.stock_count_parked_lines).toHaveLength(1);
    expect(db.tables.stock_count_parked_lines[0]).toMatchObject({
      counted_by: ME,
      restaurant_id: HOUSE,
    });
    await expect(
      svc.park(HOUSE, s.id, ME, {
        ...body,
        clientLineId: "line-2",
        locationId: "Bar",
      }),
    ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
    expect(db.tables.restaurant_inventory).toHaveLength(2);
  });
});

describe("abandon -- stops the count, keeps the counts", () => {
  it("is idempotent, and a signed-off count cannot be stopped", async () => {
    const { svc, db } = setup();
    const s: any = await svc.open(HOUSE, BOSS, { kind: "full" });
    await svc.abandon(HOUSE, s.id, BOSS);
    await expect(svc.abandon(HOUSE, s.id, BOSS)).resolves.toMatchObject({
      status: "abandoned",
    });
    db.tables.stock_count_sessions[0].status = "signed_off";
    await expect(svc.abandon(HOUSE, s.id, BOSS)).rejects.toMatchObject({
      status: HttpStatus.CONFLICT,
    });
  });
});

describe("a spot count with no session is exactly what it was (strict no-op)", () => {
  // The argument object record_stock_count received at the base a4b08ff39 for
  // a queued shelf count. Lane 1 must not add, drop or change one key.
  it("sends record_stock_count the same arguments as before, and no session", async () => {
    const rpc = jest.fn().mockResolvedValue({
      data: {
        count_id: "c1",
        expected_qty: 6,
        counted_qty: 5,
        variance_qty: -1,
        transaction_id: "t1",
        counted_at: "x",
        location_id: "Shelf 1",
        replayed: false,
      },
      error: null,
    });
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      gt: () => chain,
      limit: () => chain,
      single: () => Promise.resolve({ data: null, error: null }),
      maybeSingle: () =>
        Promise.resolve({ data: { id: "item-yakut" }, error: null }),
      then: (res: any, rej: any) =>
        Promise.resolve({ data: [], error: null }).then(res, rej),
    };
    const svc = Object.create(InventoryService.prototype) as any;
    svc.dbService = { getClient: () => ({ rpc, from: () => chain }) };
    svc.logger = { error: () => {}, warn: () => {}, log: () => {} };
    svc.fetchLotRollup = jest.fn().mockResolvedValue(new Map());
    svc.fetchLocationBreakdown = jest.fn().mockResolvedValue(new Map());
    svc.gradePhotoCountSuggestion = jest.fn().mockResolvedValue(undefined);
    await svc.recordSpotCount(HOUSE, "item-yakut", {
      countedQty: 5,
      clientCountId: "spot-1",
      performedBy: ME,
      locationId: "Shelf 1",
      countedAgoMs: 10_000,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    const [fn, args] = rpc.mock.calls[0];
    expect(fn).toBe("record_stock_count");
    expect(Object.keys(args).sort()).toEqual([
      "p_counted_at",
      "p_counted_qty",
      "p_idempotency_key",
      "p_inventory_id",
      "p_location_id",
      "p_performed_by",
      "p_reason",
      "p_source",
      "p_stock_state",
      "p_transaction_type",
    ]);
    expect(args).toMatchObject({
      p_idempotency_key: "count:item-yakut:spot-1",
      p_source: "mobile_count",
      p_transaction_type: "reconciliation",
      p_reason: "Spot count",
      p_performed_by: ME,
    });
  });
});

describe("shelf done in lane 2 -- held zeros and old acts (F2 a, ADR 0286)", () => {
  async function opened() {
    const t = setup();
    const s: any = await t.svc.open(HOUSE, BOSS, { kind: "closing" });
    return { ...t, id: s.id as string };
  }

  it("a zero the walk already counted on this shelf comes back held, not posted, and the shelf is done", async () => {
    const { svc, id, inventory } = await opened();
    inventory.recordSpotCount.mockResolvedValueOnce({
      count: { held: true, heldLineId: "h1", countId: null },
    });
    const out: any = await svc.shelfDone(
      HOUSE,
      id,
      "Shelf 1",
      ME,
      { clientDoneId: "done-h", zeroItemIds: ["item-yakut"] },
      no,
    );
    expect(out).toMatchObject({ done: true, posted: [], held: ["item-yakut"] });
  });

  it("a done taken more than 72 h ago is sent with the manager's word only when the person is one", async () => {
    const staff = await opened();
    const isManager = jest.fn().mockResolvedValue(false);
    await staff.svc.shelfDone(
      HOUSE,
      staff.id,
      "Shelf 1",
      ME,
      {
        clientDoneId: "done-old",
        zeroItemIds: ["item-yakut"],
        countedAgoMs: 73 * 3_600_000,
      },
      isManager,
    );
    expect(isManager).toHaveBeenCalled();
    expect(staff.inventory.recordSpotCount.mock.calls[0][2]).toMatchObject({
      role: null,
      sessionId: staff.id,
    });

    const boss = await opened();
    await boss.svc.shelfDone(
      HOUSE,
      boss.id,
      "Shelf 1",
      BOSS,
      {
        clientDoneId: "done-old-2",
        zeroItemIds: ["item-yakut"],
        countedAgoMs: 73 * 3_600_000,
      },
      yes,
    );
    expect(boss.inventory.recordSpotCount.mock.calls[0][2]).toMatchObject({
      role: "manager",
    });
  });

  it("an ordinary done asks nobody's role", async () => {
    const { svc, id } = await opened();
    const isManager = jest.fn().mockResolvedValue(false);
    await svc.shelfDone(
      HOUSE,
      id,
      "Shelf 1",
      ME,
      { clientDoneId: "done-new", zeroItemIds: ["item-yakut"] },
      isManager,
    );
    expect(isManager).not.toHaveBeenCalled();
  });
});

// ---- count-period.ts, the pure rule the open and the month close share ----
/**
 * F-1544 lane 5, the founder's F1 (b), 2026-10-12 (sim-ledger S224): a count
 * session states its period; the month close files its counts by it, only
 * for counts made within 6 hours after the period ends; the counted moment
 * is never moved. Every case failed before lane 5 (no count-period.ts).
 */

const IST = "Europe/Istanbul"; // UTC+3 all year
const NYC = "America/New_York"; // clocks go back at 02:00 on 1 Nov 2026

describe("filedMonth -- which month a count is filed in", () => {
  it("files a count with no session month by its own moment, as before", () => {
    // 00:30 on 1 November in Istanbul.
    expect(filedMonth("2026-10-31T21:30:00Z", null, IST)).toBe("2026-11");
    expect(filedMonth("2026-10-31T20:59:00Z", null, IST)).toBe("2026-10");
    expect(filedMonth(null, "2026-10", IST)).toBeNull();
    expect(filedMonth("not a time", "2026-10", IST)).toBeNull();
  });

  it("files an October count made up to 6 hours after October ended in October", () => {
    expect(filedMonth("2026-10-31T21:30:00Z", "2026-10", IST)).toBe("2026-10");
    // 05:59 on 1 November, house time: still October's.
    expect(filedMonth("2026-11-01T02:59:59Z", "2026-10", IST)).toBe("2026-10");
    // 06:00: the new month's, as the house's day says.
    expect(filedMonth("2026-11-01T03:00:00Z", "2026-10", IST)).toBe("2026-11");
    // Inside the month: October either way.
    expect(filedMonth("2026-10-20T10:00:00Z", "2026-10", IST)).toBe("2026-10");
  });

  it("never pulls a count made before the period into it", () => {
    // 23:00 on 30 September, house time.
    expect(filedMonth("2026-09-30T20:00:00Z", "2026-10", IST)).toBe("2026-09");
  });

  it("counts the 6 hours in real time across a clock change (US house)", () => {
    // October ends at 04:00Z (midnight EDT); six real hours later is 10:00Z,
    // which the house's clock calls 05:00 EST.
    expect(filedMonth("2026-11-01T09:59:00Z", "2026-10", NYC)).toBe("2026-10");
    expect(filedMonth("2026-11-01T10:00:00Z", "2026-10", NYC)).toBe("2026-11");
    expect(COUNT_PERIOD_GRACE_MS).toBe(6 * 3_600_000);
  });
});

describe("periodChoiceAt -- what a count opened now may be for", () => {
  it("offers the month that just ended only within its 6 hours", () => {
    // 04:00 on 1 November, Istanbul.
    expect(periodChoiceAt(new Date("2026-11-01T01:00:00Z"), IST)).toEqual({
      current: "2026-11",
      ended: "2026-10",
    });
    // 06:00: too late for October.
    expect(periodChoiceAt(new Date("2026-11-01T03:00:00Z"), IST)).toEqual({
      current: "2026-11",
      ended: null,
    });
    // 1 January goes back a year.
    expect(periodChoiceAt(new Date("2026-12-31T22:00:00Z"), IST)).toEqual({
      current: "2027-01",
      ended: "2026-12",
    });
    expect(previousMonth("2027-01")).toBe("2026-12");
  });
});

describe("sessionPeriodFor -- the month a count being opened states", () => {
  const at0030 = new Date("2026-10-31T21:30:00Z"); // 00:30, 1 Nov, Istanbul
  const later = new Date("2026-11-02T09:00:00Z");

  it("is this month when none is named", () => {
    expect(sessionPeriodFor(undefined, "month_end", at0030, IST)).toBe(
      "2026-11",
    );
    expect(sessionPeriodFor(null, "closing", later, IST)).toBe("2026-11");
  });

  it("takes last month only in the 6 hours after it ended", () => {
    expect(sessionPeriodFor("2026-10", "month_end", at0030, IST)).toBe(
      "2026-10",
    );
    expect(() => sessionPeriodFor("2026-10", "month_end", later, IST)).toThrow(
      CountPeriodRefused,
    );
  });

  it("refuses any other month and anything that is not a month", () => {
    for (const bad of ["2026-12", "2026-09", "October", 202610, "2026-1"])
      expect(() => sessionPeriodFor(bad, "full", at0030, IST)).toThrow(
        CountPeriodRefused,
      );
  });

  it("gives an opening count no month, and a house with no zone none unless asked", () => {
    expect(sessionPeriodFor("2026-10", "opening", at0030, IST)).toBeNull();
    expect(sessionPeriodFor(undefined, "closing", at0030, null)).toBeNull();
    expect(() => sessionPeriodFor("2026-11", "closing", at0030, null)).toThrow(
      CountPeriodRefused,
    );
  });
});

describe("F-1638 -- the floor is told when a count opens or a shelf is sent back", () => {
  function told(extra: Record<string, Row[]> = {}) {
    const base = setup(extra);
    const notifications = {
      persistForRestaurant: jest
        .fn()
        .mockResolvedValue({ inserted: 1, ids: ["n-1"] }),
    };
    const inventory = {
      recordSpotCount: jest.fn().mockResolvedValue({ count: {} }),
      askShelfRecount: jest
        .fn()
        .mockResolvedValue({ round: 1, asked_at: "t", dropped_held: 0 }),
    };
    const svc = new CountSessionsService(
      {
        getClient: () => base.db.client,
        getRestaurantMemberIds: async () => [ME, AYSE, BOSS],
      } as any,
      inventory as unknown as InventoryService,
      notifications as any,
    );
    return { ...base, svc, inventory, notifications };
  }

  it("[REVERT-FAILS] an opened count is a team push to everyone else in the house, linking to it", async () => {
    const { svc, notifications } = told();
    const s: any = await svc.open(HOUSE, BOSS, {
      kind: "closing",
      openKey: "k1",
    });
    expect(notifications.persistForRestaurant).toHaveBeenCalledTimes(1);
    const [house, payload, opts] =
      notifications.persistForRestaurant.mock.calls[0];
    expect(house).toBe(HOUSE);
    expect(payload.actionUrl).toBe(`/count/${s.id}`);
    expect(payload.message).toMatch(/^Closing count: 3 shelves to count/);
    expect(opts.wantedBy).toEqual([ME, AYSE]);
    expect(opts.teamPush).toEqual({ what: "count_opened", by: BOSS });
    // A retried tap is the same count, and tells no one twice.
    await svc.open(HOUSE, BOSS, { kind: "closing", openKey: "k1" });
    expect(notifications.persistForRestaurant).toHaveBeenCalledTimes(1);
  });

  it("an opening count calls nobody from the floor", async () => {
    const { svc, notifications } = told();
    await svc.open(HOUSE, BOSS, { kind: "opening" });
    expect(notifications.persistForRestaurant).not.toHaveBeenCalled();
  });

  it("a failed notice never fails the open", async () => {
    const { svc, notifications, db } = told();
    notifications.persistForRestaurant.mockRejectedValue(new Error("down"));
    await expect(svc.open(HOUSE, BOSS, { kind: "full" })).resolves.toBeTruthy();
    expect(db.tables.stock_count_sessions).toHaveLength(1);
  });

  it("[REVERT-FAILS] a shelf sent back tells the person who counted it, by name of shelf", async () => {
    const { svc, notifications, db } = told();
    const s: any = await svc.open(HOUSE, BOSS, { kind: "closing" });
    notifications.persistForRestaurant.mockClear();
    const shelf = db.tables.stock_count_session_shelves.find(
      (r) => r.location_id === "Shelf 1",
    )!;
    Object.assign(shelf, { done_by: ME, done_at: "2026-10-14T01:00:00Z" });
    await svc.askRecount(HOUSE, s.id, "Shelf 1", BOSS, { seenRound: 0 });
    expect(notifications.persistForRestaurant).toHaveBeenCalledTimes(1);
    const [, payload, opts] = notifications.persistForRestaurant.mock.calls[0];
    expect(opts.onlyUserIds).toEqual([ME]);
    expect(opts.teamPush).toEqual({ what: "count_recount", by: BOSS });
    expect(payload.message).toMatch(/was sent back/);
    expect(payload.actionUrl).toBe(`/count/${s.id}`);
  });

  it("a replayed send-back tells no one again", async () => {
    const { svc, notifications, db, inventory } = told();
    const s: any = await svc.open(HOUSE, BOSS, { kind: "closing" });
    notifications.persistForRestaurant.mockClear();
    Object.assign(
      db.tables.stock_count_session_shelves.find(
        (r) => r.location_id === "Bar",
      )!,
      { done_by: ME, done_at: "2026-10-14T01:00:00Z" },
    );
    inventory.askShelfRecount.mockResolvedValue({ round: 1, replayed: true });
    await svc.askRecount(HOUSE, s.id, "Bar", BOSS, { seenRound: 0 });
    expect(notifications.persistForRestaurant).not.toHaveBeenCalled();
  });
});
