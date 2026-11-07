import "reflect-metadata";
import { FloorBoardService } from "./floor-board.service";
import type { FloorActor, FloorHouse } from "./floor-common";

/**
 * The manager's figures against floor-core's response-time API: the
 * caretaker's last tap ends a seating's open gap on the report (never on the
 * live board), *Not closed* is counted beside the caretaker, and waiters come
 * back in `sortByScore` order with no rank field.
 */
type Call = { table: string; filters: Array<[string, string, unknown]> };

function fakeDb(respond: (c: Call) => unknown[] | undefined) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const c: Call = { table, filters: [] };
    calls.push(c);
    const b: any = {};
    b.select = () => b;
    for (const f of ["eq", "neq", "is", "in", "gte", "lt", "lte", "gt", "order", "limit", "or"]) {
      b[f] = (col: string, val: unknown) => {
        c.filters.push([f, col, val]);
        return b;
      };
    }
    b.not = (col: string, op: string, val: unknown) => {
      c.filters.push(["not", `${col}.${op}`, val]);
      return b;
    };
    const done = (single: boolean) => {
      if (c.table === "restaurants") return Promise.resolve({ data: { name: "Tuzlu", timezone: "Europe/Istanbul" }, error: null });
      if (c.table === "floor_settings") return Promise.resolve({ data: { warn_after_min: 6, late_after_min: 10 }, error: null });
      const rows = respond(c) ?? [];
      return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null });
    };
    b.maybeSingle = () => done(true);
    b.single = () => done(true);
    b.then = (res: any, rej: any) => done(false).then(res, rej);
    return b;
  };
  return { calls, db: { supabase: { from } } as any };
}

const HOUSE: FloorHouse = { name: "Tuzlu", zone: "Europe/Istanbul", warnAfterMin: 6, lateAfterMin: 10 };
const T0 = Date.parse("2026-11-07T17:00:00.000Z");
const at = (min: number) => new Date(T0 + min * 60_000).toISOString();
const NOW = T0 + 120 * 60_000;
const manager: FloorActor = { userId: "m1", restaurantId: "r1", role: "manager" };

const seating = (id: string, table: string, caretaker: string | null, extra: Record<string, unknown> = {}) => ({
  id,
  table_id: table,
  seated_at: at(0),
  seated_by: caretaker,
  caretaker_at_seat_id: caretaker,
  party_size: 2,
  paid_at: null,
  paid_source: null,
  paid_undone_at: null,
  left_at: null,
  ...extra,
});
const visit = (seatingId: string, table: string, user: string, min: number) => ({
  seating_id: seatingId,
  table_id: table,
  user_id: user,
  visited_at: at(min),
});

describe("FloorBoardService.figures — the caretaker's last tap", () => {
  const svc = new FloorBoardService({ supabase: {} } as any);

  it("ends the open gap at the caretaker's last tap; the board (no taps) runs to now", () => {
    const seatings = [seating("s1", "t1", "w1")];
    const visits = [visit("s1", "t1", "w1", 5)];
    const live = svc.figures(seatings, visits, new Set(), HOUSE, NOW);
    const report = svc.figures(seatings, visits, new Set(), HOUSE, NOW, new Map([["w1", at(30)]]));
    // Greeting gap 5, then open gap 5 → now (115) or 5 → last tap (25).
    expect(live.waiters[0].avgGapMin).toBe(60);
    expect(report.waiters[0].avgGapMin).toBe(15);
  });

  it("counts Not closed beside the seating's caretaker, and keeps a row for it", () => {
    const seatings = [
      seating("s1", "t1", "w1"),
      seating("s2", "t2", "w2", { paid_at: at(40) }),
      seating("s3", "t3", null),
    ];
    // w2's only seating is closed; w1's is not; s3 has no caretaker.
    const visits = [visit("s1", "t1", "w1", 2), visit("s2", "t2", "w2", 3)];
    const { waiters, samples, notClosedUnassigned } = svc.figures(seatings, visits, new Set(), HOUSE, NOW);
    expect(samples.seatingsNotClosed.sort()).toEqual(["s1", "s3"]);
    expect(Object.fromEntries(waiters.map((w) => [w.userId, w.notClosed]))).toEqual({ w1: 1, w2: 0 });
    expect(notClosedUnassigned).toBe(1);
  });

  it("gives a caretaker with only unclosed, unvisited seatings a row", () => {
    // Seated 2 min before now: no gap passes T, so no sample; still Not closed.
    const seatings = [seating("s1", "t1", "w9", { seated_at: at(118) })];
    const { waiters } = svc.figures(seatings, [], new Set(), HOUSE, NOW);
    expect(waiters.map((w) => [w.userId, w.gaps, w.score, w.notClosed])).toEqual([["w9", 0, null, 1]]);
  });

  it("orders waiters by floor-core's sortByScore: best first, ties on id, no score last, no rank", () => {
    const seatings = [
      seating("sa", "ta", "wb"),
      seating("sb", "tb", "wa"),
      seating("sc", "tc", "wc"),
      seating("sd", "td", "wz", { seated_at: at(118) }),
    ];
    // wa and wb are both on time (score 100); wc is late once.
    const visits = [
      visit("sa", "ta", "wb", 2), visit("sa", "ta", "wb", 120),
      visit("sb", "tb", "wa", 2), visit("sb", "tb", "wa", 120),
      visit("sc", "tc", "wc", 30), visit("sc", "tc", "wc", 120),
    ];
    const tight = { ...HOUSE, warnAfterMin: 200 };
    const { waiters } = svc.figures(seatings, visits, new Set(), tight, NOW);
    expect(waiters.map((w) => w.userId)).toEqual(["wa", "wb", "wc", "wz"]);
    expect(waiters[0].score).toBe(waiters[1].score);
    expect(waiters[3].score).toBeNull();
    for (const w of waiters) expect(w).not.toHaveProperty("rank");
  });
});

