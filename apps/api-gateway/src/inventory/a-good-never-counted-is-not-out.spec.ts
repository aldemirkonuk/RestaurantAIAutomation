import { InventoryService } from "./inventory.service";

/**
 * Inventory r36, gap 1. `stock_live` defaults to 0, so a title read in from a
 * menu scan read "Out" on day 1. The list now says, per good, whether it is a
 * 0 that nothing ever moved (`neverMoved`), from one read of
 * `inventory_never_moved`. A failed read says nothing (null), never "none".
 */
function service(rpc: (name: string, args: unknown) => Promise<{ data: unknown; error: unknown }>) {
  const empty = { data: [], error: null };
  const chain: any = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    then: (resolve: (v: unknown) => unknown) => resolve(empty),
    rpc: jest.fn(rpc),
  };
  const db: any = {
    getClient: () => chain,
    getRestaurantInventory: async () => [
      { id: "fresh", stock_live: 0 },
      { id: "sold-out", stock_live: 0 },
      { id: "on-shelf", stock_live: 4 },
    ],
  };
  return { svc: new InventoryService(db), chain };
}

describe("GET inventory list — a good never counted is told apart from one that is out", () => {
  it("marks the goods the read names, and only those, and passes the house", async () => {
    const { svc, chain } = service(async () => ({ data: ["fresh"], error: null }));
    const rows = await svc.getRestaurantInventory("rest-1");
    expect(rows.map((r: any) => [r.id, r.neverMoved])).toEqual([
      ["fresh", true],
      ["sold-out", false],
      ["on-shelf", false],
    ]);
    expect(chain.rpc).toHaveBeenCalledWith("inventory_never_moved", { p_restaurant_id: "rest-1" });
  });

  it("an empty answer is a real 'none': every good has been counted or moved", async () => {
    const { svc } = service(async () => ({ data: [], error: null }));
    const rows = await svc.getRestaurantInventory("rest-1");
    expect(rows.every((r: any) => r.neverMoved === false)).toBe(true);
  });

  it.each([
    ["an error", async () => ({ data: null, error: { message: "boom" } })],
    // an error is a failed read even when a list came with it
    ["an error beside a list", async () => ({ data: [], error: { message: "boom" } })],
    ["an answer that is not a list", async () => ({ data: { fresh: true }, error: null })],
    ["a throw", async () => Promise.reject(new Error("network"))],
  ])("%s says nothing about any good (null), never false", async (_label, rpc) => {
    const { svc } = service(rpc as any);
    const rows = await svc.getRestaurantInventory("rest-1");
    expect(rows).toHaveLength(3);
    expect(rows.every((r: any) => r.neverMoved === null)).toBe(true);
  });
});
