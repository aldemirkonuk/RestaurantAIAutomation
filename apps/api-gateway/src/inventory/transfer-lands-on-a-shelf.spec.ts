import { HttpException } from "@nestjs/common";
import { InventoryService } from "./inventory.service";

/**
 * F-1542. A transfer refuses a destination that holds other places: bottles
 * filed on a parent zone sit on no shelf, and the wine can no longer be
 * counted shelf by shelf (the F-945 rule). Refused in words, before the RPC.
 *
 * The fake client applies `eq`, `is` and `in` filters to seeded zones, so a
 * path that skipped the check reaches `transfer_stock` and the test sees it.
 */
const HOUSE = "house-a";
const ITEM = "item-a";
const ZONES = [
  { id: "cellar", restaurant_id: HOUSE, parent_id: null, deleted_at: null },
  { id: "rack-1", restaurant_id: HOUSE, parent_id: "cellar", deleted_at: null },
  { id: "bar", restaurant_id: HOUSE, parent_id: null, deleted_at: null },
  // Only a deleted shelf inside: the place holds no live shelf, so it is one.
  { id: "old-room", restaurant_id: HOUSE, parent_id: null, deleted_at: null },
  {
    id: "gone-rack",
    restaurant_id: HOUSE,
    parent_id: "old-room",
    deleted_at: "2026-10-01T00:00:00Z",
  },
];

function service(opts: { zoneReadFails?: boolean } = {}) {
  const rpc = jest.fn().mockResolvedValue({
    data: null,
    error: { message: "stubbed rpc failure after the gate" },
  });
  const client = {
    rpc,
    from(table: string) {
      const filters: Array<(r: any) => boolean> = [];
      let byParent = false;
      const chain: any = {
        select: () => chain,
        limit: () => chain,
        eq: (col: string, val: unknown) => {
          if (col === "parent_id") byParent = true;
          filters.push((r) => r[col] === val);
          return chain;
        },
        is: (col: string, val: unknown) => (
          filters.push((r) => (r[col] ?? null) === val),
          chain
        ),
        in: (col: string, vals: unknown[]) => (
          filters.push((r) => vals.includes(r[col])),
          chain
        ),
        maybeSingle: () =>
          Promise.resolve({
            data: table === "restaurant_inventory" ? { id: ITEM } : null,
            error: null,
          }),
        then: (res: any, rej: any) =>
          Promise.resolve(
            opts.zoneReadFails && byParent
              ? { data: null, error: { message: "read failed" } }
              : {
                  data:
                    table === "storage_locations"
                      ? ZONES.filter((r) => filters.every((f) => f(r)))
                      : [],
                  error: null,
                },
          ).then(res, rej),
      };
      return chain;
    },
  };
  const svc = Object.create(InventoryService.prototype) as any;
  svc.dbService = { getClient: () => client };
  svc.logger = { error: () => {}, warn: () => {}, log: () => {} };
  return { svc: svc as InventoryService, rpc };
}

async function refusal(p: Promise<unknown>) {
  try {
    await p;
    return null;
  } catch (e) {
    return e instanceof HttpException
      ? { status: e.getStatus(), message: e.message }
      : { status: -1, message: String(e) };
  }
}

describe("a transfer lands on a shelf, never on a place holding places (F-1542)", () => {
  it("[REVERT-FAILS] refuses a place that holds other places, in words, and moves nothing", async () => {
    const t = service();
    const r = await refusal(
      t.svc.transferStock(HOUSE, ITEM, {
        fromLocationId: "bar",
        toLocationId: "cellar",
        qty: 1,
      }),
    );
    expect(r?.status).toBe(400);
    expect(r?.message).toMatch(/holds other places/);
    expect(t.rpc).not.toHaveBeenCalled();
  });

  it("control: a shelf, and a place whose only shelf inside was deleted, reach the RPC", async () => {
    for (const to of ["rack-1", "bar", "old-room"]) {
      const t = service();
      await t.svc
        .transferStock(HOUSE, ITEM, {
          fromLocationId: null,
          toLocationId: to,
          qty: 1,
        })
        .catch(() => undefined);
      expect(t.rpc).toHaveBeenCalledWith(
        "transfer_stock",
        expect.objectContaining({ p_to_location_id: to }),
      );
    }
  });

  it("a zone read that fails refuses, and moves nothing", async () => {
    const t = service({ zoneReadFails: true });
    const r = await refusal(
      t.svc.transferStock(HOUSE, ITEM, { toLocationId: "bar", qty: 1 }),
    );
    expect(r?.status).toBe(500);
    expect(t.rpc).not.toHaveBeenCalled();
  });
});
