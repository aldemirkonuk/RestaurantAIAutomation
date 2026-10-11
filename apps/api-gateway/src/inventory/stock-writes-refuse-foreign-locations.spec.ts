import { HttpException } from "@nestjs/common";
import { InventoryService } from "./inventory.service";
import { InventoryLedgerService } from "../inventory-ledger/inventory-ledger.service";
import { assertLocationsBelongToRestaurant } from "../common/tenant/assert-location-belongs-to-restaurant";

/**
 * F-435. Every stock write that names a storage location refuses one that is
 * not the caller's house's, BEFORE anything is read past it or written.
 *
 * The item check (ADR 0141, `assertInventoryBelongsToRestaurant`) already
 * held; the zone ids were taken on trust. `inventory_lots.location_id` and
 * `restaurant_inventory.storage_location_id` are only foreign keys to
 * `storage_locations(id)` with no house tie, and the RPCs take the house from
 * the item, so house A could file its bottles under house B's zone.
 *
 * Each path has a refusal and a CONTROL: B's zone is refused with nothing
 * touched past the zone read; A's own zone (or no zone) gets past the gate.
 * Without the control, a gate that refused everything would pass.
 *
 * The fake client applies `eq` and `in` filters to seeded zones, so a write
 * path that skipped the check reaches its RPC or insert and the test sees it.
 */
const HOUSE_A = "house-a";
const HOUSE_B = "house-b";
const ZONE_OF_A = "zone-of-a";
const ZONE_OF_B = "zone-of-b";
/** A's own zone, deleted. Bottles may leave it; none may land in it (F-1334). */
const ZONE_GONE = "zone-gone";
const ITEM_OF_A = "item-of-a";

const ZONES = [
  { id: ZONE_OF_A, restaurant_id: HOUSE_A, deleted_at: null },
  { id: ZONE_OF_B, restaurant_id: HOUSE_B, deleted_at: null },
  { id: ZONE_GONE, restaurant_id: HOUSE_A, deleted_at: "2026-10-01T00:00:00Z" },
];

function fakeClient() {
  const touched: string[] = [];
  const rpc = jest.fn().mockResolvedValue({
    data: null,
    error: { message: "stubbed rpc failure after the gate" },
  });
  const client = {
    rpc,
    from(table: string) {
      touched.push(table);
      const filters: Array<(r: any) => boolean> = [];
      const rows = () =>
        table === "storage_locations"
          ? ZONES.filter((r) => filters.every((f) => f(r)))
          : [];
      const chain: any = {
        select: () => chain,
        insert: () => chain,
        update: () => chain,
        order: () => chain,
        limit: () => chain,
        eq: (col: string, val: unknown) => (
          filters.push((r) => r[col] === val),
          chain
        ),
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
            data: table === "restaurant_inventory" ? { id: ITEM_OF_A } : null,
            error: null,
          }),
        single: () =>
          Promise.resolve({ data: null, error: { message: "stubbed read" } }),
        then: (res: any, rej: any) =>
          Promise.resolve({ data: rows(), error: null }).then(res, rej),
      };
      return chain;
    },
  };
  return { client, rpc, touched };
}

const quietLogger = { error: () => {}, warn: () => {}, log: () => {} };

function inventoryService() {
  const f = fakeClient();
  const svc = Object.create(InventoryService.prototype) as any;
  svc.dbService = { getClient: () => f.client, supabase: f.client };
  svc.logger = quietLogger;
  return { svc: svc as InventoryService, ...f };
}

function ledgerService() {
  const f = fakeClient();
  const svc = Object.create(InventoryLedgerService.prototype) as any;
  svc.databaseService = { supabase: f.client };
  svc.logger = quietLogger;
  return { svc: svc as InventoryLedgerService, ...f };
}

async function statusOf(p: Promise<unknown>): Promise<number> {
  try {
    await p;
    return 200;
  } catch (e) {
    return e instanceof HttpException ? e.getStatus() : -1;
  }
}

