import { HttpException, HttpStatus } from "@nestjs/common";
import { CountSessionsService } from "./count-sessions.service";
import { InventoryService } from "./inventory.service";

/**
 * F-1544, lane 4: the review of a stock-take walk. The founder's picks,
 * 2026-10-12 (S224): F2 (a) every line posts as its counter the moment it
 * arrives and the manager signs off completeness -- only a second count of
 * one shelf in one walk is held, and the manager chooses it or sets it aside.
 *
 * The SQL (the chosen line posts and its twins are set aside, the recount
 * round, the sign-off stamp, arrived_at) is proven in PGlite:
 * supabase/tests/20270113200000_a_whole_walk_stamps_last_counted_test.sql.
 * This file proves what the gateway sends, refuses and shows to whom.
 */

type Row = Record<string, any>;
const HOUSE = "house-a";
const OTHER = "house-b";
const WALK = "walk-1";
const ME = "user-bartender";
const AYSE = "user-ayse";
const BOSS = "user-manager";
const ITEM = "item-yakut";
const HOUR = 3_600_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

/** An in-memory client that applies the filters each statement names. */
function fakeDb(tables: Record<string, Row[]>, rpcAnswer?: any) {
  const rpc = jest
    .fn()
    .mockImplementation(async () =>
      typeof rpcAnswer === "function"
        ? rpcAnswer()
        : (rpcAnswer ?? { data: null, error: null }),
    );
  const from = (table: string) => {
    const rows = (tables[table] ??= []);
    const filters: Array<(r: Row) => boolean> = [];
    let op: "select" | "update" = "select";
    let payload: any = null;
    let returning = false;
    let single = false;
    let cap = Infinity;
    let range: [number, number] | null = null;
    const q: any = {
      select: () => {
        if (op !== "select") returning = true;
        return q;
      },
      eq: (c: string, v: any) => (filters.push((r) => r[c] === v), q),
      neq: (c: string, v: any) => (filters.push((r) => r[c] !== v), q),
      gt: (c: string, v: any) => (filters.push((r) => r[c] > v), q),
      is: (c: string, v: any) => (filters.push((r) => (r[c] ?? null) === v), q),
      in: (c: string, vs: any[]) => (filters.push((r) => vs.includes(r[c])), q),
      or: (expr: string) => {
        // Only the shape the service uses: "<c>.is.null,<c>.lt.\"<iso>\"".
        const m = /^(\w+)\.is\.null,\1\.lt\."(.+)"$/.exec(expr);
        if (!m) throw new Error(`fake db: unsupported or(${expr})`);
        filters.push((r) => r[m[1]] == null || r[m[1]] < m[2]);
        return q;
      },
      order: () => q,
      limit: (n: number) => ((cap = n), q),
      range: (a: number, b: number) => ((range = [a, b]), q),
      update: (p: any) => ((op = "update"), (payload = p), q),
      maybeSingle: () => ((single = true), q),
      single: () => ((single = true), q),
      then: (res: any, rej: any) => Promise.resolve(run()).then(res, rej),
    };
    const run = () => {
      let out = rows.filter((r) => filters.every((f) => f(r)));
      if (op === "update") out.forEach((r) => Object.assign(r, payload));
      if (range) out = out.slice(range[0], range[1] + 1);
      out = out.slice(0, cap);
      const data = op === "select" || returning ? out : null;
      if (single) return { data: (data ?? [])[0] ?? null, error: null };
      return { data, error: null };
    };
    return q;
  };
  return { client: { from, rpc }, rpc, tables };
}

// ---------------------------------------------------------------------------
// The one count writer's door: a manager posting a held line.
// ---------------------------------------------------------------------------

