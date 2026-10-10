import { ProcurementService } from "./procurement.service";

/**
 * F-351 — the in-transit counter moves by a delta, never by a figure read
 * earlier and written back.
 *
 * Approval's reserve and the cancel/close release each read
 * `in_transit_quantity`, did the sum here, and wrote the result. An approval
 * and another order's release on the same item at once both read the old
 * figure; the second write erased the first. Both now call
 * `move_in_transit_by_delta` (migration in_transit_moves_by_delta), which is
 * one UPDATE ... SET x = x + d. The SQL is proven in
 * supabase/tests/20261231400000_in_transit_moves_by_delta_test.sql.
 */
type Row = Record<string, any>;

const HOUSE = "house-1";
const ITEM = "inv-1";

function harness() {
  const rpc: Array<{ name: string; args: Row }> = [];
  const inventoryWrites: Row[] = [];
  const supabase: any = {
    from(table: string) {
      const q: any = {
        select: () => q,
        eq: () => q,
        update: (p: Row) => {
          if (table === "restaurant_inventory") inventoryWrites.push(p);
          return q;
        },
        single: async () => ({ data: { shadow_stock: 6, in_transit_quantity: 6 }, error: null }),
        maybeSingle: async () => ({ data: { shadow_stock: 6, in_transit_quantity: 6 }, error: null }),
        then: (res: any, rej: any) =>
          Promise.resolve({ data: null, error: null }).then(res, rej),
      };
      return q;
    },
    rpc: async (name: string, args: Row) => {
      rpc.push({ name, args });
      return { data: null, error: null };
    },
  };
  const svc = new ProcurementService(
    { supabase, getClient: () => supabase } as any,
    { createEvent: jest.fn() } as any,
    { recordTransaction: jest.fn() } as any,
  ) as any;
  for (const level of ["log", "warn", "error"])
    jest.spyOn(svc.logger, level).mockImplementation(() => {});
  return { svc, rpc, inventoryWrites };
}

describe("in-transit moves by a delta (F-351)", () => {
  it("an approval's reserve adds the quantity in one call and writes no absolute figure", async () => {
    const h = harness();
    await h.svc.reserveOrderShadowStock(HOUSE, ITEM, 4);
    expect(h.rpc.filter((c) => c.name === "move_in_transit_by_delta")).toEqual([
      { name: "move_in_transit_by_delta", args: { p_restaurant_id: HOUSE, p_inventory_id: ITEM, p_delta: 4 } },
    ]);
    expect(h.inventoryWrites.filter((w) => "in_transit_quantity" in w)).toEqual([]);
  });

  it("a release takes the quantity off in one call and writes no absolute figure", async () => {
    const h = harness();
    await h.svc.releaseOrderShadowStock(HOUSE, ITEM, 6);
    expect(h.rpc.filter((c) => c.name === "move_in_transit_by_delta")).toEqual([
      { name: "move_in_transit_by_delta", args: { p_restaurant_id: HOUSE, p_inventory_id: ITEM, p_delta: -6 } },
    ]);
    expect(h.inventoryWrites.filter((w) => "in_transit_quantity" in w)).toEqual([]);
  });
});
