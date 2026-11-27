import { AnalyticsService } from "./analytics.service";
import { WholeReadError } from "../common/read-whole-window";
import { CappedRow, cappedPostgrest } from "../common/testing/capped-postgrest";

/**
 * Reports lane r3: the inventory, lot and order readers behind the reports
 * desk read past PostgREST's 1,000 rows, or refuse. They used to stop at the
 * thousandth row and value, turn and sum the slice.
 *
 * `cappedPostgrest` answers as PostgREST does (1,000 rows a response at
 * most). Unranged, every reader below returned 1,000 rows from it.
 */

type Row = CappedRow;
const HOUSE = "house-1";
const postgrest = cappedPostgrest;

const pad = (i: number) => String(i).padStart(5, "0");
const N = 2345;
const inventory: Row[] = [
  ...Array.from({ length: N }, (_, i) => ({
    id: `inv-${pad(i)}`,
    restaurant_id: HOUSE,
    is_active: true,
    wine_name: `Wine ${i}`,
    stock_live: 0,
    menu_price_current: 40,
    last_purchase_price: null,
    threshold_min: 1,
    master_wine_id: `mw-${pad(i)}`,
    master_wine_library: { primary_type: "red" },
  })),
  // Not this house's, and not active: never read.
  { id: "inv-other", restaurant_id: "house-2", is_active: true, master_wine_id: "mw-x" },
  { id: "inv-gone", restaurant_id: HOUSE, is_active: false, master_wine_id: "mw-y" },
];
const rollup: Row[] = [
  ...inventory
    .filter((i) => i.restaurant_id === HOUSE && i.is_active)
    .map((i) => ({ inventory_id: i.id, restaurant_id: HOUSE, master_wine_id: i.master_wine_id, live_qty: 2, wac: 10, has_invoice_cost: true, wac_qty: 2 })),
  // The view's key is not unique: a lot with no inventory row, and a lot
  // whose wine differs from its inventory row's. Neither refuses the read.
  { inventory_id: null, restaurant_id: HOUSE, master_wine_id: "mw-loose", live_qty: 9, wac: 1, has_invoice_cost: true, wac_qty: 9 },
  { inventory_id: "inv-00007", restaurant_id: HOUSE, master_wine_id: "mw-stray", live_qty: 2, wac: 10, has_invoice_cost: true, wac_qty: 2 },
];
const day = (i: number) => `2026-0${1 + (i % 9)}-${String(1 + (i % 28)).padStart(2, "0")}T12:00:00Z`;
const orders: Row[] = Array.from({ length: 1500 }, (_, i) => ({
  id: `ord-${pad(i)}`,
  restaurant_id: HOUSE,
  provider_id: `v${i % 7}`,
  providers: { name: `Vendor ${i % 7}` },
  status: "DELIVERED",
  total_cost: 10,
  final_price: 10,
  bottles_total: 1,
  quantity: 1,
  created_at: day(i),
  delivered_at: day(i),
}));

const tables = () => ({ restaurant_inventory: inventory, inventory_lot_rollup: rollup, procurement_orders: orders });
const db = (c: unknown) => ({ getClient: () => c }) as any;

describe("the analytics readers read past 1,000 rows, or refuse (reports lane r3)", () => {
  beforeAll(() => jest.useFakeTimers({ now: new Date("2026-10-01T12:00:00Z"), doNotFake: ["nextTick", "setImmediate"] }));
  afterAll(() => jest.useRealTimers());

  it("values every active row of a 2,345-row cellar on its own lots", async () => {
    const rows: Row[] = await (new AnalyticsService(db(postgrest(tables()))) as any).loadInventory(HOUSE);
    expect(rows).toHaveLength(N);
    expect(rows.every((r) => r.qty === 2 && r.unitCost === 10 && r.inventoryValue === 20)).toBe(true);
    expect(rows.reduce((a, r) => a + r.inventoryValue, 0)).toBe(N * 20);
  });

  it("refuses the cellar when a later page fails, rather than valuing the first thousand", async () => {
    const c = postgrest(tables(), (t, n) => t === "restaurant_inventory" && n === 2);
    await expect((new AnalyticsService(db(c)) as any).loadInventory(HOUSE)).rejects.toBeInstanceOf(WholeReadError);
  });

  it("refuses the cellar when a lot batch fails, rather than costing rows on their last price", async () => {
    const c = postgrest(tables(), (t, n) => t === "inventory_lot_rollup" && n === 5);
    await expect((new AnalyticsService(db(c)) as any).loadInventory(HOUSE)).rejects.toThrow(/lot totals could not be read whole/);
  });

  it("sums a year of 1,500 delivered orders", async () => {
    const rows: Row[] = await (new AnalyticsService(db(postgrest(tables()))) as any).loadDeliveredOrders(HOUSE, 365);
    expect(rows).toHaveLength(1500);
  });
});
