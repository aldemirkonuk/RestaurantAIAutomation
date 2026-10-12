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

/**
 * F-1514 (sim 49, integ20-new-house-30-days.md): the first current menu seeds
 * each wine at 0, so opening stock loaded after it COUNTS those wines. The
 * count went in as a spot count, and the first month close read the whole
 * cellar as "bottles over". ADR 0335 §2: an opening count is the first count
 * variance is measured from, so it is booked as one (`opening: true`).
 *
 * F-1515: one wine on two lines of the file, one line naming no shelf. Lines
 * are applied one at a time; the second COUNTED the wine on every shelf to its
 * own number, wiping out the first line's bottles, and patched the wine's
 * shelf to none. That line is now refused, in plain words.
 */
describe("opening stock is an opening count, one wine per shelf (F-1514, F-1515)", () => {
  function newHouse() {
    // Line 1 creates the wine; every later line finds it.
    let made = false;
    const rpc = jest.fn().mockResolvedValue({ data: null, error: null });
    const update = jest.fn();
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      // The house's shelves, for the location check.
      in: () => chain,
      is: () => chain,
      insert: () => {
        made = true;
        return chain;
      },
      update: (patch: unknown) => {
        update(patch);
        return chain;
      },
      single: () => Promise.resolve({ data: { id: ITEM }, error: null }),
      maybeSingle: () =>
        Promise.resolve({
          data: made ? { id: ITEM, is_active: true } : null,
          error: null,
        }),
      then: (res: any, rej: any) =>
        Promise.resolve({
          data: [{ id: "loc-cellar" }, { id: "loc-bar" }],
          error: null,
        }).then(res, rej),
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
    svc.houseDefaultParMin = jest.fn().mockResolvedValue(3);
    svc.priceOnAdd = jest.fn().mockResolvedValue(null);
    svc.recordSpotCount = jest.fn().mockResolvedValue({});
    return { svc: svc as InventoryService & Record<string, any>, rpc, update };
  }

  it("books a carried wine's opening count as an opening count, not a spot count", async () => {
    const t = service({ id: ITEM, is_active: true });
    await t.svc.bulkCreateInventoryItems(HOUSE, {
      source: "opening_stock",
      items: [line],
    } as any);
    expect(t.svc.recordSpotCount).toHaveBeenCalledWith(
      HOUSE,
      ITEM,
      expect.objectContaining({ opening: true }),
    );
  });

  it("refuses a second line for the same wine with no shelf, and keeps the first line's bottles", async () => {
    const t = newHouse();
    const out: any = await t.svc.bulkCreateInventoryItems(HOUSE, {
      source: "opening_stock",
      items: [
        { ...line, stockLive: 10, storageLocationId: "loc-cellar" },
        { ...line, stockLive: 4, storageLocationId: null },
      ],
    } as any);
    expect(out.results[0]).toMatchObject({ status: "created" });
    expect(out.results[1]).toMatchObject({ status: "failed" });
    expect(out.results[1].error).toMatch(/names no shelf/);
    // Nothing counted the wine on every shelf, and its shelf was not cleared.
    expect(t.svc.recordSpotCount).not.toHaveBeenCalled();
    expect(t.update).not.toHaveBeenCalled();
    expect(t.rpc).toHaveBeenCalledTimes(1);
    expect(t.rpc).toHaveBeenCalledWith(
      "apply_stock_movement",
      expect.objectContaining({ p_delta: 10, p_location_id: "loc-cellar" }),
    );
  });

  it("refuses a shelved line after a line with no shelf for the same wine", async () => {
    const t = newHouse();
    const out: any = await t.svc.bulkCreateInventoryItems(HOUSE, {
      source: "opening_stock",
      items: [
        { ...line, stockLive: 4, storageLocationId: null },
        { ...line, stockLive: 10, storageLocationId: "loc-cellar" },
      ],
    } as any);
    expect(out.results[1]).toMatchObject({ status: "failed" });
    expect(t.svc.recordSpotCount).not.toHaveBeenCalled();
  });

  it("control: the same wine on two named shelves counts the second shelf only", async () => {
    const t = newHouse();
    const out: any = await t.svc.bulkCreateInventoryItems(HOUSE, {
      source: "opening_stock",
      items: [
        { ...line, stockLive: 10, storageLocationId: "loc-cellar" },
        { ...line, stockLive: 4, storageLocationId: "loc-bar" },
      ],
    } as any);
    expect(out.results.map((r: any) => r.status)).toEqual([
      "created",
      "counted",
    ]);
    expect(t.svc.recordSpotCount).toHaveBeenCalledWith(
      HOUSE,
      ITEM,
      expect.objectContaining({ countedQty: 4, locationId: "loc-bar" }),
    );
  });

  it("an opening line with no shelf for a carried wine leaves the wine's shelf as it is", async () => {
    const t = newHouse();
    await t.svc.bulkCreateInventoryItems(HOUSE, {
      source: "opening_stock",
      items: [{ ...line, stockLive: 0 }],
    } as any);
    await t.svc.bulkCreateInventoryItems(HOUSE, {
      source: "opening_stock",
      items: [{ ...line, storageLocationId: null }],
    } as any);
    expect(t.update).not.toHaveBeenCalled();
  });
});
