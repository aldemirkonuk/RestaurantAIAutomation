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
