import "reflect-metadata";
import { BadRequestException, ConflictException, ForbiddenException } from "@nestjs/common";
import { FloorService } from "./floor.service";
import { FloorBoardService } from "./floor-board.service";
import { FloorTablesService, mergedSeats } from "./floor-tables.service";
import type { FloorActor } from "./floor-common";

/**
 * The coordinator's follow-up on ADR 0345/0347: tables (create, patch, tray),
 * merges and splits, Food-up delivered and its open list, and my clock state.
 * A scripted PostgREST stand-in answers every read and records every write.
 */
type Call = {
  table: string;
  op: string;
  payload?: any;
  filters: Array<[string, string, unknown]>;
  terminal?: string;
};
type Answer = { data: unknown; error: unknown };

function fakeDb(respond: (c: Call) => Answer | undefined) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const c: Call = { table, op: "select", filters: [] };
    calls.push(c);
    const b: any = {};
    for (const op of ["insert", "update", "upsert", "delete"]) {
      b[op] = (payload?: any) => {
        c.op = op;
        c.payload = payload;
        return b;
      };
    }
    b.select = () => b;
    for (const f of ["eq", "neq", "is", "in", "gte", "lt", "lte", "gt", "order", "limit", "or"]) {
      b[f] = (col: string, val: unknown) => {
        c.filters.push([f, col, val]);
        return b;
      };
    }
    const done = () => Promise.resolve(respond(c) ?? { data: c.terminal ? null : [], error: null });
    b.single = () => ((c.terminal = "single"), done());
    b.maybeSingle = () => ((c.terminal = "maybeSingle"), done());
    b.then = (res: any, rej: any) => done().then(res, rej);
    return b;
  };
  const rpc = jest.fn(async (fn: string, args: Record<string, unknown>) => {
    const c: Call = { table: `rpc:${fn}`, op: "rpc", payload: args, filters: [] };
    calls.push(c);
    return respond(c) ?? { data: null, error: null };
  });
  return { calls, rpc, db: { supabase: { from, rpc } } as any };
}

const HOUSE = { name: "Tuzlu", timezone: "Europe/Istanbul", country: "TR" };
const NOW = Date.parse("2026-11-07T19:00:00Z");
const owner: FloorActor = { userId: "m1", restaurantId: "r1", role: "manager" };
const waiter: FloorActor = { userId: "w1", restaurantId: "r1", role: "staff" };

const T1 = "11111111-1111-4111-8111-111111111111";
const T2 = "22222222-2222-4222-8222-222222222222";

/** House, settings and a section holding T1 and T2; w1 holds T1 by table assignment. */
function house(extra: (c: Call) => Answer | undefined) {
  return (c: Call): Answer | undefined => {
    const hit = extra(c);
    if (hit) return hit;
    if (c.table === "restaurants") return { data: HOUSE, error: null };
    if (c.table === "floor_settings") return { data: { warn_after_min: 6, late_after_min: 10 }, error: null };
    if (c.table === "floor_sections") return { data: [{ id: "sec" }], error: null };
    if (c.table === "floor_section_tables") {
      return { data: [{ table_id: T1, section_id: "sec" }, { table_id: T2, section_id: "sec" }], error: null };
    }
    if (c.table === "floor_assignments") {
      return { data: [{ user_id: "w1", table_id: T1, section_id: null, service_date: "2026-11-07" }], error: null };
    }
    return undefined;
  };
}

function build(respond: (c: Call) => Answer | undefined) {
  const f = fakeDb(respond);
  const ws = { emitFloorWord: jest.fn() };
  const floor = new FloorService(f.db, ws as any, {} as any);
  const analytics = { renameOrHideTable: jest.fn(async () => ({})) };
  const insights = { dropStored: jest.fn(async () => true), refreshStored: jest.fn(async () => undefined) };
  const svc = new FloorTablesService(f.db, floor, analytics as any, insights as any);
  return { ...f, ws, floor, analytics, insights, svc };
}

const tableRow = (over: Record<string, unknown> = {}) => ({
  id: T1,
  label: "12",
  seats: null,
  is_outdoor: null,
  x_pos: 10,
  y_pos: 10,
  shape: null,
  hidden_at: null,
  is_active: true,
  ...over,
});

