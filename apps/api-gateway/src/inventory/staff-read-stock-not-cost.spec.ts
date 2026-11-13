import { INTERCEPTORS_METADATA } from "@nestjs/common/constants";
import { lastValueFrom, of } from "rxjs";
import { InventoryController } from "./inventory.controller";
import { InventoryLedgerController } from "../inventory-ledger/inventory-ledger.controller";
import { InventoryService } from "./inventory.service";
import {
  COST_FIELDS,
  WithholdCostFromStaffInterceptor,
  inventoryForRole,
  withholdCost,
} from "./inventory-cost-for-role";

/**
 * r24 walk B1: staff read the house's stock, not what it paid. The inventory
 * and inventory-ledger routes answer a role that does not see money with every
 * cost field null; an owner or a manager reads the body untouched.
 */

/** Every restaurant_inventory column the baseline and later migrations give it. */
const RAW_COLUMNS = [
  "id", "restaurant_id", "master_wine_id", "provider_id", "stock_live", "physical_stock", "shadow_stock",
  "expected_stock", "in_transit_quantity", "threshold_min", "validation_max", "buffer_window_minutes",
  "inventory_state", "last_alerted_at", "last_alert_level", "alert_count", "last_manual_edit_at",
  "last_manual_edit_by", "manual_edit_reason", "custom_price", "last_purchase_price", "negotiated_price",
  "margin_percentage", "sales_velocity_30d", "sales_velocity_7d", "last_sold_at", "times_ordered_count",
  "total_revenue", "expected_delivery_date", "last_delivery_date", "is_active", "menu_section", "menu_position",
  "created_at", "updated_at", "deleted_at", "storage_location_id", "is_optional_tracking", "target_price",
  "max_price", "current_volume_ml", "unit_type", "is_generic_bucket", "velocity_weight", "sku",
  "toast_item_guid", "toast_menu_item_id", "square_item_id", "clover_item_id", "internal_sku", "pos_sku",
  "sku_aliases", "threshold_max", "sale_type", "pour_size_ml", "menu_price_glass", "bottle_size_ml",
  "glasses_per_bottle_override", "wine_name", "menu_price_current", "markup_ratio", "markup_classification",
  "version", "display_name", "identity_id", "kind", "last_counted_at", "pour_size_confirmed_at",
  "pour_size_confirmed_by", "uom",
];

/** One list row exactly as the service maps it, every column filled. */
function listRow(): Record<string, unknown> {
  const raw: Record<string, unknown> = Object.fromEntries(RAW_COLUMNS.map((c) => [c, 7]));
  raw.master_wine_library = { name: "Barolo", bottle_size_ml: 750, retail_price_avg: 55 };
  raw.restaurants = { default_pour_ml: 150, measurement_unit: "ml" };
  const svc = new InventoryService({} as never);
  return (svc as any).mapInventoryItem(
    raw,
    { wac: 41.5, has_invoice_cost: true, live_qty: 12, live_location_count: 1, open_ml: 0 },
    [{ locationId: "z1", qty: 12, wac: 41.5 }],
    { velocity_per_day: 1 },
  );
}

/** What a field name says it holds, for the guard below. */
const MONEY_NAME = /cost|wac|price|premium|margin|markup|hammer|exchange|revenue|value/i;
/** The money a staff member may still read: the selling price, and the market's (not the house's). */
const STAFF_MAY_READ = new Set([
  "menuPriceGlass",
  "menuPriceBottle",
  "menu_price_glass",
  "menu_price_current",
  "retailPriceAvg",
]);

/** Every key path holding a non-null value whose name says money. */
function moneyLeft(body: unknown, path = ""): string[] {
  if (Array.isArray(body)) return body.flatMap((v, i) => moneyLeft(v, `${path}[${i}]`));
  if (body === null || typeof body !== "object") return [];
  return Object.entries(body as Record<string, unknown>).flatMap(([k, v]) => {
    const here = path ? `${path}.${k}` : k;
    const own = MONEY_NAME.test(k) && !STAFF_MAY_READ.has(k) && v !== null && v !== undefined && typeof v !== "object" ? [here] : [];
    return [...own, ...moneyLeft(v, here)];
  });
}

