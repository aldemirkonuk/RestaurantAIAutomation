/**
 * F-1371: two managers on one goal. An Edit or Archive from a tab opened
 * before the other manager closed the goal used to rewrite the closed goal.
 * The edit now only touches a running goal, the status change carries the
 * status the page showed, and both refuse with a 409 that says what happened.
 */
import { ConflictException } from "@nestjs/common";
import { GoalsService } from "./goals.service";
import type { DatabaseService } from "../database/database.service";

type Row = Record<string, unknown>;

/** Just enough of the PostgREST chain for one table: filters, update, read. */
function makeDb(rows: Row[]) {
  const writes: Row[] = [];
  const client = {
    from: () => {
      const filters: Array<[string, unknown]> = [];
      let patch: Row | null = null;
      const matched = () =>
        rows.filter((r) => filters.every(([k, v]) => r[k] === v));
      const chain: any = {
        select: () => chain,
        update: (p: Row) => {
          patch = p;
          return chain;
        },
        eq: (k: string, v: unknown) => {
          filters.push([k, v]);
          return chain;
        },
        maybeSingle: async () => {
          const hit = matched()[0] ?? null;
          if (hit && patch) {
            Object.assign(hit, patch);
            writes.push(patch);
          }
          return { data: hit, error: null };
        },
      };
      return chain;
    },
  };
  const db = { getClient: () => client } as unknown as DatabaseService;
  return { db, writes };
}

function service(rows: Row[]) {
  const { db, writes } = makeDb(rows);
  const s = new GoalsService(
    db,
    {} as never,
    { get: () => undefined } as never,
    {} as never,
    {} as never,
    {} as never,
  );
  return { s, writes };
}

const goal = (status: string): Row => ({
  id: "g1",
  restaurant_id: "r1",
  name: "Lift wine revenue",
  metric_key: "wine_revenue",
  target_value: 9000,
  deadline: "2026-12-31",
  status,
});

describe("a goal closed by someone else (F-1371)", () => {
  it("refuses an edit to a goal archived since the form opened, and writes nothing", async () => {
    const { s, writes } = service([goal("archived")]);
    const edit = s.updateGoal("r1", "g1", { deadline: "2026-11-30" });
    await expect(edit).rejects.toBeInstanceOf(ConflictException);
    await expect(
      s.updateGoal("r1", "g1", { deadline: "2026-11-30" }),
    ).rejects.toThrow(/archived by someone else after you opened it/);
    expect(writes).toEqual([]);
  });

  it("still takes an edit to a running goal", async () => {
    const { s, writes } = service([goal("active")]);
    const kept = await s.updateGoal("r1", "g1", { deadline: "2026-11-30" });
    expect(kept).toMatchObject({ deadline: "2026-11-30" });
    expect(writes).toHaveLength(1);
  });

  it("refuses an Archive when the goal is no longer what the page showed", async () => {
    const { s, writes } = service([goal("achieved")]);
    await expect(
      s.updateGoalStatus("r1", "g1", "archived", "active"),
    ).rejects.toThrow(/marked achieved by someone else/);
    expect(writes).toEqual([]);
  });

  it("archives when the goal is as the page showed it", async () => {
    const { s } = service([goal("active")]);
    const kept = await s.updateGoalStatus("r1", "g1", "archived", "active");
    expect(kept).toMatchObject({ status: "archived" });
  });

  it("names a missing goal as missing, not as closed", async () => {
    const { s } = service([]);
    await expect(s.updateGoal("r1", "g1", { name: "x" })).rejects.toThrow(
      /No goal with that id/,
    );
  });
});
