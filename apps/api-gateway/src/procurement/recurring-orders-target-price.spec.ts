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