function inventoryWith(tables: Record<string, Row[]>) {
  const db = fakeDb(
    {
      restaurant_inventory: [{ id: ITEM, restaurant_id: HOUSE }],
      stock_count_sessions: [{ id: WALK, restaurant_id: HOUSE, kind: "full" }],
      ...tables,
    },
    {
      data: {
        count_id: "c-chosen",
        expected_qty: 6,
        counted_qty: 5,
        variance_qty: -1,
        transaction_id: "t-chosen",
        counted_at: ago(HOUR),
        location_id: "Shelf 1",
        replayed: false,
        session_id: WALK,
        held: false,
      },
      error: null,
    },
  );
  const svc = Object.create(InventoryService.prototype) as any;
  svc.dbService = { getClient: () => db.client };
  svc.logger = { error: () => {}, warn: () => {}, log: () => {} };
  svc.fetchLotRollup = jest.fn().mockResolvedValue(new Map());
  svc.fetchLocationBreakdown = jest.fn().mockResolvedValue(new Map());
  svc.gradePhotoCountSuggestion = jest.fn().mockResolvedValue(undefined);
  return { svc: svc as InventoryService, rpc: db.rpc, tables: db.tables };
}

const HELD_KEY = `count:${ITEM}:line-2`;
/** Ayşe counted Shelf 1 an hour ago; Deniz counted it again 40 minutes ago. */
const conflict = (extraMoves: Row[] = []) => ({
  stock_counts: [
    {
      id: "c-first",
      restaurant_id: HOUSE,
      inventory_id: ITEM,
      stock_state: "live",
      location_id: "Shelf 1",
      counted_at: ago(40 * 60_000),
      transaction_id: "t-first",
      idempotency_key: `count:${ITEM}:line-1`,
    },
  ],
  stock_count_held_lines: [
    {
      id: "held-1",
      restaurant_id: HOUSE,
      session_id: WALK,
      idempotency_key: HELD_KEY,
      held_against: "c-first",
    },
  ],
  inventory_transactions: [
    {
      id: "t-first",
      restaurant_id: HOUSE,
      inventory_id: ITEM,
      stock_type: "live",
      transaction_date: ago(40 * 60_000),
      from_location_id: null,
      to_location_id: null,
      metadata: { lots_taken: [{ location_id: "Shelf 1" }] },
    },
    ...extraMoves,
  ],
});
const heldLine = {
  countedQty: 5,
  clientCountId: "line-2",
  performedBy: AYSE,
  locationId: "Shelf 1",
  sessionId: WALK,
  countedAgoMs: HOUR,
};