describe("staff read stock, not cost (inventory and inventory-ledger)", () => {
  it("a mapped list row really carries cost, so the guard below has something to find", () => {
    const left = moneyLeft(listRow());
    expect(left).toEqual(expect.arrayContaining(["wac", "last_purchase_price", "locations[0].wac", "markupRatio"]));
  });

  it("staff read no cost field anywhere in a list row, nested locations included", () => {
    const rows = inventoryForRole([listRow()], "staff");
    expect(moneyLeft(rows)).toEqual([]);
    expect(rows[0].wac).toBeNull();
    expect((rows[0].locations as Array<Record<string, unknown>>)[0]).toEqual({ locationId: "z1", qty: 12, wac: null });
  });

  it("staff keep the quantities and the selling price", () => {
    const [row] = inventoryForRole([listRow()], "staff");
    expect(row.stock_live).toBe(7);
    expect(row.shadow_stock).toBe(7);
    expect(row.lotLiveQty).toBe(12);
    expect(row.menuPriceBottle).toBe(7);
    expect(row.menuPriceGlass).toBe(7);
    expect(row.wineName).toBe(7);
  });

  it.each(["owner", "manager", "admin", "Owner"])("a %s reads the body untouched", (role) => {
    const rows = [listRow()];
    expect(inventoryForRole(rows, role)).toBe(rows);
  });

  it.each(["staff", "waiter", null, undefined, ""])("%s reads no cost (no role, or a role without money)", (role) => {
    expect(inventoryForRole({ wac: 3, stock: 2 }, role as string | null | undefined)).toEqual({ wac: null, stock: 2 });
  });

  it("the cost of a later field (#1007's unitCost and costBasis) is withheld by the same names", () => {
    expect(withholdCost({ unitCost: 1.2, costBasis: "agreed_lot_wac", costProvenance: "agreed", costReadable: true })).toEqual({
      unitCost: null,
      costBasis: null,
      costProvenance: null,
      costReadable: true,
    });
  });

  it("a ledger line keeps its movement and loses its cost", () => {
    const line = { id: "t1", quantityChange: 6, quantityBefore: 2, quantityAfter: 8, unitCost: 40, totalCost: 240 };
    expect(withholdCost({ transactions: [line], total: 1 })).toEqual({
      transactions: [{ id: "t1", quantityChange: 6, quantityBefore: 2, quantityAfter: 8, unitCost: null, totalCost: null }],
      total: 1,
    });
  });

  it("an auction lot keeps its house, date and bottles and loses what it was paid", () => {
    const lot = { auctionHouse: "Christie's", saleDate: "2026-10-01", bottles: 6, currency: "GBP", hammerPrice: 900, buyersPremium: 225, exchangeRate: 1.2, houseUnitCost: 225, bookedUnitCost: 225 };
    expect(moneyLeft(withholdCost([lot]))).toEqual([]);
    expect(withholdCost([lot])[0]).toMatchObject({ auctionHouse: "Christie's", bottles: 6, currency: "GBP" });
  });

  it("what is not a plain object passes as it is", () => {
    const d = new Date("2026-11-13T00:00:00Z");
    expect(withholdCost(d)).toBe(d);
    expect(withholdCost("csv,text")).toBe("csv,text");
    expect(withholdCost(null)).toBeNull();
    expect(withholdCost(4)).toBe(4);
  });

  it("every withheld name is a money name the guard knows", () => {
    for (const k of COST_FIELDS) expect(MONEY_NAME.test(k)).toBe(true);
  });
});

describe("the interceptor on the routes", () => {
  function run(role: string | null, body: unknown) {
    const ctx = { switchToHttp: () => ({ getRequest: () => ({ user: role === null ? undefined : { role } }) }) } as never;
    return lastValueFrom(new WithholdCostFromStaffInterceptor().intercept(ctx, { handle: () => of(body) }));
  }

  it("answers staff without cost", async () => {
    expect(await run("staff", [{ id: "i", wac: 4, stock_live: 2 }])).toEqual([{ id: "i", wac: null, stock_live: 2 }]);
  });

  it("answers a session with no user (no role) without cost", async () => {
    expect(await run(null, { wac: 4 })).toEqual({ wac: null });
  });

  it("answers a manager with the very body the route gave", async () => {
    const body = [{ id: "i", wac: 4 }];
    expect(await run("manager", body)).toBe(body);
  });

  it.each([
    ["InventoryController", InventoryController],
    ["InventoryLedgerController", InventoryLedgerController],
  ])("%s carries it, so no route on it answers staff with cost", (_name, ctrl) => {
    const interceptors = Reflect.getMetadata(INTERCEPTORS_METADATA, ctrl) ?? [];
    expect(interceptors).toContain(WithholdCostFromStaffInterceptor);
  });
});
