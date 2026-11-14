import { ForbiddenException, HttpException } from "@nestjs/common";
import { InventoryController } from "./inventory.controller";
import { OpeningCostService, readStatedCost } from "./opening-cost.service";
import { OrganizationsService } from "../organizations/organizations.service";

/**
 * r36 invoices R1: stock from no delivery (the opening shelf, a menu scan, an
 * item added with no price) can be given its cost, by an owner or a manager,
 * and the bottles already sold from it settle at that cost. SYNTHETIC data.
 */
function rpcDb(answer: { data?: unknown; error?: { message: string } | null }) {
  const rpc = jest.fn(async () => ({ data: answer.data ?? null, error: answer.error ?? null }));
  return { db: { getClient: () => ({ rpc }) } as never, rpc };
}

describe("readStatedCost", () => {
  it.each([
    [12.5, 12.5],
    ["0.006592", 0.006592],
    [" 30 ", 30],
  ])("%j reads as %d", (raw, want) => {
    expect(readStatedCost(raw)).toEqual({ ok: true, cost: want });
  });

  it.each([
    [0, "more than nothing"],
    [-4, "more than nothing"],
    [null, "not a number"],
    ["", "not a number"],
    ["twelve", "not a number"],
    [Number.NaN, "not a number"],
    [0.0000001, "more than six decimal places"],
  ])("%j is refused: %s", (raw, why) => {
    const r = readStatedCost(raw);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toContain(why);
  });
});

describe("OpeningCostService.state", () => {
  it("states the cost for the house and item, names the person, and says what it reached", async () => {
    const { db, rpc } = rpcDb({
      data: { unit_cost: 18, lots_stated: 2, units_stated: 9, empty_lots_stated: 1, draws_settled: 3 },
    });
    const r = await new OpeningCostService(db).state("rest-1", "inv-1", "18", "u-1");
    expect(rpc).toHaveBeenCalledWith("state_opening_lot_cost", {
      p_restaurant_id: "rest-1",
      p_inventory_id: "inv-1",
      p_unit_cost: 18,
      p_performed_by: "u-1",
      p_stock_state: "live",
    });
    expect(r).toMatchObject({ unitCost: 18, lotsStated: 2, unitsStated: 9, emptyLotsStated: 1, drawsSettled: 3 });
    expect(r.said).toBe("Stated on 2 lots (9 units on the shelf); what already left them is costed at it too (3 draws).");
  });

  it("when nothing had left the lots yet, it does not claim any draw was costed", async () => {
    const { db } = rpcDb({ data: { unit_cost: 18, lots_stated: 1, units_stated: 6, empty_lots_stated: 0, draws_settled: 0 } });
    const r = await new OpeningCostService(db).state("rest-1", "inv-1", 18, "u-1");
    expect(r.said).toBe("Stated on 1 lot (6 units on the shelf).");
  });

  it("a retry, or an item with nothing uncosted, says nothing was stated", async () => {
    const { db } = rpcDb({ data: { unit_cost: 18, lots_stated: 0, units_stated: 0, empty_lots_stated: 0, draws_settled: 0 } });
    const r = await new OpeningCostService(db).state("rest-1", "inv-1", 18, "u-1");
    expect(r.lotsStated).toBe(0);
    expect(r.said).toMatch(/nothing was stated/);
  });

  it("a bad cost is refused before the database is asked", async () => {
    const { db, rpc } = rpcDb({ data: {} });
    await expect(new OpeningCostService(db).state("rest-1", "inv-1", 0, "u-1")).rejects.toMatchObject({ status: 400 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("an item of another house reads as not found, never as stated", async () => {
    const { db } = rpcDb({ error: { message: "inventory inv-1 not found" } });
    await expect(new OpeningCostService(db).state("rest-1", "inv-1", 18, "u-1")).rejects.toMatchObject({ status: 404 });
  });

  it("any other failure says nothing was changed, and is a 500", async () => {
    const { db } = rpcDb({ error: { message: "connection reset" } });
    const p = new OpeningCostService(db).state("rest-1", "inv-1", 18, "u-1");
    await expect(p).rejects.toBeInstanceOf(HttpException);
    await expect(p).rejects.toMatchObject({ status: 500 });
  });
});

describe("POST /inventory/:restaurantId/item/:itemId/opening-cost — who may state a cost", () => {
  function controller(role: string | null) {
    const organizations = new OrganizationsService({} as never);
    jest.spyOn(organizations, "resolveRestaurantRole").mockResolvedValue(role);
    const state = jest.fn(async () => ({ lotsStated: 1 }));
    const c = new InventoryController({} as any, organizations, {} as any, { state } as unknown as OpeningCostService);
    return { c, state };
  }

  it.each(["owner", "manager"])("a %s states it, for the house in the path, as themselves", async (role) => {
    const { c, state } = controller(role);
    await c.stateOpeningCost("rest-1", "inv-1", { unitCost: 18 }, { userId: "u-1" });
    expect(state).toHaveBeenCalledWith("rest-1", "inv-1", 18, "u-1", "live");
  });

  it.each(["staff", null])("%s is refused, and nothing is stated", async (role) => {
    const { c, state } = controller(role as string | null);
    await expect(c.stateOpeningCost("rest-1", "inv-1", { unitCost: 18 }, { userId: "u-1" })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(state).not.toHaveBeenCalled();
  });

  it("a session naming nobody is refused before the role is read", async () => {
    const { c, state } = controller("owner");
    await expect(c.stateOpeningCost("rest-1", "inv-1", { unitCost: 18 }, undefined)).rejects.toMatchObject({ status: 403 });
    expect(state).not.toHaveBeenCalled();
  });
});
