import { readBookedOrderBottles } from "./booked-order-quantity";

function ledger(rows: any[], error: any = null) {
  const filters: Record<string, any> = {};
  const ranges: number[][] = [];
  const q: any = {
    select: () => q,
    eq: (key: string, value: any) => {
      filters[key] = value;
      return q;
    },
    order: () => q,
    range: async (start: number, end: number) => {
      ranges.push([start, end]);
      return {
        data: rows
          .filter((row) =>
            Object.entries(filters).every(([key, value]) => row[key] === value),
          )
          .slice(start, end + 1),
        error,
      };
    },
  };
  return { db: { from: () => q }, ranges };
}
const movement = {
  restaurant_id: "r1",
  order_id: "o1",
  inventory_id: "i1",
  stock_type: "live",
  quantity_change: 1,
};

it("sums every receipt page, excludes other houses/items/orders and shadow stock", async () => {
  const test = ledger([
    ...Array.from({ length: 501 }, () => ({ ...movement })),
    { ...movement, quantity_change: -2 },
    { ...movement, restaurant_id: "r2", quantity_change: 900 },
    { ...movement, inventory_id: "i2", quantity_change: 900 },
    { ...movement, order_id: "o2", quantity_change: 900 },
    { ...movement, stock_type: "shadow", quantity_change: 900 },
  ]);
  await expect(readBookedOrderBottles(test.db, "r1", "o1", "i1")).resolves.toBe(
    499,
  );
  expect(test.ranges).toHaveLength(2);
});
it("can reconcile a first door count without re-subtracting its own replayed movement", async () => {
  const test = ledger([
    {
      ...movement,
      quantity_change: 60,
      idempotency_key: "order-delivered-live:o1",
    },
    { ...movement, quantity_change: -2, idempotency_key: "door-receipt:e1" },
  ]);
  await expect(
    readBookedOrderBottles(test.db, "r1", "o1", "i1", true),
  ).resolves.toBe(60);
});
it("refuses a ledger read fault rather than treating it as zero", async () => {
  await expect(
    readBookedOrderBottles(
      ledger([], { message: "offline" }).db,
      "r1",
      "o1",
      "i1",
    ),
  ).rejects.toThrow(/could not be read/);
});