describe("FloorBoardService.report — reads the last taps and sends Not closed", () => {
  function db() {
    return fakeDb((c) => {
      if (c.table === "restaurant_tables") {
        return [
          { id: "t1", label: "1", seats: 2, hidden_at: null },
          { id: "t2", label: "2", seats: 2, hidden_at: null },
        ];
      }
      if (c.table === "floor_seatings") return [seating("s1", "t1", "w1"), seating("s2", "t2", "w2", { left_at: at(50) })];
      if (c.table === "floor_visits" && c.filters.some(([f, col]) => f === "in" && col === "seating_id")) {
        return [visit("s1", "t1", "w1", 5), visit("s2", "t2", "w2", 4)];
      }
      // Last taps: w1 checked in on another house table at +20, then tapped Paid elsewhere at +30.
      if (c.table === "floor_visits") return [{ user_id: "w1", visited_at: at(20) }, { user_id: "w1", visited_at: at(10) }];
      if (c.table === "floor_events") return [{ actor_id: "w1", created_at: at(30) }];
      if (c.table === "users") return [{ user_id: "w1", name: "Ayla" }, { user_id: "w2", name: "Deniz" }];
      return undefined;
    });
  }

  it("ends w1's open gap at the last tap across visits and table events, within the day", async () => {
    const f = db();
    const r = await new FloorBoardService(f.db).report(manager, "2026-11-07", NOW);
    const w1 = r.waiters.find((w) => w.userId === "w1")!;
    // Greeting 5 + open 5 → 30 (25): avg 15. Without the tap it would be 60.
    expect(w1.avgGapMin).toBe(15);
    expect(w1.notClosed).toBe(1);
    expect(r.waiters.find((w) => w.userId === "w2")!.notClosed).toBe(0);
    expect(r.notClosed).toEqual({ total: 1, unassigned: 0 });
    for (const w of r.waiters) expect(w).not.toHaveProperty("rank");

    const taps = f.calls.filter((c) => c.table !== "users" && c.filters.some(([fl, col]) => fl === "in" && (col === "user_id" || col === "actor_id")));
    expect(taps.map((c) => c.table).sort()).toEqual(["floor_events", "floor_visits"]);
    const ev = taps.find((c) => c.table === "floor_events")!;
    expect(ev.filters).toContainEqual(["not", "table_id.is", null]);
    expect(ev.filters).toContainEqual(["in", "actor_id", ["w1", "w2"]]);
    expect(ev.filters).toContainEqual(["lt", "created_at", new Date(NOW).toISOString()]);
    const vi = taps.find((c) => c.table === "floor_visits")!;
    expect(vi.filters).toContainEqual(["is", "struck_at", null]);
  });

  it("puts Not closed in the waiters CSV", async () => {
    const { body } = await new FloorBoardService(db().db).csv(manager, "2026-11-07", "waiters", NOW);
    const [head, ...rows] = body.trim().split("\n");
    expect(head).toBe("waiter,user_id,score,band,on_time_pct,avg_gap_min,gaps,overdue_gaps,not_closed");
    const col = (line: string) => Object.fromEntries(head.split(",").map((k, i) => [k, line.split(",")[i]]));
    expect(col(rows.find((l) => l.startsWith("Ayla,"))!)).toMatchObject({ overdue_gaps: "1", not_closed: "1" });
    expect(col(rows.find((l) => l.startsWith("Deniz,"))!)).toMatchObject({ not_closed: "0" });
  });
});

describe("FloorBoardService.board — live figures", () => {
  it("reads no last taps and lists waiters in sortByScore order, holders included", async () => {
    const f = fakeDb((c) => {
      if (c.table === "restaurant_tables") {
        return [
          { id: "t1", label: "1", seats: 2, hidden_at: null },
          { id: "t2", label: "2", seats: 2, hidden_at: null },
          { id: "t3", label: "3", seats: 2, hidden_at: null },
        ];
      }
      if (c.table === "floor_sections") return [{ id: "sec" }];
      if (c.table === "floor_section_tables") return [{ table_id: "t3", section_id: "sec" }];
      // wa holds t3 and has no figures; wz has a seating too new to sample.
      if (c.table === "floor_assignments") return [{ user_id: "wa", table_id: "t3", section_id: null, service_date: "2026-11-07" }];
      if (c.table === "floor_seatings") {
        return [
          seating("s1", "t1", "wm", { seated_at: at(100) }),
          seating("s2", "t2", "wz", { seated_at: at(118) }),
          seating("s3", "t3", "wq", { seated_at: at(118) }),
        ];
      }
      if (c.table === "floor_visits") return [visit("s1", "t1", "wm", 102), visit("s1", "t1", "wm", 104)];
      return undefined;
    });
    const b = await new FloorBoardService(f.db).board(manager, NOW);
    expect(b.waiters.map((w) => w.userId)).toEqual(["wm", "wa", "wq", "wz"]);
    for (const w of b.waiters) expect(w).not.toHaveProperty("rank");
    expect(f.calls.some((c) => c.table === "floor_events")).toBe(false);
    expect(f.calls.some((c) => c.filters.some(([, col]) => col === "user_id" && c.table === "floor_visits"))).toBe(false);
  });
});
