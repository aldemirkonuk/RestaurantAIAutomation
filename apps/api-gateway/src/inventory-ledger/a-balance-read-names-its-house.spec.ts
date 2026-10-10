import { NotFoundException, ServiceUnavailableException } from "@nestjs/common";
import { InventoryLedgerService } from "./inventory-ledger.service";
import { DatabaseService } from "../database/database.service";
import { EventsService } from "../events/events.service";

/**
 * F-308 — A BALANCE READ NAMES THE HOUSE IT IS FOR.
 *
 * `GET /inventory-ledger/inventory/:inventoryId/balance` passed the caller's
 * house to `getBalanceAt`, which never used it. `get_inventory_balance_at`
 * filters on the item id alone and the gateway's service role skips RLS, so a
 * member of house A read house B's stock at any date for any B item id. The
 * house is now checked before the RPC runs.
 */

const HOUSE_A = "11111111-1111-4111-8111-111111111111";
const ITEM_OF_B = "33333333-3333-4333-8333-333333333333";
const ITEM_OF_A = "22222222-2222-4222-8222-222222222222";

function makeDb(ownership: {
  data: unknown;
  error: { message: string } | null;
}) {
  const rpc = jest.fn(async () => ({ data: 12, error: null }));
  const eqs: [string, unknown][] = [];
  const supabase: any = {
    rpc,
    from: (table: string) => {
      const q: any = {
        select: () => q,
        eq: (col: string, val: unknown) => {
          eqs.push([`${table}.${col}`, val]);
          return q;
        },
        maybeSingle: async () => ownership,
      };
      return q;
    },
  };
  const service = new InventoryLedgerService(
    { supabase, getClient: () => supabase } as unknown as DatabaseService,
    {
      createEvent: async () => ({ id: "event-1" }),
    } as unknown as EventsService,
  );
  return { service, rpc, eqs };
}

describe("getBalanceAt reads only the caller's own items (F-308)", () => {
  it("refuses house B's item for a member of house A, and never runs the balance read", async () => {
    const { service, rpc, eqs } = makeDb({ data: null, error: null });
    await expect(
      service.getBalanceAt(HOUSE_A, ITEM_OF_B, "2026-10-01T00:00:00Z"),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(rpc).not.toHaveBeenCalled();
    expect(eqs).toEqual([
      ["restaurant_inventory.restaurant_id", HOUSE_A],
      ["restaurant_inventory.id", ITEM_OF_B],
    ]);
  });

  it("refuses when it cannot confirm the house, rather than reading the balance", async () => {
    const { service, rpc } = makeDb({
      data: null,
      error: { message: "timeout" },
    });
    await expect(
      service.getBalanceAt(HOUSE_A, ITEM_OF_A, "2026-10-01T00:00:00Z"),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers the house's own item", async () => {
    const { service, rpc } = makeDb({ data: { id: ITEM_OF_A }, error: null });
    const res = await service.getBalanceAt(
      HOUSE_A,
      ITEM_OF_A,
      "2026-10-01T00:00:00Z",
    );
    expect(res.balance).toBe(12);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