const reject = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as any;
  }
  throw new Error("expected a refusal");
};

// ---------------------------------------------------------------------------
// Tables
// ---------------------------------------------------------------------------

describe("FloorTablesService.createTable (ADR 0347 D3, D4)", () => {
  it("passes NULL for every value not given (seats never 2) and announces tables_changed", async () => {
    const t = build((c) =>
      c.table === "rpc:floor_create_table" ? { data: { table: { id: "n1", seats: null }, checks_linked: 3 }, error: null } : undefined,
    );
    const out = await t.svc.createTable(owner, { label: "14" });
    expect(t.rpc).toHaveBeenCalledWith("floor_create_table", {
      p_restaurant_id: "r1",
      p_label: "14",
      p_seats: null,
      p_is_outdoor: null,
      p_x_pos: null,
      p_y_pos: null,
      p_shape: null,
    });
    expect(out).toEqual({ table: { id: "n1", seats: null }, checksLinked: 3 });
    expect(t.ws.emitFloorWord).toHaveBeenCalledWith("r1", { tableId: null, word: "tables_changed" });
  });

  it("answers a twin with 409 naming it, and a bad name with 400", async () => {
    const twin = build((c) =>
      c.table === "rpc:floor_create_table" ? { data: { error: "twin", twin_id: "x", twin_label: "Table 12" }, error: null } : undefined,
    );
    const e = await reject(twin.svc.createTable(owner, { label: "12" }));
    expect(e).toBeInstanceOf(ConflictException);
    expect(e.getResponse()).toMatchObject({ code: "TABLE_TWIN", twinId: "x", twinLabel: "Table 12" });

    const bad = build((c) => (c.table === "rpc:floor_create_table" ? { data: { error: "bad_label" }, error: null } : undefined));
    await expect(bad.svc.createTable(owner, { label: " " })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe("FloorTablesService.patchTable (ADR 0347 D5, D6)", () => {
  const readOk = (over: Record<string, unknown> = {}) => (c: Call) =>
    c.table === "restaurant_tables" && c.terminal === "maybeSingle" ? { data: tableRow(over), error: null } : undefined;

  it("back to the tray clears both coordinates, null clears seats, and nothing else is written", async () => {
    const t = build(readOk());
    await t.svc.patchTable(owner, T1, { tray: true, seats: null });
    const upd = t.calls.find((c) => c.table === "restaurant_tables" && c.op === "update")!;
    expect(upd.payload).toMatchObject({ x_pos: null, y_pos: null, seats: null });
    expect(Object.keys(upd.payload).sort()).toEqual(["seats", "updated_at", "x_pos", "y_pos"]);
    expect(t.analytics.renameOrHideTable).not.toHaveBeenCalled();
  });

  it("refuses an empty change, and the tray together with a place", async () => {
    const t = build(readOk());
    await expect(t.svc.patchTable(owner, T1, {})).rejects.toBeInstanceOf(BadRequestException);
    await expect(t.svc.patchTable(owner, T1, { tray: true, x_pos: 5 })).rejects.toBeInstanceOf(BadRequestException);
  });

  it("refuses a rename onto a till twin before anything is written", async () => {
    const t = build((c) =>
      c.table === "rpc:floor_table_twin" ? { data: [{ id: T2, label: "Masa 7" }], error: null } : readOk()(c),
    );
    const e = await reject(t.svc.patchTable(owner, T1, { label: "masa 7" }));
    expect(e.getResponse()).toMatchObject({ code: "TABLE_TWIN", twinId: T2 });
    expect(t.rpc).toHaveBeenCalledWith("floor_table_twin", { p_restaurant_id: "r1", p_label: "masa 7", p_exclude_id: T1 });
    expect(t.analytics.renameOrHideTable).not.toHaveBeenCalled();
  });

  it("refuses to hide a table with a party, or one pushed together", async () => {
    const seated = build((c) =>
      c.table === "floor_seatings" ? { data: [{ id: "s1" }], error: null } : readOk()(c),
    );
    expect((await reject(seated.svc.patchTable(owner, T1, { hidden: true }))).getResponse()).toMatchObject({ code: "TABLE_SEATED" });

    const merged = build((c) =>
      c.table === "floor_table_merge_members" ? { data: [{ merge_id: "g" }], error: null } : readOk()(c),
    );
    expect((await reject(merged.svc.patchTable(owner, T1, { hidden: true }))).getResponse()).toMatchObject({ code: "TABLE_MERGED" });
    expect(merged.analytics.renameOrHideTable).not.toHaveBeenCalled();
    expect(merged.insights.dropStored).not.toHaveBeenCalled();
  });

  it("hides a free table through the analytics path, clearing and refreshing the table insights", async () => {
    const t = build(readOk());
    await t.svc.patchTable(owner, T1, { hidden: true });
    expect(t.insights.dropStored).toHaveBeenCalledWith("r1", ["tables"]);
    expect(t.analytics.renameOrHideTable).toHaveBeenCalledWith("r1", T1, { hidden: true });
    expect(t.insights.refreshStored).toHaveBeenCalledWith("r1", ["tables"]);
  });
});

// ---------------------------------------------------------------------------
// Merges
// ---------------------------------------------------------------------------

describe("FloorTablesService.merge (the checker's mergeTables)", () => {
  const two = (pos: Array<[number | null, number | null]>, seats: Array<number | null> = [4, null]) => ({
    data: [
      { id: T1, label: "1", seats: seats[0], x_pos: pos[0][0], y_pos: pos[0][1], hidden_at: null },
      { id: T2, label: "2", seats: seats[1], x_pos: pos[1][0], y_pos: pos[1][1], hidden_at: null },
    ],
    error: null,
  });
  const seatedT1 = (c: Call) =>
    c.table === "floor_seatings" && c.op === "select" ? { data: [{ id: "s1", table_id: T1 }], error: null } : undefined;

  it("a manager merges any two tables of a section: members, joined-empty, seats unknown, event and word", async () => {
    const t = build(
      house((c) => {
        if (c.table === "restaurant_tables") return two([[10, 10], [80, 80]]);
        if (c.table === "floor_table_merges" && c.op === "insert") return { data: { id: "g1" }, error: null };
        return seatedT1(c);
      }),
    );
    const out = await t.svc.merge(owner, [T1, T2], NOW);
    expect(out).toEqual({ mergeId: "g1", tableIds: [T1, T2], orientation: null, seats: null });
    const members = t.calls.find((c) => c.table === "floor_table_merge_members" && c.op === "insert")!;
    expect(members.payload).toEqual([
      { merge_id: "g1", restaurant_id: "r1", table_id: T1, seating_id: "s1", joined_empty: false },
      { merge_id: "g1", restaurant_id: "r1", table_id: T2, seating_id: null, joined_empty: true },
    ]);
    const ev = t.calls.find((c) => c.table === "floor_events" && c.op === "insert")!;
    expect(ev.payload).toMatchObject({ kind: "merged", meta: { merge_id: "g1", table_ids: [T1, T2] } });
    expect(t.ws.emitFloorWord).toHaveBeenCalledWith("r1", { tableId: null, word: "merged" });
    // A merge never writes restaurant_tables (D6).
    expect(t.calls.some((c) => c.table === "restaurant_tables" && c.op !== "select")).toBe(false);
  });

  it("a waiter needs to hold one of the tables", async () => {
    const t = build(
      house((c) => {
        if (c.table === "floor_assignments") return { data: [], error: null };
        if (c.table === "restaurant_tables") return two([[10, 10], [20, 10]]);
        return seatedT1(c);
      }),
    );
    await expect(t.svc.merge(waiter, [T1, T2], NOW)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("a waiter's tables must be neighbours; a tray table is next to nothing", async () => {
    const far = build(house((c) => (c.table === "restaurant_tables" ? two([[10, 10], [80, 80]]) : seatedT1(c))));
    expect((await reject(far.svc.merge(waiter, [T1, T2], NOW))).getResponse()).toMatchObject({ code: "MERGE_NOT_ADJACENT" });
    const tray = build(house((c) => (c.table === "restaurant_tables" ? two([[10, 10], [null, null]]) : seatedT1(c))));
    expect((await reject(tray.svc.merge(waiter, [T1, T2], NOW))).getResponse()).toMatchObject({ code: "MERGE_NOT_ADJACENT" });
  });

  it("a waiter merges neighbours they hold; seats sum when every member's is known", async () => {
    const t = build(
      house((c) => {
        if (c.table === "restaurant_tables") return two([[10, 10], [24, 12]], [4, 2]);
        if (c.table === "floor_table_merges" && c.op === "insert") return { data: { id: "g2" }, error: null };
        return seatedT1(c);
      }),
    );
    expect(await t.svc.merge(waiter, [T1, T2], NOW)).toEqual({ mergeId: "g2", tableIds: [T1, T2], orientation: "horizontal", seats: 6 });
  });

  it("refuses tables of different sections, none seated, and a table already merged", async () => {
    const sections = build(
      house((c) => {
        if (c.table === "floor_section_tables") return { data: [{ table_id: T1, section_id: "sec" }], error: null };
        if (c.table === "restaurant_tables") return two([[10, 10], [20, 10]]);
        return seatedT1(c);
      }),
    );
    expect((await reject(sections.svc.merge(owner, [T1, T2], NOW))).getResponse()).toMatchObject({ code: "MERGE_SECTIONS" });

    const empty = build(house((c) => (c.table === "restaurant_tables" ? two([[10, 10], [20, 10]]) : undefined)));
    expect((await reject(empty.svc.merge(owner, [T1, T2], NOW))).getResponse()).toMatchObject({ code: "MERGE_NONE_SEATED" });

    const already = build(
      house((c) => {
        if (c.table === "restaurant_tables") return two([[10, 10], [20, 10]]);
        if (c.table === "floor_table_merge_members") return { data: [{ table_id: T2 }], error: null };
        return seatedT1(c);
      }),
    );
    expect((await reject(already.svc.merge(owner, [T1, T2], NOW))).getResponse()).toMatchObject({ code: "MERGE_ALREADY" });
  });

  it("a member race (unique index) removes the new merge row and answers 409", async () => {
    const t = build(
      house((c) => {
        if (c.table === "restaurant_tables") return two([[10, 10], [20, 10]]);
        if (c.table === "floor_table_merges" && c.op === "insert") return { data: { id: "g3" }, error: null };
        if (c.table === "floor_table_merge_members" && c.op === "insert") return { data: null, error: { code: "23505" } };
        return seatedT1(c);
      }),
    );
    expect((await reject(t.svc.merge(owner, [T1, T2], NOW))).getResponse()).toMatchObject({ code: "MERGE_ALREADY" });
    const del = t.calls.find((c) => c.table === "floor_table_merges" && c.op === "delete")!;
    expect(del.filters).toEqual(expect.arrayContaining([["eq", "id", "g3"], ["eq", "restaurant_id", "r1"]]));
  });
});

describe("FloorTablesService.split", () => {
  const live = (extra: (c: Call) => Answer | undefined = () => undefined) =>
    house((c) => {
      const hit = extra(c);
      if (hit) return hit;
      if (c.table === "floor_table_merges" && c.terminal === "maybeSingle") return { data: { id: "g1", split_at: null }, error: null };
      if (c.table === "floor_table_merges" && c.op === "update") return { data: [{ id: "g1" }], error: null };
      if (c.table === "floor_table_merge_members" && c.op === "select") return { data: [{ table_id: T1 }, { table_id: T2 }], error: null };
      return undefined;
    });

  it("a waiter who holds a member splits it: split_at, members released, event and word", async () => {
    const t = build(live());
    expect(await t.svc.split(waiter, "g1", NOW)).toEqual({ mergeId: "g1", split: true, tableIds: [T1, T2] });
    const upd = t.calls.find((c) => c.table === "floor_table_merges" && c.op === "update")!;
    expect(upd.payload).toMatchObject({ split_by: "w1" });
    expect(upd.filters).toEqual(expect.arrayContaining([["is", "split_at", null]]));
    const free = t.calls.find((c) => c.table === "floor_table_merge_members" && c.op === "update")!;
    expect(free.payload).toEqual({ active: false });
    expect(t.calls.find((c) => c.table === "floor_events")!.payload).toMatchObject({ kind: "split" });
    expect(t.ws.emitFloorWord).toHaveBeenCalledWith("r1", { tableId: null, word: "split" });
  });

  it("a waiter who holds no member is refused; a split merge is a 409", async () => {
    const stranger = build(live((c) => (c.table === "floor_assignments" ? { data: [], error: null } : undefined)));
    await expect(stranger.svc.split(waiter, "g1", NOW)).rejects.toBeInstanceOf(ForbiddenException);
    const done = build(
      live((c) =>
        c.table === "floor_table_merges" && c.terminal === "maybeSingle" ? { data: { id: "g1", split_at: "x" }, error: null } : undefined,
      ),
    );
    await expect(done.svc.split(owner, "g1", NOW)).rejects.toBeInstanceOf(ConflictException);
  });
});

describe("mergedSeats (ADR 0347 D4)", () => {
  it("sums known seats and is unknown when any member's is", () => {
    expect(mergedSeats([4, 2])).toBe(6);
    expect(mergedSeats([4, null])).toBeNull();
    expect(mergedSeats([])).toBeNull();
  });
});

describe("the board carries live merges", () => {
  it("lists each live merge and marks its tables", async () => {
    const f = fakeDb(
      house((c) => {
        if (c.table === "restaurant_tables") {
          return {
            data: [
              { id: T1, label: "1", seats: 4, hidden_at: null },
              { id: T2, label: "2", seats: 2, hidden_at: null },
            ],
            error: null,
          };
        }
        if (c.table === "floor_table_merges") return { data: [{ id: "g1", orientation: "vertical" }], error: null };
        if (c.table === "floor_table_merge_members") {
          return { data: [{ merge_id: "g1", table_id: T1 }, { merge_id: "g1", table_id: T2 }], error: null };
        }
        return undefined;
      }),
    );
    const out = await new FloorBoardService(f.db).board(owner, NOW);
    expect(out.merges).toEqual([{ mergeId: "g1", tableIds: [T1, T2], orientation: "vertical", seats: 6 }]);
    expect(out.tables.map((t) => t.mergeId)).toEqual(["g1", "g1"]);
  });
});

// ---------------------------------------------------------------------------
// Food-up and the clock
// ---------------------------------------------------------------------------

describe("Food-up delivered and the open list", () => {
  it("delivered records a food_delivered visit on the open seating and a delivered ack", async () => {
    const f = fakeDb((c) => {
      if (c.table === "floor_events" && c.terminal === "maybeSingle") return { data: { id: "fu1", table_id: T1, seating_id: "s1" }, error: null };
      if (c.table === "floor_seatings" && c.terminal === "maybeSingle") {
        return c.filters.some(([, col]) => col === "id")
          ? { data: { id: "s1", table_id: T1, left_at: null }, error: null }
          : { data: { id: "s1" }, error: null };
      }
      if (c.table === "floor_visits" && c.op === "insert") return { data: { id: "v1" }, error: null };
      return undefined;
    });
    const svc = new FloorService(f.db, { emitFloorWord: jest.fn() } as any, {} as any);
    expect(await svc.foodDelivered(waiter, "fu1")).toEqual({ foodUpId: "fu1", delivered: true, visitId: "v1" });
    expect(f.calls.find((c) => c.table === "floor_visits" && c.op === "insert")!.payload).toMatchObject({ source: "food_delivered", seating_id: "s1" });
    const ack = f.calls.find((c) => c.table === "floor_events" && c.op === "insert")!;
    expect(ack.payload).toMatchObject({ kind: "food_ack", meta: { food_up_id: "fu1", resolution: "delivered", visit_id: "v1" } });
  });

  it("a second delivery is a 409", async () => {
    const f = fakeDb((c) => {
      if (c.table === "floor_events" && c.terminal === "maybeSingle") return { data: { id: "fu1", table_id: T1, seating_id: null }, error: null };
      if (c.table === "floor_events" && c.op === "select") return { data: [{ meta: { food_up_id: "fu1", resolution: "delivered" } }], error: null };
      return undefined;
    });
    const svc = new FloorService(f.db, { emitFloorWord: jest.fn() } as any, {} as any);
    await expect(svc.foodDelivered(waiter, "fu1")).rejects.toBeInstanceOf(ConflictException);
  });

  it("the open list leaves out delivered ones and says which are acknowledged", async () => {
    const f = fakeDb((c) => {
      if (c.table === "floor_events") {
        return {
          data: [
            { id: "a3", kind: "food_ack", table_id: T2, actor_id: "w1", meta: { food_up_id: "fu2", resolution: "delivered" }, created_at: "2026-11-07T18:58:00Z" },
            { id: "a1", kind: "food_ack", table_id: T1, actor_id: "w1", meta: { food_up_id: "fu1" }, created_at: "2026-11-07T18:55:00Z" },
            { id: "fu2", kind: "food_up", table_id: T2, actor_id: "k1", meta: { course: "mains", note: null }, created_at: "2026-11-07T18:50:00Z" },
            { id: "fu1", kind: "food_up", table_id: T1, actor_id: "k1", meta: { course: "starters", note: "no onion" }, created_at: "2026-11-07T18:40:00Z" },
          ],
          error: null,
        };
      }
      if (c.table === "restaurant_tables") return { data: [{ id: T1, label: "12" }], error: null };
      if (c.table === "users") return { data: [{ user_id: "k1", name: "Pass" }], error: null };
      return undefined;
    });
    const out = await new FloorBoardService(f.db).openFoodUps(owner, NOW);
    expect(out.foodUps).toEqual([
      {
        foodUpId: "fu1",
        tableId: T1,
        tableLabel: "12",
        course: "starters",
        note: "no onion",
        raisedAt: "2026-11-07T18:40:00Z",
        raisedBy: { userId: "k1", name: "Pass" },
        acknowledgedAt: "2026-11-07T18:55:00Z",
      },
    ]);
    const read = f.calls.find((c) => c.table === "floor_events")!;
    expect(read.filters).toEqual(expect.arrayContaining([["gte", "created_at", new Date(NOW - 6 * 3_600_000).toISOString()]]));
  });
});

describe("FloorService.clockState", () => {
  const punch = (row: Record<string, unknown> | null, extra: (c: Call) => Answer | undefined = () => undefined) =>
    fakeDb((c) => extra(c) ?? (c.table === "floor_punches" ? { data: row ? [row] : [], error: null } : undefined));
  const svcOf = (f: ReturnType<typeof fakeDb>) => new FloorService(f.db, {} as any, {} as any);

  it("is out with no punch, in with an open one, and out after a clock-out", async () => {
    expect((await svcOf(punch(null)).clockState(waiter)).state).toBe("out");
    expect(await svcOf(punch({ id: "p1", clocked_in_at: "t0", clocked_out_at: null, clocked_out_reason: null })).clockState(waiter)).toEqual({
      state: "in", punchId: "p1", since: "t0", coverUserId: null, coverName: null,
    });
    expect((await svcOf(punch({ id: "p1", clocked_in_at: "t0", clocked_out_at: "t1", clocked_out_reason: "clock_out" })).clockState(waiter)).state).toBe("out");
  });

  it("is on break with the cover named at the tap", async () => {
    const f = punch({ id: "p1", clocked_in_at: "t0", clocked_out_at: "t1", clocked_out_reason: "break" }, (c) => {
      if (c.table === "floor_events") return { data: [{ kind: "on_break", actor_id: "w1", meta: { cover_user_id: "w2" } }], error: null };
      if (c.table === "users") return { data: { name: "Deniz" }, error: null };
      return undefined;
    });
    expect(await svcOf(f).clockState(waiter)).toEqual({
      state: "on_break", punchId: "p1", since: "t1", coverUserId: "w2", coverName: "Deniz",
    });
    const read = f.calls.find((c) => c.table === "floor_punches")!;
    expect(read.filters).toEqual(expect.arrayContaining([["eq", "user_id", "w1"], ["eq", "restaurant_id", "r1"]]));
  });
});