describe("stock writes refuse another house's storage location (F-435)", () => {
  describe("transfer (transfer_stock)", () => {
    for (const side of ["fromLocationId", "toLocationId"] as const) {
      it(`B's zone as ${side} is a 404 and the RPC is never called`, async () => {
        const t = inventoryService();
        expect(
          await statusOf(
            t.svc.transferStock(HOUSE_A, ITEM_OF_A, {
              [side]: ZONE_OF_B,
              qty: 1,
            }),
          ),
        ).toBe(404);
        expect(t.rpc).not.toHaveBeenCalled();
      });
    }

    it("control: A's own zones (and unassigned) reach the RPC", async () => {
      const t = inventoryService();
      await t.svc
        .transferStock(HOUSE_A, ITEM_OF_A, {
          fromLocationId: null,
          toLocationId: ZONE_OF_A,
          qty: 1,
        })
        .catch(() => undefined);
      expect(t.rpc).toHaveBeenCalledWith(
        "transfer_stock",
        expect.objectContaining({ p_to_location_id: ZONE_OF_A }),
      );
    });
  });

  describe("pour (record_glass_pour)", () => {
    it("B's zone is a 404 and the RPC is never called", async () => {
      const t = inventoryService();
      expect(
        await statusOf(
          t.svc.recordPour(HOUSE_A, ITEM_OF_A, {
            pours: 1,
            locationId: ZONE_OF_B,
          }),
        ),
      ).toBe(404);
      expect(t.rpc).not.toHaveBeenCalled();
    });

    it("control: A's own zone reaches the RPC", async () => {
      const t = inventoryService();
      await t.svc
        .recordPour(HOUSE_A, ITEM_OF_A, { pours: 1, locationId: ZONE_OF_A })
        .catch(() => undefined);
      expect(t.rpc).toHaveBeenCalledWith(
        "record_glass_pour",
        expect.objectContaining({ p_location_id: ZONE_OF_A }),
      );
    });
  });

  describe("add a wine (item insert + its first lot)", () => {
    it("B's zone is a 404 before any wine is read or written", async () => {
      const t = inventoryService();
      expect(
        await statusOf(
          t.svc.createInventoryItem(HOUSE_A, {
            wineId: "w1",
            stockLive: 3,
            storageLocationId: ZONE_OF_B,
          } as any),
        ),
      ).toBe(404);
      expect(t.touched).toEqual(["storage_locations"]);
      expect(t.rpc).not.toHaveBeenCalled();
    });

    it("control: A's own zone gets past the gate", async () => {
      const t = inventoryService();
      await t.svc
        .createInventoryItem(HOUSE_A, {
          wineId: "w1",
          stockLive: 3,
          storageLocationId: ZONE_OF_A,
        } as any)
        .catch(() => undefined);
      expect(t.touched).toContain("restaurant_inventory");
    });
  });

  describe("bulk receive", () => {
    it("a line naming B's zone fails on its own, before its wine is resolved or written", async () => {
      const t = inventoryService();
      const out: any = await t.svc.bulkCreateInventoryItems(HOUSE_A, {
        items: [{ wineId: "w1", stockLive: 2, storageLocationId: ZONE_OF_B }],
      } as any);
      expect(out.results[0]).toMatchObject({
        status: "failed",
        error: "No storage location of this house has that id.",
      });
      expect(t.touched).toEqual(["storage_locations"]);
      expect(t.rpc).not.toHaveBeenCalled();
    });

    it("control: a line naming A's own zone gets past the gate", async () => {
      const t = inventoryService();
      const out: any = await t.svc.bulkCreateInventoryItems(HOUSE_A, {
        items: [{ wineId: "w1", stockLive: 2, storageLocationId: ZONE_OF_A }],
      } as any);
      expect(out.results[0].error).not.toBe(
        "No storage location of this house has that id.",
      );
      expect(
        t.touched.filter((x) => x !== "storage_locations").length,
      ).toBeGreaterThan(0);
    });
  });

  describe("ledger transaction (apply_stock_movement)", () => {
    const dto = (loc: Record<string, string>) =>
      ({
        inventoryId: ITEM_OF_A,
        quantityChange: 1,
        transactionType: "adjustment",
        source: "manual",
        ...loc,
      }) as any;

    for (const side of ["fromLocationId", "toLocationId"] as const) {
      it(`B's zone as ${side} is a 404 and the RPC is never called`, async () => {
        const t = ledgerService();
        expect(
          await statusOf(
            t.svc.createTransaction(
              HOUSE_A,
              "user-a",
              dto({ [side]: ZONE_OF_B }),
            ),
          ),
        ).toBe(404);
        expect(t.rpc).not.toHaveBeenCalled();
      });
    }

    it("control: A's own zone reaches the RPC", async () => {
      const t = ledgerService();
      await t.svc
        .createTransaction(HOUSE_A, "user-a", dto({ toLocationId: ZONE_OF_A }))
        .catch(() => undefined);
      expect(t.rpc).toHaveBeenCalledWith(
        "apply_stock_movement",
        expect.objectContaining({ p_location_id: ZONE_OF_A }),
      );
    });
  });
});