describe("a manager posts a held line through the one writer", () => {
  it("sends the held line and who chose it, as its own counter", async () => {
    const { svc, rpc } = inventoryWith(conflict());
    await svc.recordSpotCount(HOUSE, ITEM, heldLine, {
      heldLineId: "held-1",
      resolvedBy: BOSS,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    const [, args] = rpc.mock.calls[0];
    expect(args).toMatchObject({
      p_resolves_held_line: "held-1",
      p_resolved_by: BOSS,
      p_performed_by: AYSE,
      p_idempotency_key: HELD_KEY,
      p_session_id: WALK,
    });
  });

  it("the count it was held against, and that count's own correction, do not overtake it", async () => {
    const { svc, rpc } = inventoryWith(conflict());
    await svc.recordSpotCount(HOUSE, ITEM, heldLine, {
      heldLineId: "held-1",
      resolvedBy: BOSS,
    });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("a sale from that shelf since it was counted still refuses it, in words", async () => {
    const { svc, rpc } = inventoryWith(
      conflict([
        {
          id: "sale-1",
          restaurant_id: HOUSE,
          inventory_id: ITEM,
          stock_type: "live",
          transaction_date: ago(10 * 60_000),
          from_location_id: null,
          to_location_id: null,
          metadata: { lots_taken: [{ location_id: "Shelf 1" }] },
        },
      ]),
    );
    await expect(
      svc.recordSpotCount(HOUSE, ITEM, heldLine, {
        heldLineId: "held-1",
        resolvedBy: BOSS,
      }),
    ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a held line names a walk; without one nothing is counted", async () => {
    const { svc, rpc } = inventoryWith(conflict());
    await expect(
      svc.recordSpotCount(
        HOUSE,
        ITEM,
        { ...heldLine, sessionId: null },
        { heldLineId: "held-1", resolvedBy: BOSS },
      ),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("control: the body cannot name a held line (the route spreads its body into the count)", async () => {
    const { svc, rpc } = inventoryWith(conflict());
    await svc.recordSpotCount(HOUSE, ITEM, {
      ...heldLine,
      countedAgoMs: undefined,
      clientCountId: "line-3",
      resolvesHeldLineId: "held-1",
      resolvedBy: BOSS,
    } as any);
    const [, args] = rpc.mock.calls[0];
    expect(args).not.toHaveProperty("p_resolves_held_line");
    expect(args).not.toHaveProperty("p_resolved_by");
  });

  it("control: a spot count calls the writer with exactly the base's arguments (strict no-op)", async () => {
    const { svc, rpc } = inventoryWith({});
    await svc.recordSpotCount(HOUSE, ITEM, {
      countedQty: 4,
      clientCountId: "spot-1",
      performedBy: ME,
      locationId: "Bar",
    });
    const [name, args] = rpc.mock.calls[0];
    expect(name).toBe("record_stock_count");
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
  });
});

// ---------------------------------------------------------------------------
// The review and its acts.
// ---------------------------------------------------------------------------

function walkDb(extra: Record<string, Row[]> = {}, rpcAnswer?: any) {
  const db = fakeDb(
    {
      stock_count_sessions: [
        {
          id: WALK,
          restaurant_id: HOUSE,
          kind: "full",
          status: "open",
          opened_by: BOSS,
          opened_at: ago(3 * HOUR),
          signed_off_at: null,
          signed_off_by: null,
          abandoned_at: null,
        },
      ],
      stock_count_session_shelves: [
        {
          session_id: WALK,
          restaurant_id: HOUSE,
          location_id: "Shelf 1",
          sort_order: 0,
          claimed_by: AYSE,
          done_by: AYSE,
          done_at: ago(HOUR),
          recount_round: 0,
          recount_asked_at: null,
        },
        {
          session_id: WALK,
          restaurant_id: HOUSE,
          location_id: "Bar",
          sort_order: 1,
          claimed_by: ME,
          done_by: ME,
          done_at: ago(HOUR),
          recount_round: 0,
          recount_asked_at: null,
        },
        {
          session_id: WALK,
          restaurant_id: HOUSE,
          location_id: "Back room",
          sort_order: 2,
          claimed_by: null,
          done_by: null,
          done_at: null,
          recount_round: 1,
          recount_asked_at: ago(30 * 60_000),
        },
      ],
      storage_locations: ["Shelf 1", "Bar", "Back room"].map((id) => ({
        id,
        restaurant_id: HOUSE,
        zone: id,
        section: null,
        name: id,
      })),
      users: [
        { user_id: ME, name: "Deniz" },
        { user_id: AYSE, name: "Ayşe" },
        { user_id: BOSS, name: "Selin" },
      ],
      restaurants: [{ id: HOUSE, currency: "TRY" }],
      restaurant_inventory: [
        {
          id: ITEM,
          restaurant_id: HOUSE,
          display_name: "Yakut 2020",
          bottle_size_ml: 750,
        },
        {
          id: "item-raki",
          restaurant_id: HOUSE,
          display_name: "Yeni Rakı",
          bottle_size_ml: 700,
        },
        {
          id: "item-gin",
          restaurant_id: HOUSE,
          display_name: "Gin",
          bottle_size_ml: 700,
        },
      ],
      inventory_lot_rollup: [
        { restaurant_id: HOUSE, inventory_id: ITEM, wac: 400 },
        { restaurant_id: HOUSE, inventory_id: "item-raki", wac: 700 },
        { restaurant_id: OTHER, inventory_id: ITEM, wac: 1 },
      ],
      inventory_lots: [
        {
          id: "lot-gin",
          restaurant_id: HOUSE,
          inventory_id: "item-gin",
          location_id: "Bar",
          stock_state: "live",
          qty: 2,
          open_bottle_ml: 0,
        },
      ],
      stock_counts: [
        {
          id: "c1",
          restaurant_id: HOUSE,
          session_id: WALK,
          inventory_id: ITEM,
          location_id: "Shelf 1",
          counted_qty: 4,
          expected_qty: 6,
          variance_qty: -2,
          counted_open_ml: null,
          expected_open_ml: null,
          counted_by: AYSE,
          counted_at: ago(2 * HOUR),
          arrived_at: ago(2 * HOUR),
        },
        {
          id: "c2",
          restaurant_id: HOUSE,
          session_id: WALK,
          inventory_id: ITEM,
          location_id: "Bar",
          counted_qty: 1,
          expected_qty: 0,
          variance_qty: 1,
          counted_open_ml: null,
          expected_open_ml: null,
          counted_by: ME,
          counted_at: ago(2 * HOUR),
          arrived_at: ago(2 * HOUR),
        },
        {
          id: "c3",
          restaurant_id: HOUSE,
          session_id: WALK,
          inventory_id: "item-raki",
          location_id: "Bar",
          counted_qty: 3,
          expected_qty: 3,
          variance_qty: 0,
          counted_open_ml: 350,
          expected_open_ml: 420,
          counted_by: ME,
          counted_at: ago(2 * HOUR),
          arrived_at: ago(2 * HOUR),
        },
        {
          id: "c-other",
          restaurant_id: OTHER,
          session_id: WALK,
          inventory_id: ITEM,
          location_id: "Bar",
          counted_qty: 99,
          expected_qty: 0,
          variance_qty: 99,
          counted_by: ME,
          counted_at: ago(2 * HOUR),
          arrived_at: ago(2 * HOUR),
        },
      ],
      stock_count_held_lines: [
        {
          id: "held-1",
          restaurant_id: HOUSE,
          session_id: WALK,
          inventory_id: ITEM,
          location_id: "Shelf 1",
          stock_state: "live",
          counted_qty: 5,
          counted_open_ml: null,
          counted_by: ME,
          counted_at: ago(90 * 60_000),
          reason: "Stock-take",
          idempotency_key: HELD_KEY,
          held_against: "c1",
          state: "held",
          resolved_count_id: null,
        },
      ],
      stock_count_parked_lines: [
        {
          id: "park-1",
          restaurant_id: HOUSE,
          session_id: WALK,
          location_id: "Bar",
          description: "Kavaklidere Prestige, no label",
          counted_qty: 2,
          counted_by: ME,
          counted_at: ago(100 * 60_000),
          state: "parked",
          resolved_count_id: null,
        },
      ],
      ...extra,
    },
    rpcAnswer,
  );
  // The review's two database functions are called by the real
  // InventoryService (beside the one count writer); the count path is a mock.
  const real = Object.create(InventoryService.prototype) as any;
  real.dbService = { getClient: () => db.client };
  real.logger = { error: () => {}, warn: () => {}, log: () => {} };
  const inventory = {
    recordSpotCount: jest
      .fn()
      .mockResolvedValue({ count: { countId: "c-new", held: false } }),
    askShelfRecount: real.askShelfRecount.bind(real),
    signOffCountSession: real.signOffCountSession.bind(real),
  };
  const svc = new CountSessionsService(
    { getClient: () => db.client } as any,
    inventory as unknown as InventoryService,
  );
  return { svc, inventory, db };
}

describe("the review shows the walk; the books and money only to an owner or a manager", () => {
  it("a bartender sees what was counted, never what the books said, the difference or its value", async () => {
    const { svc } = walkDb();
    const r = await svc.review(HOUSE, WALK, false);
    expect(r.seesMoney).toBe(false);
    expect(r.currency).toBeNull();
    const lines = r.shelves.flatMap((s) => s.lines);
    expect(lines.length).toBe(3);
    for (const l of lines) {
      expect(l).not.toHaveProperty("expected");
      expect(l).not.toHaveProperty("variance");
      expect(l).not.toHaveProperty("value");
    }
    expect(r.shelves.every((s) => !("value" in s))).toBe(true);
    expect(r.held[0].against).not.toHaveProperty("variance");
    expect(r.moved).toEqual([]);
  });

  it("a manager sees the difference and its value in the house's currency, open bottles included", async () => {
    const { svc } = walkDb();
    const r = await svc.review(HOUSE, WALK, true);
    expect(r.currency).toBe("TRY");
    const shelf1 = r.shelves.find((s) => s.locationId === "Shelf 1")!;
    expect(shelf1.lines[0]).toMatchObject({
      counted: 4,
      expected: 6,
      variance: -2,
      value: -800,
      countedBy: "Ayşe",
    });
    const raki = r.shelves
      .find((s) => s.locationId === "Bar")!
      .lines.find((l) => l.inventoryId === "item-raki")!;
    // 70 ml short of a 700 ml bottle at 700 a bottle.
    expect(raki.value).toBe(-70);
  });

  it("never reads another house's lines or costs", async () => {
    const { svc } = walkDb();
    const r = await svc.review(HOUSE, WALK, true);
    const all = [...r.shelves.flatMap((s) => s.lines), ...r.elsewhere];
    expect(all.some((l) => l.countId === "c-other")).toBe(false);
  });

  it("names the shelves not counted, what a done shelf's books hold with no line, held and parked lines", async () => {
    const { svc } = walkDb();
    const r = await svc.review(HOUSE, WALK, true);
    expect(r.notCounted).toEqual([
      { locationId: "Back room", name: "Back room", round: 1 },
    ]);
    expect(r.shelves.find((s) => s.locationId === "Bar")!.missed).toEqual([
      { inventoryId: "item-gin", name: "Gin" },
    ]);
    expect(r.held).toHaveLength(1);
    expect(r.held[0]).toMatchObject({
      id: "held-1",
      counted: 5,
      countedBy: "Deniz",
      against: { countId: "c1", counted: 4, countedBy: "Ayşe" },
    });
    expect(r.parked[0]).toMatchObject({
      id: "park-1",
      description: "Kavaklidere Prestige, no label",
      counted: 2,
      shelf: "Bar",
    });
  });

  it("a bottle short on one shelf and found where the books had none reads as moved, and nothing is posted", async () => {
    const { svc, inventory } = walkDb();
    const r = await svc.review(HOUSE, WALK, true);
    expect(r.moved).toEqual([
      {
        inventoryId: ITEM,
        name: "Yakut 2020",
        bottles: 1,
        from: "Shelf 1",
        to: "Bar",
      },
    ]);
    expect(inventory.recordSpotCount).not.toHaveBeenCalled();
  });

  it("lists the lines that arrived after sign-off", async () => {
    const { svc, db } = walkDb();
    const s = db.tables.stock_count_sessions[0];
    s.status = "signed_off";
    s.signed_off_at = ago(HOUR);
    s.signed_off_by = BOSS;
    db.tables.stock_counts.push({
      id: "c-late",
      restaurant_id: HOUSE,
      session_id: WALK,
      inventory_id: "item-gin",
      location_id: "Bar",
      counted_qty: 2,
      expected_qty: 2,
      variance_qty: 0,
      counted_by: ME,
      counted_at: ago(2 * HOUR),
      arrived_at: ago(10 * 60_000),
    });
    const r = await svc.review(HOUSE, WALK, true);
    expect(r.signedOffBy).toBe("Selin");
    expect(r.afterSignOff.map((l) => l.countId)).toEqual(["c-late"]);
  });
});

describe("a held line: use it or set it aside", () => {
  it("use posts it through the count path as its counter, at its moment, naming the line", async () => {
    const { svc, inventory } = walkDb();
    const out = await svc.useHeldLine(HOUSE, WALK, "held-1", BOSS);
    expect(out).toMatchObject({ state: "posted", countId: "c-new" });
    const [house, item, dto, resolve] = inventory.recordSpotCount.mock.calls[0];
    expect([house, item]).toEqual([HOUSE, ITEM]);
    expect(dto).toMatchObject({
      countedQty: 5,
      clientCountId: "line-2",
      performedBy: ME,
      locationId: "Shelf 1",
      sessionId: WALK,
    });
    expect(dto.countedAgoMs).toBeGreaterThanOrEqual(90 * 60_000);
    expect(resolve).toEqual({ heldLineId: "held-1", resolvedBy: BOSS });
  });

  it("a line already posted replays; one set aside is refused; another house's is not found", async () => {
    const { svc, inventory, db } = walkDb();
    db.tables.stock_count_held_lines[0].state = "posted";
    db.tables.stock_count_held_lines[0].resolved_count_id = "c-was";
    await expect(
      svc.useHeldLine(HOUSE, WALK, "held-1", BOSS),
    ).resolves.toMatchObject({ replayed: true, countId: "c-was" });
    db.tables.stock_count_held_lines[0].state = "dropped";
    await expect(
      svc.useHeldLine(HOUSE, WALK, "held-1", BOSS),
    ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
    await expect(
      svc.useHeldLine(OTHER, WALK, "held-1", BOSS),
    ).rejects.toMatchObject({ status: HttpStatus.NOT_FOUND });
    expect(inventory.recordSpotCount).not.toHaveBeenCalled();
  });

  it("set aside moves no stock, replays, and a used line cannot be set aside", async () => {
    const { svc, inventory, db } = walkDb();
    await expect(
      svc.dropHeldLine(HOUSE, WALK, "held-1", BOSS),
    ).resolves.toMatchObject({ state: "dropped", replayed: false });
    expect(db.tables.stock_count_held_lines[0]).toMatchObject({
      state: "dropped",
      resolved_by: BOSS,
    });
    await expect(
      svc.dropHeldLine(HOUSE, WALK, "held-1", BOSS),
    ).resolves.toMatchObject({ replayed: true });
    db.tables.stock_count_held_lines[0].state = "posted";
    await expect(
      svc.dropHeldLine(HOUSE, WALK, "held-1", BOSS),
    ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
    expect(inventory.recordSpotCount).not.toHaveBeenCalled();
  });
});

describe("a parked line: count it as a house item, or set it aside", () => {
  it("counts it on its shelf as its counter under one key per line, then marks it", async () => {
    const { svc, inventory, db } = walkDb();
    const out = await svc.carryParked(HOUSE, WALK, "park-1", BOSS, {
      inventoryId: "item-gin",
    });
    expect(out).toMatchObject({ state: "carried", countId: "c-new" });
    const [, item, dto] = inventory.recordSpotCount.mock.calls[0];
    expect(item).toBe("item-gin");
    expect(dto).toMatchObject({
      countedQty: 2,
      clientCountId: "parked:park-1",
      performedBy: ME,
      locationId: "Bar",
      sessionId: WALK,
    });
    expect(db.tables.stock_count_parked_lines[0]).toMatchObject({
      state: "carried",
      resolved_by: BOSS,
      resolved_count_id: "c-new",
    });
    await expect(
      svc.carryParked(HOUSE, WALK, "park-1", BOSS, { inventoryId: "item-gin" }),
    ).resolves.toMatchObject({ replayed: true });
    expect(inventory.recordSpotCount).toHaveBeenCalledTimes(1);
  });

  it("asks which item, and a line set aside is not counted", async () => {
    const { svc, inventory } = walkDb();
    await expect(
      svc.carryParked(HOUSE, WALK, "park-1", BOSS, {}),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });
    await expect(
      svc.dropParked(HOUSE, WALK, "park-1", BOSS),
    ).resolves.toMatchObject({ state: "dropped", replayed: false });
    await expect(
      svc.carryParked(HOUSE, WALK, "park-1", BOSS, { inventoryId: "item-gin" }),
    ).rejects.toMatchObject({ status: HttpStatus.CONFLICT });
    expect(inventory.recordSpotCount).not.toHaveBeenCalled();
  });
});

describe("a shelf sent back, and sign-off", () => {
  it("a 'done' from before the shelf was sent back posts no zeros and does not close it", async () => {
    const { svc, inventory, db } = walkDb({
      inventory_lots: [
        {
          id: "lot-x",
          restaurant_id: HOUSE,
          inventory_id: ITEM,
          location_id: "Back room",
          stock_state: "live",
          qty: 3,
          open_bottle_ml: 0,
        },
      ],
    });
    const out = await svc.shelfDone(
      HOUSE,
      WALK,
      "Back room",
      ME,
      { clientDoneId: "d-old", zeroItemIds: [ITEM], countedAgoMs: HOUR },
      async () => false,
    );
    expect(out).toMatchObject({ done: false, round: 1 });
    expect(inventory.recordSpotCount).not.toHaveBeenCalled();
    expect(
      db.tables.stock_count_session_shelves.find(
        (s) => s.location_id === "Back room",
      )!.done_at,
    ).toBeNull();
  });

  it("control: a 'done' after the ask closes the shelf as before", async () => {
    const { svc, db } = walkDb();
    const out = await svc.shelfDone(
      HOUSE,
      WALK,
      "Back room",
      ME,
      { clientDoneId: "d-new" },
      async () => false,
    );
    expect(out).toMatchObject({ done: true });
    expect(
      db.tables.stock_count_session_shelves.find(
        (s) => s.location_id === "Back room",
      )!.done_at,
    ).not.toBeNull();
  });

  it("the walk tells the phone each shelf's round", async () => {
    const { svc } = walkDb();
    const pulled = await svc.pull(HOUSE, WALK, ME);
    expect(pulled.shelves.map((s) => [s.locationId, s.round])).toEqual([
      ["Shelf 1", 0],
      ["Bar", 0],
      ["Back room", 1],
    ]);
  });

  it("sends the round the manager saw, and an ended walk is refused in words", async () => {
    const ok = walkDb(
      {},
      {
        data: {
          location_id: "Bar",
          round: 1,
          asked_at: ago(0),
          dropped_held: 1,
          replayed: false,
        },
        error: null,
      },
    );
    await expect(
      ok.svc.askRecount(HOUSE, WALK, "Bar", BOSS, { seenRound: 0 }),
    ).resolves.toMatchObject({ round: 1, setAside: 1, replayed: false });
    expect(ok.db.rpc).toHaveBeenCalledWith("ask_stock_count_shelf_recount", {
      p_session_id: WALK,
      p_restaurant_id: HOUSE,
      p_location_id: "Bar",
      p_asked_by: BOSS,
      p_seen_round: 0,
    });
    await expect(
      ok.svc.askRecount(HOUSE, WALK, "Bar", BOSS, {}),
    ).rejects.toMatchObject({ status: HttpStatus.BAD_REQUEST });

    const ended = walkDb(
      {},
      {
        data: null,
        error: {
          code: "22023",
          message:
            "This count has ended, so no shelf can be sent back to be counted again.",
        },
      },
    );
    const err = await ended.svc
      .askRecount(HOUSE, WALK, "Bar", BOSS, { seenRound: 0 })
      .catch((e) => e);
    expect(err).toBeInstanceOf(HttpException);
    expect(err.getStatus()).toBe(HttpStatus.CONFLICT);
    expect(err.message).toMatch(/has ended/);
  });

  it("sign-off asks while a shelf is not counted, and signs on the manager's word", async () => {
    const asks = walkDb(
      {},
      {
        data: {
          session_id: WALK,
          status: "open",
          signed_off_at: null,
          stamped: null,
          not_counted: 1,
          replayed: false,
        },
        error: null,
      },
    );
    await expect(
      asks.svc.signOff(HOUSE, WALK, BOSS, {}),
    ).resolves.toMatchObject({ signedOff: false, notCounted: 1 });
    expect(asks.db.rpc).toHaveBeenCalledWith("sign_off_stock_count_session", {
      p_session_id: WALK,
      p_restaurant_id: HOUSE,
      p_signed_off_by: BOSS,
      p_even_if_unfinished: false,
    });
    const signs = walkDb(
      {},
      {
        data: {
          session_id: WALK,
          status: "signed_off",
          signed_off_at: ago(0),
          stamped: 2,
          not_counted: 1,
          replayed: false,
        },
        error: null,
      },
    );
    await expect(
      signs.svc.signOff(HOUSE, WALK, BOSS, { evenIfUnfinished: true }),
    ).resolves.toMatchObject({ signedOff: true, stamped: 2 });
    expect(signs.db.rpc.mock.calls[0][1].p_even_if_unfinished).toBe(true);
  });
});
