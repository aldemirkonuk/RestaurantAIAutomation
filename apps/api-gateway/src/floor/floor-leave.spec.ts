import "reflect-metadata";
import { FloorService } from "./floor.service";
import type { FloorActor } from "./floor-common";

/**
 * Leave is classified on the server (stored seat time, server clock). A
 * scripted PostgREST stand-in answers reads and records writes.
 */
type Call = { table: string; op: string; payload?: any; terminal?: string };

function fakeDb(seatedAt: string, visits: string[] = []) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const c: Call = { table, op: "select" };
    calls.push(c);
    const b: any = {};
    for (const op of ["insert", "update"]) b[op] = (payload?: any) => ((c.op = op), (c.payload = payload), b);
    for (const f of ["select", "eq", "is", "in"]) b[f] = () => b;
    const answer = () => {
      if (table === "floor_seatings" && c.op === "select") {
        return { data: { id: "s1", table_id: "t1", seated_at: seatedAt, seated_by: "w1", caretaker_at_seat_id: "w1", party_size: 2, paid_at: null, paid_undone_at: null, left_at: null }, error: null };
      }
      if (table === "floor_visits") return { data: visits.map((v) => ({ seating_id: "s1", visited_at: v })), error: null };
      if (table === "floor_seatings" && c.op === "update") return { data: [{ id: "s1" }], error: null };
      if (table === "restaurant_tables") return { data: { id: "t1", label: "12", seats: 4, hidden_at: null }, error: null };
      if (table === "restaurants") return { data: { name: "Tuzlu", timezone: "Europe/Istanbul" }, error: null };
      if (table === "floor_events" && c.op === "insert") return { data: { id: "e1" }, error: null };
      return { data: c.terminal ? null : [], error: null };
    };
    b.maybeSingle = () => ((c.terminal = "maybeSingle"), Promise.resolve(answer()));
    b.single = () => ((c.terminal = "single"), Promise.resolve(answer()));
    b.then = (res: any, rej: any) => Promise.resolve(answer()).then(res, rej);
    return b;
  };
  return { calls, db: { supabase: { from } } as any };
}

const NOW = Date.parse("2026-11-07T19:00:00Z");
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const staff: FloorActor = { userId: "w1", restaurantId: "r1", role: "staff" };
const svc = (db: any) =>
  new FloorService(db, { emitFloorWord: jest.fn() } as any, { sendWebPushReported: jest.fn().mockResolvedValue({ found: 0, sent: 0, pruned: 0, reason: "no_device" }) } as any);
const leftMeta = (calls: Call[]) => calls.find((c) => c.table === "floor_events" && c.op === "insert")?.payload.meta;

describe("Leave: the kind is the server's", () => {
  it("asks first on a short stay, then records a confirmed one as a quick leave", async () => {
    const f = fakeDb(ago(5));
    await expect(svc(f.db).leave(staff, "s1", false, NOW)).rejects.toMatchObject({ response: { code: "CONFIRM_SHORT_VISIT" } });
    const out = await svc(f.db).leave(staff, "s1", true, NOW);
    expect(out.quickLeave).toBe(true);
    expect(leftMeta(f.calls)).toEqual({ visit_kind: "quick_leave" });
  });

  it("allows a confirm opened under 12 minutes and tapped just after", async () => {
    const f = fakeDb(ago(13));
    expect((await svc(f.db).leave(staff, "s1", true, NOW)).quickLeave).toBe(true);
  });

  it("ignores, and notes, a confirm the rule would not have offered", async () => {
    const f = fakeDb(ago(15));
    expect((await svc(f.db).leave(staff, "s1", true, NOW)).quickLeave).toBe(false);
    expect(leftMeta(f.calls)).toEqual({ confirm_ignored: true });
  });

  it("does not take the client's word over two honor check-ins", async () => {
    const f = fakeDb(ago(5), [ago(4), ago(2)]);
    expect((await svc(f.db).leave(staff, "s1", true, NOW)).quickLeave).toBe(false);
  });

  it("records a leave whose seat time could not be read as skipping the confirm", async () => {
    const f = fakeDb("not a time");
    expect((await svc(f.db).leave(staff, "s1", false, NOW)).quickLeave).toBe(false);
    expect(leftMeta(f.calls)).toEqual({ confirm_skipped: "unreadable_seat_time" });
  });

  it("leaves a long stay unmarked", async () => {
    const f = fakeDb(ago(40));
    await svc(f.db).leave(staff, "s1", false, NOW);
    expect(leftMeta(f.calls)).toEqual({});
  });
});