describe("a deleted zone of this house is a source, never a destination (F-1334)", () => {
  it("transfer INTO a deleted zone is a 404 and the RPC is never called", async () => {
    const t = inventoryService();
    expect(
      await statusOf(
        t.svc.transferStock(HOUSE_A, ITEM_OF_A, {
          fromLocationId: ZONE_OF_A,
          toLocationId: ZONE_GONE,
          qty: 1,
        }),
      ),
    ).toBe(404);
    expect(t.rpc).not.toHaveBeenCalled();
  });

  it("control: transfer OUT of a deleted zone still reaches the RPC", async () => {
    const t = inventoryService();
    await t.svc
      .transferStock(HOUSE_A, ITEM_OF_A, {
        fromLocationId: ZONE_GONE,
        toLocationId: ZONE_OF_A,
        qty: 1,
      })
      .catch(() => undefined);
    expect(t.rpc).toHaveBeenCalledWith(
      "transfer_stock",
      expect.objectContaining({ p_from_location_id: ZONE_GONE }),
    );
  });

  it("receiving a wine into a deleted zone is a 404 before anything is written", async () => {
    const t = inventoryService();
    expect(
      await statusOf(
        t.svc.createInventoryItem(HOUSE_A, {
          wineId: "w1",
          stockLive: 3,
          storageLocationId: ZONE_GONE,
        } as any),
      ),
    ).toBe(404);
    expect(t.touched).toEqual(["storage_locations"]);
  });

  it("a bulk-receive line naming a deleted zone fails on its own", async () => {
    const t = inventoryService();
    const out: any = await t.svc.bulkCreateInventoryItems(HOUSE_A, {
      items: [{ wineId: "w1", stockLive: 2, storageLocationId: ZONE_GONE }],
    } as any);
    expect(out.results[0]).toMatchObject({ status: "failed" });
    expect(t.touched).toEqual(["storage_locations"]);
    expect(t.rpc).not.toHaveBeenCalled();
  });

  it("a ledger movement bringing bottles into a deleted zone is a 404", async () => {
    const t = ledgerService();
    expect(
      await statusOf(
        t.svc.createTransaction(HOUSE_A, "user-a", {
          inventoryId: ITEM_OF_A,
          quantityChange: 2,
          transactionType: "adjustment",
          source: "manual",
          toLocationId: ZONE_GONE,
        } as any),
      ),
    ).toBe(404);
    expect(t.rpc).not.toHaveBeenCalled();
  });

  it("control: a ledger take-off from a deleted zone reaches the RPC", async () => {
    const t = ledgerService();
    await t.svc
      .createTransaction(HOUSE_A, "user-a", {
        inventoryId: ITEM_OF_A,
        quantityChange: -1,
        transactionType: "adjustment",
        source: "manual",
        fromLocationId: ZONE_GONE,
      } as any)
      .catch(() => undefined);
    expect(t.rpc).toHaveBeenCalledWith(
      "apply_stock_movement",
      expect.objectContaining({ p_location_id: ZONE_GONE }),
    );
  });
});

describe("assertLocationsBelongToRestaurant", () => {
  it("one foreign id among owned ones refuses the whole write", async () => {
    const { client } = fakeClient();
    await expect(
      assertLocationsBelongToRestaurant(
        client as any,
        HOUSE_A,
        [ZONE_OF_A, ZONE_OF_B],
        "t",
      ),
    ).rejects.toBeInstanceOf(HttpException);
  });

  it("null and undefined mean unassigned and read nothing", async () => {
    const { client, touched } = fakeClient();
    await assertLocationsBelongToRestaurant(
      client as any,
      HOUSE_A,
      [null, undefined, ""],
      "t",
    );
    expect(touched).toEqual([]);
  });

  it("a failed read refuses, it is not taken as a yes", async () => {
    const client = {
      from: () => {
        const c: any = {
          select: () => c,
          eq: () => c,
          in: () => c,
          then: (res: any) =>
            res({ data: null, error: { message: "connection reset" } }),
        };
        return c;
      },
    };
    expect(
      await statusOf(
        assertLocationsBelongToRestaurant(
          client as any,
          HOUSE_A,
          [ZONE_OF_A],
          "t",
        ),
      ),
    ).toBe(500);
  });
});
