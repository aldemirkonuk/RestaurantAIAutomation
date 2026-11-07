import "reflect-metadata";
import { ConflictException, ForbiddenException } from "@nestjs/common";
import { FloorService } from "./floor.service";
import { FloorNudgeScanner, foodUpKey, lateKey, tickOf } from "./floor-nudge.scanner";
import { staffCopy } from "./floor-push";
import type { FloorActor } from "./floor-common";

/**
 * A scripted PostgREST stand-in. Every call is recorded as
 * { table, op, payload, filters, terminal }; `respond` answers it.
 */
type Call = { table: string; op: string; payload?: any; filters: Array<[string, string, unknown]>; terminal?: string };
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
    for (const f of ["eq", "neq", "is", "in", "gte", "lt", "lte", "gt", "order", "limit"]) {
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
  return { calls, db: { supabase: { from } } as any };
}

const HOUSE = { name: "Tuzlu", timezone: "Europe/Istanbul", country: "TR" };
const staff: FloorActor = { userId: "w1", restaurantId: "r1", role: "staff" };
const NOW = Date.parse("2026-11-07T19:00:00Z");

function baseRespond(extra: (c: Call) => Answer | undefined) {
  return (c: Call): Answer | undefined => {
    const hit = extra(c);
    if (hit) return hit;
    if (c.table === "restaurants") return { data: HOUSE, error: null };
    if (c.table === "floor_settings") return { data: { warn_after_min: 6, late_after_min: 10 }, error: null };
    if (c.table === "restaurant_tables" && c.terminal === "maybeSingle") {
      return { data: { id: "t1", label: "12", seats: 4, hidden_at: null }, error: null };
    }
    return undefined;
  };
}

const ws = () => ({ emitFloorWord: jest.fn() });
const notif = () => ({ sendWebPushReported: jest.fn().mockResolvedValue({ found: 1, sent: 1, pruned: 0, reason: null }) });

describe("FloorService.seat", () => {
  it("writes party_size NULL when nobody said (E9) and the tapper as caretaker when they hold the table", async () => {
    const { calls, db } = fakeDb(
      baseRespond((c) => {
        if (c.table === "floor_assignments") return { data: [{ user_id: "w1", table_id: "t1", section_id: null, service_date: "2026-11-07" }], error: null };
        if (c.table === "floor_seatings" && c.op === "insert") return { data: { id: "s1", seated_at: "x" }, error: null };
        return undefined;
      }),
    );
    const svc = new FloorService(db, ws() as any, notif() as any);
    const out = await svc.seat(staff, "t1", null, NOW);
    const ins = calls.find((c) => c.table === "floor_seatings" && c.op === "insert")!;
    expect(ins.payload.party_size).toBeNull();
    expect(ins.payload.caretaker_at_seat_id).toBe("w1");
    expect(out).toEqual({ seatingId: "s1", tableId: "t1", partySize: null });
  });

  it("guesses nobody as caretaker when several section holders exclude the tapper", async () => {
    const { calls, db } = fakeDb(
      baseRespond((c) => {
        if (c.table === "floor_assignments") {
          return {
            data: [
              { user_id: "a", table_id: null, section_id: "sec", service_date: "2026-11-07" },
              { user_id: "b", table_id: null, section_id: "sec", service_date: "2026-11-07" },
            ],
            error: null,
          };
        }
        if (c.table === "floor_section_tables") return { data: [{ table_id: "t1", section_id: "sec" }], error: null };
        if (c.table === "floor_sections") return { data: [{ id: "sec" }], error: null };
        if (c.table === "floor_seatings" && c.op === "insert") return { data: { id: "s1", seated_at: "x" }, error: null };
        return undefined;
      }),
    );
    await new FloorService(db, ws() as any, notif() as any).seat(staff, "t1", 3, NOW);
    const ins = calls.find((c) => c.table === "floor_seatings" && c.op === "insert")!;
    expect(ins.payload.caretaker_at_seat_id).toBeNull();
    expect(ins.payload.party_size).toBe(3);
  });

  it("answers 409 when the table already has an open seating", async () => {
    const { db } = fakeDb(
      baseRespond((c) => (c.table === "floor_seatings" && c.op === "insert" ? { data: null, error: { code: "23505" } } : undefined)),
    );
    await expect(new FloorService(db, ws() as any, notif() as any).seat(staff, "t1", null, NOW)).rejects.toBeInstanceOf(ConflictException);
  });
});

