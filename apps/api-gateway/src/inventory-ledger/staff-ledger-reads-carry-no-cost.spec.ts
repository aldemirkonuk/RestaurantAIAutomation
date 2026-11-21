import { InventoryLedgerController } from "./inventory-ledger.controller";
import { seesLedgerCost } from "./ledger-cost-view";

/**
 * r39 walk-w5 F3: the purchase read answered staff 200 with `unitCost`. Cost
 * on a ledger row is an owner's and a manager's; staff keep every other field
 * (what moved, when, how much), and a role that cannot be read is staff.
 */
const row = (over: Record<string, unknown> = {}) => ({
  id: "t1",
  inventoryId: "i1",
  transactionType: "purchase",
  quantityChange: 6,
  unitCost: 15,
  totalCost: 90,
  orderId: "o1",
  ...over,
});

function controller() {
  const service = {
    listTransactions: jest.fn().mockResolvedValue({ transactions: [row(), row({ id: "t2" })], total: 2, page: 1, limit: 50 }),
    getTransaction: jest.fn().mockResolvedValue(row()),
    getTransactionHistory: jest.fn().mockResolvedValue([row()]),
    reconcileInventory: jest.fn().mockResolvedValue({ count: { id: "c1" }, transaction: row({ transactionType: "adjustment" }) }),
  };
  return new InventoryLedgerController(service as never);
}
const as = (role: string | null | undefined) => ({ userId: "u1", restaurantId: "r1", role });
const hasCost = (x: Record<string, unknown>) => "unitCost" in x || "totalCost" in x;

describe("ledger rows carry cost for owners and managers only", () => {
  it.each(["owner", "manager", " Manager "])("%s sees unitCost and totalCost on the list", async (role) => {
    const res = await controller().listTransactions({} as never, as(role));
    expect(res.transactions.map((t) => [t.unitCost, t.totalCost])).toEqual([[15, 90], [15, 90]]);
  });

  it.each(["staff", "", null, undefined, "unknown"])("%s gets the list without cost, with everything else", async (role) => {
    const res = await controller().listTransactions({} as never, as(role as never));
    expect(res.transactions).toHaveLength(2);
    expect(res.total).toBe(2);
    for (const t of res.transactions) {
      expect(hasCost(t as never)).toBe(false);
      expect(t.quantityChange).toBe(6);
      expect(t.orderId).toBe("o1");
    }
  });

  it("staff get one transaction, the history and a count's transaction without cost", async () => {
    const c = controller();
    expect(hasCost((await c.getTransaction("t1", as("staff"))) as never)).toBe(false);
    expect((await c.getTransactionHistory("i1", 30, as("staff"))).some((t) => hasCost(t as never))).toBe(false);
    const counted = await c.reconcileInventory("i1", { actualCount: 3 }, as("staff"));
    expect(hasCost(counted.transaction as never)).toBe(false);
  });

  it("a manager still reads cost on all of them", async () => {
    const c = controller();
    expect((await c.getTransaction("t1", as("manager"))).unitCost).toBe(15);
    expect((await c.getTransactionHistory("i1", 30, as("manager")))[0].totalCost).toBe(90);
    expect((await c.reconcileInventory("i1", { actualCount: 3 }, as("owner"))).transaction?.unitCost).toBe(15);
  });

  it("a count that changed nothing has no transaction to strip", async () => {
    const c = controller();
    (c as never as { ledgerService: { reconcileInventory: jest.Mock } }).ledgerService.reconcileInventory.mockResolvedValue({ count: { id: "c" }, transaction: null });
    expect((await c.reconcileInventory("i1", { actualCount: 3 }, as("staff"))).transaction).toBeNull();
  });

  it("seesLedgerCost fails closed", () => {
    expect(seesLedgerCost(undefined)).toBe(false);
    expect(seesLedgerCost({})).toBe(false);
    expect(seesLedgerCost({ role: "owner" })).toBe(true);
  });
});
