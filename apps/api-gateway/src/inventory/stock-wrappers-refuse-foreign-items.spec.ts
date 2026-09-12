import { ForbiddenException } from "@nestjs/common";
import { InventoryService } from "./inventory.service";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";

/**
 * ADR 0141, Correction 2026-09-12. The record said the cross-tenant stock write
 * was closed "at both ends". Four live routes still reached stock through SQL
 * wrappers that derive the house from the item and never pass p_restaurant_id:
 * reconcile, count, pour and transfer. Each now checks ownership before its RPC.
 *
 * Every case pairs a refusal with a CONTROL. A foreign item must be refused
 * with the RPC never called; the caller's own item must reach the RPC. Without
 * the control, a gate that refused every request would pass.
 *
 * The services are built without their constructors so the tests depend only
 * on the fields each method touches, not on the order Nest injects providers.
 */
function clientFor(owned: boolean) {
  const rpc = jest.fn().mockResolvedValue({
    data: null,
    error: { message: "stubbed rpc failure after the gate" },
  });
  const client = {
    rpc,
    from(table: string) {
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: () =>
          Promise.resolve({
            data: table === "restaurant_inventory" && owned ? { id: "item" } : null,
            error: null,
          }),
      };
      return chain;
    },
  };
  return { client, rpc };
}

const quietLogger = { error: () => {}, warn: () => {}, log: () => {} };

function inventoryService(owned: boolean) {
  const { client, rpc } = clientFor(owned);
  const svc = Object.create(InventoryService.prototype) as any;
  svc.dbService = { getClient: () => client };
  svc.logger = quietLogger;
  return { svc: svc as InventoryService, rpc };
}

function ledgerService(owned: boolean) {
  const { client, rpc } = clientFor(owned);
  const svc = Object.create(InventoryLedgerService.prototype) as any;
  svc.databaseService = { supabase: client };
  svc.logger = quietLogger;
  return { svc: svc as InventoryLedgerService, rpc };
}

const HOUSE = "restaurant-b";
const ITEM = "inventory-of-restaurant-a";

describe("a stock wrapper refuses an item that belongs to another house", () => {
  const cases: Array<{
    name: string;
    make: (owned: boolean) => { svc: any; rpc: jest.Mock };
    call: (svc: any) => Promise<unknown>;
  }> = [
    {
      name: "InventoryService.recordPour (record_glass_pour)",
      make: inventoryService,
      call: (svc) => svc.recordPour(HOUSE, ITEM, { pours: 1 }),
    },
    {
      name: "InventoryService.transferStock (transfer_stock)",
      make: inventoryService,
      call: (svc) => svc.transferStock(HOUSE, ITEM, { qty: 1 }),
    },
    {
      name: "InventoryService.recordSpotCount (record_stock_count)",
      make: inventoryService,
      call: (svc) =>
        svc.recordSpotCount(HOUSE, ITEM, { countedQty: 0, clientCountId: "c1" }),
    },
    {
      name: "InventoryLedgerService.reconcileInventory (record_stock_count)",
      make: ledgerService,
      call: (svc) => svc.reconcileInventory(HOUSE, "user", ITEM, "wine", 0),
    },
  ];

  for (const c of cases) {
    it(`${c.name}: a foreign item is refused and the RPC is never called`, async () => {
      const { svc, rpc } = c.make(false);
      await expect(c.call(svc)).rejects.toBeInstanceOf(ForbiddenException);
      expect(rpc).not.toHaveBeenCalled();
    });

    it(`${c.name}: the caller's own item still reaches the RPC (control)`, async () => {
      const { svc, rpc } = c.make(true);
      await c.call(svc).catch(() => undefined);
      expect(rpc).toHaveBeenCalledTimes(1);
    });
  }
});

/**
 * ADR 0141, second correction 2026-09-12. A fifth route the first correction
 * missed: PATCH /inventory/:restaurantId/item/:itemId with `stockLive` reaches
 * `updateInventoryItem`, whose restaurant-scoped read kept `data` and never
 * refused on null, and then handed the raw item id to `set_stock_absolute` --
 * a wrapper that calls apply_stock_movement WITHOUT p_restaurant_id. A PGlite
 * probe on this tree's migrations took a foreign house's lots from 9 to empty.
 *
 * The refusal must come before ANY write, not only before the RPC: the plain
 * UPDATE of non-stock fields is scoped by restaurant, but a PATCH that names
 * another house's item is refused whole rather than half-applied.
 */
describe("updateInventoryItem refuses an item that belongs to another house", () => {
  function updateClient(owned: boolean) {
    const rpc = jest.fn().mockResolvedValue({ data: null, error: null });
    const update = jest.fn();
    const client = {
      rpc,
      from(table: string) {
        const chain: any = {
          select: () => chain,
          eq: () => chain,
          update: (row: unknown) => {
            update(table, row);
            return chain;
          },
          maybeSingle: () =>
            Promise.resolve({
              data: table === "restaurant_inventory" && owned ? { id: ITEM } : null,
              error: null,
            }),
          // The scoped reads: for a foreign item there is no row under this
          // house, which is exactly what the pre-fix code kept and ignored.
          single: () =>
            Promise.resolve({
              data: owned
                ? {
                    id: ITEM,
                    restaurant_id: HOUSE,
                    stock_live: 9,
                    shadow_stock: 0,
                    threshold_min: 1,
                    master_wine_id: "wine",
                    master_wine_library: { name: "Wine", bottle_size_ml: 750 },
                    restaurants: { default_pour_ml: 150, measurement_unit: "ml" },
                  }
                : null,
              error: null,
            }),
          then: (resolve: any, reject: any) =>
            Promise.resolve({ data: [], error: null }).then(resolve, reject),
        };
        return chain;
      },
    };
    const svc = Object.create(InventoryService.prototype) as any;
    svc.dbService = { getClient: () => client };
    svc.logger = quietLogger;
    return { svc: svc as InventoryService, rpc, update };
  }

  it("a foreign item is refused, set_stock_absolute is never called and nothing is updated", async () => {
    const { svc, rpc, update } = updateClient(false);
    await expect(
      svc.updateInventoryItem(HOUSE, ITEM, { stockLive: 0, thresholdMin: 3 } as any, "user"),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(rpc).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it("the caller's own item still reaches set_stock_absolute (control)", async () => {
    const { svc, rpc } = updateClient(true);
    await svc
      .updateInventoryItem(HOUSE, ITEM, { stockLive: 0 } as any, "user")
      .catch(() => undefined);
    expect(rpc).toHaveBeenCalledWith(
      "set_stock_absolute",
      expect.objectContaining({ p_inventory_id: ITEM, p_target_qty: 0 }),
    );
  });
});