const openRow = (over: Record<string, unknown> = {}) => ({
  id: "s1", table_id: "t1", seated_at: "2026-11-07T18:58:00Z", seated_by: "w1", caretaker_at_seat_id: "w1",
  party_size: null, paid_at: null, paid_undone_at: null, left_at: null, ...over,
});

describe("Paid and its undo (ADR 0353)", () => {
  it("Paid is a tap, idempotent, and never ends the seating", async () => {
    const { calls, db } = fakeDb((c) => {
      if (c.table === "floor_seatings" && c.terminal === "maybeSingle") return { data: openRow(), error: null };
      if (c.table === "floor_seatings" && c.op === "update") return { data: [{ id: "s1" }], error: null };
      return undefined;
    });
    const out = await new FloorService(db, ws() as any, notif() as any).paid(staff, "s1");
    const up = calls.find((c) => c.op === "update")!;
    expect(up.payload).toEqual(expect.objectContaining({ paid_by: "w1", paid_source: "tap" }));
    expect(up.payload).not.toHaveProperty("left_at");
    expect(out.already).toBe(false);
  });

  it("a staff member who neither holds nor covers the table cannot undo Paid", async () => {
    const { db } = fakeDb(
      baseRespond((c) => {
        if (c.table === "floor_seatings" && c.terminal === "maybeSingle") return { data: openRow({ paid_at: "2026-11-07T18:59:00Z" }), error: null };
        if (c.table === "floor_assignments") return { data: [{ user_id: "other", table_id: "t1", section_id: null, service_date: "2026-11-07" }], error: null };
        return undefined;
      }),
    );
    await expect(new FloorService(db, ws() as any, notif() as any).undoPaid(staff, "s1", NOW)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it("the table's waiter can undo Paid; the late clock restarts from the undo", async () => {
    const { calls, db } = fakeDb(
      baseRespond((c) => {
        if (c.table === "floor_seatings" && c.terminal === "maybeSingle") return { data: openRow({ paid_at: "2026-11-07T18:59:00Z" }), error: null };
        if (c.table === "floor_assignments") return { data: [{ user_id: "w1", table_id: "t1", section_id: null, service_date: "2026-11-07" }], error: null };
        return undefined;
      }),
    );
    await new FloorService(db, ws() as any, notif() as any).undoPaid(staff, "s1", NOW);
    const up = calls.find((c) => c.table === "floor_seatings" && c.op === "update")!;
    expect(up.payload).toEqual(expect.objectContaining({ paid_at: null, paid_undone_at: new Date(NOW).toISOString(), paid_undone_by: "w1" }));
    expect(FloorService.lastVisitAnchor("2026-11-07T18:00:00Z", "2026-11-07T18:30:00Z")).toBe("2026-11-07T18:30:00Z");
  });
});

describe("Leave", () => {
  it("asks for confirmation on a very short stay with no visit", async () => {
    const { db } = fakeDb((c) => (c.table === "floor_seatings" && c.terminal === "maybeSingle" ? { data: openRow(), error: null } : undefined));
    const svc = new FloorService(db, ws() as any, notif() as any);
    await expect(svc.leave(staff, "s1", false, NOW)).rejects.toMatchObject({ response: { code: "CONFIRM_SHORT_VISIT" } });
  });
});

describe("Food up push copy (ADR 0352)", () => {
  it("carries the house, the table and the word only: no minutes, names or notes", async () => {
    const n = notif();
    const { db } = fakeDb(
      baseRespond((c) => {
        if (c.table === "floor_events" && c.op === "insert") return { data: { id: "e1" }, error: null };
        if (c.table === "floor_assignments") return { data: [{ user_id: "w2", table_id: "t1", section_id: null, service_date: "2026-11-07" }], error: null };
        return undefined;
      }),
    );
    const out = await new FloorService(db, ws() as any, n as any).foodUp(staff, "t1", "mains", "no onions, Ayşe's table", NOW);
    expect(out.pushed).toEqual({ sentTo: 1, notSent: 0, reason: null });
    const [userId, payload, opts] = n.sendWebPushReported.mock.calls[0];
    expect(userId).toBe("w2");
    expect(payload.title).toBe("Tuzlu");
    expect(payload.body).toBe("Table 12 · Food up");
    expect(JSON.stringify(payload)).not.toMatch(/onion|Ayşe|min/i);
    expect(payload.data).toEqual({ url: "/floor/me", restaurant_id: "r1", table_id: "t1" });
    expect(opts).toEqual({ ttlSeconds: 600, urgency: "high", timeoutMs: 10_000 });
  });

  it("goes to the named cover, not the holder, while the holder is on break", async () => {
    const n = notif();
    const { db } = fakeDb(
      baseRespond((c) => {
        if (c.table === "floor_events" && c.op === "insert") return { data: { id: "e1" }, error: null };
        if (c.table === "floor_events") return { data: [{ kind: "on_break", actor_id: "w2", meta: { cover_user_id: "w3" } }], error: null };
        if (c.table === "floor_assignments") return { data: [{ user_id: "w2", table_id: "t1", section_id: null, service_date: "2026-11-07" }], error: null };
        return undefined;
      }),
    );
    await new FloorService(db, ws() as any, n as any).foodUp(staff, "t1", undefined, undefined, NOW);
    expect(n.sendWebPushReported.mock.calls.map((c: any[]) => c[0])).toEqual(["w3"]);
  });

  it("staffCopy never carries a manager detail", () => {
    const p = staffCopy({ restaurantId: "r", houseName: "H", tableId: "t", tableLabel: "4", word: "Late", lateAfterMin: 10, managerDetail: "Ali, 23 min" });
    expect(JSON.stringify(p)).not.toMatch(/Ali|23/);
  });
});

describe("nudge scanner (E3)", () => {
  it("keys: the late window is 15 minutes per anchor; Food up per threshold", () => {
    expect(lateKey("s", "A", 0)).toBe("late:s:A:0");
    expect(lateKey("s", "A", 14.9)).toBe("late:s:A:0");
    expect(lateKey("s", "A", 15)).toBe("late:s:A:1");
    expect(lateKey("s", "B", 15)).toBe("late:s:B:1");
    expect(foodUpKey("e", 6)).toBe("food_up:e:6");
    expect(tickOf(Date.parse("2026-11-07T19:00:42.123Z"))).toBe("2026-11-07T19:00:00.000Z");
  });

  it("a replica that loses the minute's lock scans nothing", async () => {
    const { calls, db } = fakeDb((c) => (c.table === "floor_nudge_ticks" && c.op === "insert" ? { data: null, error: { code: "23505" } } : undefined));
    const out = await new FloorNudgeScanner(db, notif() as any, {} as any).tick(NOW);
    expect(out).toBeNull();
    expect(calls.map((c) => c.table)).toEqual(["floor_nudge_ticks"]);
  });

  it("reads only switched-on houses and skips a house with no zone", async () => {
    const { calls, db } = fakeDb((c) => {
      if (c.table === "restaurant_feature_flags") return { data: [{ restaurant_id: "r1" }], error: null };
      if (c.table === "restaurants") return { data: { name: "H", timezone: null, country: null }, error: null };
      return undefined;
    });
    const out = await new FloorNudgeScanner(db, notif() as any, {} as any).tick(NOW);
    expect(out).toEqual({ houses: 0, claimed: 0 });
    const flagRead = calls.find((c) => c.table === "restaurant_feature_flags")!;
    expect(flagRead.filters).toContainEqual(["eq", "floor_checker", true]);
    expect(calls.some((c) => c.table === "floor_seatings")).toBe(false);
  });

  it("a send already claimed is not sent again", async () => {
    const n = notif();
    const { db } = fakeDb((c) => (c.table === "floor_nudge_sends" && c.op === "insert" ? { data: null, error: { code: "23505" } } : undefined));
    const s = new FloorNudgeScanner(db, n as any, {} as any);
    const claimed = await s.deliver("r1", "late:s:A:0", "late", "s", ["w1"], {
      restaurantId: "r1", houseName: "H", tableId: "t1", tableLabel: "4", word: "Late", lateAfterMin: 10,
    });
    expect(claimed).toBe(0);
    expect(n.sendWebPushReported).not.toHaveBeenCalled();
  });

  it("nobody holds the table: the manager copy goes to owners and managers", async () => {
    const n = notif();
    const { calls, db } = fakeDb((c) => {
      if (c.table === "user_restaurant_access") return { data: [{ user_id: "m1", role: "manager", is_active: true, valid_from: null, valid_until: null }], error: null };
      if (c.table === "floor_nudge_sends" && c.op === "insert") return { data: { id: "claim1" }, error: null };
      return undefined;
    });
    const s = new FloorNudgeScanner(db, n as any, {} as any);
    await s.deliver("r1", "late:s:A:0", "late", "s", [], {
      restaurantId: "r1", houseName: "H", tableId: "t1", tableLabel: "4", word: "Late", lateAfterMin: 10,
    });
    expect(n.sendWebPushReported.mock.calls.map((c: any[]) => c[0])).toEqual(["m1"]);
    expect(calls.find((c) => c.table === "floor_nudge_sends" && c.op === "insert")!.payload.kind).toBe("manager_step");
  });
});
