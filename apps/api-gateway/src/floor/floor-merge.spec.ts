import "reflect-metadata";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import { readHolders } from "./floor-holders";
import { FloorTablesService } from "./floor-tables.service";
import { MergeDto } from "./floor.dto";
import type { FloorActor } from "./floor-common";

jest.mock("./floor-holders", () => ({ readHolders: jest.fn() }));

const T1 = "aaaaaaaa-1111-4111-8111-11111111111a";
const T2 = "bbbbbbbb-2222-4222-8222-22222222222b";
const NOW = Date.parse("2026-11-07T19:00:00Z");
const manager: FloorActor = { userId: "m1", restaurantId: "r1", role: "manager" };
const waiter: FloorActor = { userId: "w1", restaurantId: "r1", role: "staff" };

function setup(pos: Array<[unknown, unknown]>) {
  const inserted: Record<string, unknown[]> = {};
  const from = (table: string) => {
    const b: any = {};
    let mode = "select";
    for (const f of ["select", "eq", "is", "in", "delete"]) b[f] = () => b;
    b.insert = (rows: unknown) => {
      mode = "insert";
      inserted[table] = Array.isArray(rows) ? rows : [rows];
      return b;
    };
    const answer = () => {
      if (table === "restaurants") return { data: { timezone: "Europe/Istanbul" }, error: null };
      if (table === "restaurant_tables") {
        return {
          data: [T2, T1].map((id, i) => ({ id, label: String(i), seats: 2, x_pos: pos[i][0], y_pos: pos[i][1], hidden_at: null })),
          error: null,
        };
      }
      if (table === "floor_seatings") return { data: [{ id: "s1", table_id: T1 }], error: null };
      if (table === "floor_table_merges" && mode === "insert") return { data: { id: "mg1" }, error: null };
      return { data: [], error: null };
    };
    b.single = () => Promise.resolve(answer());
    b.maybeSingle = () => Promise.resolve(answer());
    b.then = (res: any, rej: any) => Promise.resolve(answer()).then(res, rej);
    return b;
  };
  (readHolders as jest.Mock).mockResolvedValue({
    byTable: new Map([[T1, ["w1"]]]),
    sectionOf: new Map([[T1, "secA"], [T2, "secA"]]),
    sectionsOf: new Map(),
  });
  const floor = { event: jest.fn(), word: jest.fn() };
  const svc = new FloorTablesService({ supabase: { from } } as any, floor as any, {} as any, {} as any);
  return { svc, floor, inserted };
}

describe("FloorTablesService.merge", () => {
  it("groups the database's ids: a request id in another case or repeated is one table", async () => {
    const { svc, floor, inserted } = setup([["10.00", "0.00"], ["0.00", "0.00"]]);
    const out = await svc.merge(manager, [T1.toUpperCase(), T1, T2.toUpperCase()], NOW);
    expect(out.tableIds).toEqual([T1, T2]);
    expect((inserted.floor_table_merge_members as Array<{ table_id: string }>).map((m) => m.table_id)).toEqual([T1, T2]);
    expect(floor.event.mock.calls[0][2]).toEqual({ tableId: T1, meta: { merge_id: "mg1", table_ids: [T1, T2] } });
  });

  it("reads numeric(8,2) positions, which arrive as text, before adjacency", async () => {
    const { svc } = setup([["10.00", "0.00"], ["0.00", "0.00"]]);
    await expect(svc.merge(waiter, [T1, T2], NOW)).resolves.toMatchObject({ mergeId: "mg1", orientation: "horizontal" });
  });

  it("an unreadable position is no position: the waiter's tables are not neighbours", async () => {
    const { svc } = setup([["abc", "0.00"], ["0.00", "0.00"]]);
    await expect(svc.merge(waiter, [T1, T2], NOW)).rejects.toMatchObject({ response: { code: "MERGE_NOT_ADJACENT" } });
  });
});

describe("MergeDto (2 to 8 tables, the executor's reading under OD-242)", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `${String(i + 1).padStart(8, "0")}-1111-4111-8111-111111111111`);
  const errors = (n: number) => validate(plainToInstance(MergeDto, { tableIds: ids(n) })).then((e) => e.length);
  it("takes 2 and 8, refuses 1 and 9", async () => {
    expect(await errors(2)).toBe(0);
    expect(await errors(8)).toBe(0);
    expect(await errors(1)).toBeGreaterThan(0);
    expect(await errors(9)).toBeGreaterThan(0);
  });
});
