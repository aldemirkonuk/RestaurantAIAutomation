import { ForbiddenException, HttpException } from "@nestjs/common";
import { InventoryService } from "./inventory.service";

/**
 * F-145: a drink can be 86'd, and the stock-out is kept.
 *
 * A stock_outs row (20261231900000) is open while ended_at is null; the item
 * is sold out exactly then. These tests drive InventoryService against a fake
 * table that behaves like the partial unique index (one open row per item).
 * Built without the constructor, as stock-wrappers-refuse-foreign-items does.
 */

const HOUSE = "house-1";
const ITEM = "inv-moscofilero";

function serviceOver(opts: { owned?: boolean } = {}) {
  const owned = opts.owned ?? true;
  const rows: any[] = [];
  const writes: { op: string; row?: any; patch?: any }[] = [];
  let seq = 0;

  const client = {
    from(table: string) {
      const filters: Array<(r: any) => boolean> = [];
      let op: "select" | "insert" | "update" = "select";
      let payload: any = null;
      const c: any = {
        select: () => c,
        eq: (col: string, val: unknown) => {
          filters.push((r) => r[col] === val);
          return c;
        },
        is: (col: string, val: unknown) => {
          filters.push((r) => (r[col] ?? null) === val);
          return c;
        },
        order: () => c,
        limit: () => c,
        insert: (row: any) => {
          op = "insert";
          payload = row;
          return c;
        },
        update: (patch: any) => {
          op = "update";
          payload = patch;
          return c;
        },
        maybeSingle: async () => ({
          data: table === "restaurant_inventory" && owned ? { id: ITEM } : null,
          error: null,
        }),
        then: (res: any, rej: any) => {
          let result: any = { data: null, error: null };
          if (table === "stock_outs" && op === "insert") {
            writes.push({ op, row: payload });
            const open = rows.some(
              (r) =>
                r.inventory_id === payload.inventory_id && r.ended_at == null,
            );
            if (open) {
              result = {
                data: null,
                error: {
                  code: "23505",
                  message: "stock_outs_one_open_per_item",
                },
              };
            } else {
              seq += 1;
              rows.push({
                id: `so-${seq}`,
                started_at: `2026-09-0${seq}T17:30:00Z`,
                ended_at: null,
                ended_by: null,
                ...payload,
              });
            }
          } else if (table === "stock_outs" && op === "update") {
            writes.push({ op, patch: payload });
            for (const r of rows.filter((x) => filters.every((f) => f(x))))
              Object.assign(r, payload);
          } else if (table === "stock_outs") {
            result = {
              data: rows
                .filter((x) => filters.every((f) => f(x)))
                .sort((a, b) => (a.started_at < b.started_at ? 1 : -1)),
              error: null,
            };
          }
          return Promise.resolve(result).then(res, rej);
        },
      };
      return c;
    },
  };

  const svc = Object.create(InventoryService.prototype) as any;
  svc.dbService = { getClient: () => client };
  svc.logger = { error: () => {}, warn: () => {}, log: () => {} };
  return { svc: svc as InventoryService, rows, writes };
}

describe("a drink can be 86'd and the stock-out is kept (F-145)", () => {
  it("marks it sold out with why and who, and reads it back as open", async () => {
    const { svc, writes } = serviceOver();

    const state = await svc.startStockOut(
      HOUSE,
      ITEM,
      { cause: "ran_out", note: " glass list " },
      "user-kerem",
    );

    expect(writes).toEqual([
      {
        op: "insert",
        row: {
          restaurant_id: HOUSE,
          inventory_id: ITEM,
          cause: "ran_out",
          note: "glass list",
          started_by: "user-kerem",
        },
      },
    ]);
    expect(state.open).toMatchObject({
      cause: "ran_out",
      startedBy: "user-kerem",
      endedAt: null,
    });
  });

  it("answers a second tap with the stock-out already open, not a second one", async () => {
    const { svc, rows } = serviceOver();
    await svc.startStockOut(HOUSE, ITEM, { cause: "ran_out" }, "user-a");

    const state = await svc.startStockOut(
      HOUSE,
      ITEM,
      { cause: "broken" },
      "user-b",
    );

    expect(rows).toHaveLength(1);
    expect(state.open).toMatchObject({ cause: "ran_out", startedBy: "user-a" });
  });

  it("brings it back, keeping the stock-out in the record", async () => {
    const { svc } = serviceOver();
    await svc.startStockOut(HOUSE, ITEM, { cause: "broken" }, "user-a");

    const state = await svc.endStockOut(HOUSE, ITEM, "user-b");

    expect(state.open).toBeNull();
    expect(state.recent).toHaveLength(1);
    expect(state.recent[0]).toMatchObject({
      cause: "broken",
      endedBy: "user-b",
    });
    expect(state.recent[0].endedAt).not.toBeNull();
  });

  it("refuses a stock-out with no reason, and writes nothing", async () => {
    const { svc, writes } = serviceOver();
    await expect(
      svc.startStockOut(HOUSE, ITEM, { cause: "" }, "user-a"),
    ).rejects.toThrow(HttpException);
    await expect(
      svc.startStockOut(HOUSE, ITEM, { cause: "sold_well" }, "user-a"),
    ).rejects.toThrow(HttpException);
    expect(writes).toEqual([]);
  });

  it("refuses another house's item before it writes, and the control passes", async () => {
    const foreign = serviceOver({ owned: false });
    await expect(
      foreign.svc.startStockOut(HOUSE, ITEM, { cause: "ran_out" }, "user-a"),
    ).rejects.toThrow(ForbiddenException);
    await expect(
      foreign.svc.endStockOut(HOUSE, ITEM, "user-a"),
    ).rejects.toThrow(ForbiddenException);
    expect(foreign.writes).toEqual([]);

    const own = serviceOver();
    await own.svc.startStockOut(HOUSE, ITEM, { cause: "ran_out" }, "user-a");
    expect(own.writes).toHaveLength(1);
  });
});
