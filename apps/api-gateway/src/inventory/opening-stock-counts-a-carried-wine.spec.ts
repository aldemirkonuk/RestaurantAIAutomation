import { InventoryService } from "./inventory.service";

/**
 * F-1457 (sim 48, integ19-w95-97-regress.md). An opening-stock line for a
 * wine the house already carries used to come back `stock_added`, booked as
 * a +qty 'purchase' — so a file sent while the page still thought the list
 * was empty doubled every wine in it. ADR 0335 §2: opening stock is one
 * COUNT per house item. The line now counts the item to the file's number.
 *
 * Control: the same line from any other source (a delivery) still tops the
 * item up, as before.
 */
const HOUSE = "house-a";
const ITEM = "item-1";

function service(existing: { id: string; is_active: boolean } | null) {
  const rpc = jest.fn().mockResolvedValue({ data: null, error: null });
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    update: () => chain,
    maybeSingle: () => Promise.resolve({ data: existing, error: null }),
    then: (res: any, rej: any) =>
      Promise.resolve({ data: [], error: null }).then(res, rej),
  };
  const client = { rpc, from: () => chain };
  const svc = Object.create(InventoryService.prototype) as any;
  svc.dbService = { getClient: () => client, supabase: client };
  svc.logger = { error: () => {}, warn: () => {}, log: () => {} };
  svc.resolveBulkLineWine = jest.fn().mockResolvedValue({
    masterWineId: "mw-1",
    wineName: "Kavaklıdere Yakut",
    matched: true,
    libraryTier: 1,
  });
  svc.recordSpotCount = jest.fn().mockResolvedValue({});
  return { svc: svc as InventoryService & Record<string, any>, rpc };
}

const line = {
  wineDraft: { name: "Kavaklıdere Yakut", vintage: 2020 },
  stockLive: 12,
};

describe("opening stock counts a wine the house already carries (F-1457)", () => {
  it("counts the carried item to the file's number and adds nothing", async () => {
    const t = service({ id: ITEM, is_active: true });
    const out: any = await t.svc.bulkCreateInventoryItems(HOUSE, {
      source: "opening_stock",
      items: [line],
    } as any);
    expect(out.results[0]).toMatchObject({
      status: "counted",
      inventoryId: ITEM,
    });
    expect(out.counted).toBe(1);
    expect(out.stockAdded).toBe(0);
    expect(t.svc.recordSpotCount).toHaveBeenCalledWith(
      HOUSE,
      ITEM,
      expect.objectContaining({ countedQty: 12, locationId: null }),
    );
    expect(t.rpc).not.toHaveBeenCalledWith(
      "apply_stock_movement",
      expect.anything(),
    );
  });

  it("the same file sent twice counts twice to the same number", async () => {
    const t = service({ id: ITEM, is_active: true });
    for (let i = 0; i < 2; i++) {
      await t.svc.bulkCreateInventoryItems(HOUSE, {
        source: "opening_stock",
        items: [line],
      } as any);
    }
    const counts = (t.svc.recordSpotCount as jest.Mock).mock.calls.map(
      (c) => c[2].countedQty,
    );
    expect(counts).toEqual([12, 12]);
    expect(t.rpc).not.toHaveBeenCalled();
  });

  it("control: a delivery of a carried wine still tops it up", async () => {
    const t = service({ id: ITEM, is_active: true });
    const out: any = await t.svc.bulkCreateInventoryItems(HOUSE, {
      source: "delivery",
      items: [line],
    } as any);
    expect(out.results[0]).toMatchObject({ status: "stock_added" });
    expect(t.svc.recordSpotCount).not.toHaveBeenCalled();
    expect(t.rpc).toHaveBeenCalledWith(
      "apply_stock_movement",
      expect.objectContaining({ p_delta: 12, p_transaction_type: "purchase" }),
    );
  });
});
