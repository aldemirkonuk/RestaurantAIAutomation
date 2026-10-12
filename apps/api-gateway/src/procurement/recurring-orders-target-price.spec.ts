import { RecurringOrdersController } from "./recurring-orders.controller";

/**
 * F-1388: the legacy GET /recurring-orders reads handed every member the
 * house's `target_price`, a cost figure staff never read elsewhere
 * (HOUSE_COST_KEYS, ADR 0145). Both reads now leave it out for a role that
 * does not hold the house's money, and say so.
 */

const row = () => ({
  id: "ro1",
  restaurant_id: "r1",
  wine_name: "Barolo",
  quantity: 6,
  frequency: "weekly",
  target_price: 42.5,
});

const controllerWith = () =>
  new RecurringOrdersController({
    listRecurringOrders: jest.fn(async () => [row()]),
    getRecurringOrder: jest.fn(async () => row()),
    createRecurringOrder: jest.fn(async () => row()),
    updateRecurringOrder: jest.fn(async () => row()),
  } as any);

describe("legacy recurring-order reads and the house's target price (F-1388)", () => {
  it("leaves target_price out of the list and the single read for staff", async () => {
    const c = controllerWith();
    const [listed]: any[] = await c.list("r1", { role: "staff" });
    const one: any = await c.getOne("r1", "ro1", { role: "staff" });
    for (const r of [listed, one]) {
      expect("target_price" in r).toBe(false);
      expect(r.amountsWithheld).toBe(true);
      expect(r.quantity).toBe(6);
    }
  });

  it("fails closed for a reader with no role", async () => {
    const one: any = await controllerWith().getOne("r1", "ro1", {});
    expect("target_price" in one).toBe(false);
  });

  it("keeps target_price for an owner or a manager", async () => {
    for (const role of ["owner", "manager"]) {
      const c = controllerWith();
      const [listed]: any[] = await c.list("r1", { role });
      const one: any = await c.getOne("r1", "ro1", { role });
      expect(listed.target_price).toBe(42.5);
      expect(one.target_price).toBe(42.5);
      expect(one.amountsWithheld).toBeUndefined();
    }
  });
});

describe("legacy recurring-order writes and the house's target price (F-1441)", () => {
  it("does not echo target_price back to staff from POST or PUT", async () => {
    const c = controllerWith();
    const made: any = await c.create("r1", { wine_name: "Barolo" } as any, {
      userId: "u1",
      restaurantId: "r1",
      role: "staff",
    });
    const changed: any = await c.update("r1", "ro1", { notes: "x" } as any, {
      role: "staff",
    });
    for (const r of [made, changed]) {
      expect("target_price" in r).toBe(false);
      expect(r.amountsWithheld).toBe(true);
      expect(r.quantity).toBe(6);
    }
  });

  it("drops a price staff send, so the owner's figure stays", async () => {
    const service = {
      createRecurringOrder: jest.fn(async () => row()),
      updateRecurringOrder: jest.fn(async () => row()),
    };
    const c = new RecurringOrdersController(service as any);
    await c.update("r1", "ro1", { target_price: 1, notes: "x" } as any, {
      role: "staff",
    });
    await c.create("r1", { wine_name: "Barolo", target_price: 1 } as any, {
      userId: "u1",
      restaurantId: "r1",
      role: "staff",
    });
    const patch: any = (service.updateRecurringOrder.mock.calls[0] as any[])[2];
    const made: any = (service.createRecurringOrder.mock.calls[0] as any[])[2];
    expect("target_price" in patch).toBe(false);
    expect(patch.notes).toBe("x");
    expect("target_price" in made).toBe(false);
  });

  it("keeps the price on an owner's or manager's write and reply", async () => {
    for (const role of ["owner", "manager"]) {
      const service = {
        updateRecurringOrder: jest.fn(async () => row()),
      };
      const c = new RecurringOrdersController(service as any);
      const changed: any = await c.update(
        "r1",
        "ro1",
        { target_price: 40 } as any,
        { role },
      );
      expect(changed.target_price).toBe(42.5);
      expect((service.updateRecurringOrder.mock.calls[0] as any[])[2]).toEqual({
        target_price: 40,
      });
    }
  });
});
