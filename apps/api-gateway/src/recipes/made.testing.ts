import { FLOUR, HOUSE_A, V_TART_2, line, twoHouses, type Row } from "./dishes.testing";

/**
 * Test-only: the tart takes 40 ml of a house syrup (500 g flour, 700 ml made).
 * Imported only by *.spec.ts.
 */
export const SYRUP = "d0000000-0000-4000-8000-0000000000c1";
export const V_SYRUP = "e0000000-0000-4000-8000-0000000000c1";

export function withSyrup(): Record<string, Row[]> {
  const rows = twoHouses();
  rows.dishes.push({ id: SYRUP, restaurant_id: HOUSE_A, name: "Simple syrup", yield_qty_base: 7000, yield_base_unit: "ml10", deleted_at: null });
  rows.recipe_current_dish.push({ dish_id: SYRUP, version_id: V_SYRUP, restaurant_id: HOUSE_A });
  rows.recipe_versions.push({ id: V_SYRUP, restaurant_id: HOUSE_A, dish_id: SYRUP, owner_kind: "dish", version: 1, yield_serves: 1, created_at: "2026-11-02" });
  rows.recipe_lines = [
    line("s1", V_SYRUP, HOUSE_A, 1, "Sugar", FLOUR, { qty_entered: 500, qty_base: 500_000 }),
    line("t1", V_TART_2, HOUSE_A, 1, "House syrup", null, { role: "made", component_dish_id: SYRUP, qty_entered: 40, unit_code: "ml", qty_base: 400, base_unit: "ml10" }),
  ];
  for (const v of rows.recipe_versions) if (v.id === V_TART_2) v.yield_serves = 1;
  rows.item_nutrition = [];
  rows.item_allergens = [];
  rows.inventory_lot_agreed_cost = [];
  rows.inventory_lot_invoice_cost = [];
  return rows;
}

/** The sugar is priced from partly invoiced stock: 10 kg invoiced beside 90 kg estimated. */
export function partlyInvoiced(rows: Record<string, Row[]>): Record<string, Row[]> {
  rows.restaurant_inventory = rows.restaurant_inventory.map((i) => (i.id === FLOUR ? { ...i, uom: "kg" } : i));
  rows.inventory_lot_rollup = [{ inventory_id: FLOUR, restaurant_id: HOUSE_A, live_qty: 100, wac: 64, has_invoice_cost: true, wac_qty: 100 }];
  rows.inventory_lot_invoice_cost = [{ inventory_id: FLOUR, restaurant_id: HOUSE_A, invoice_wac: 100, invoice_qty: 10, settled_qty: 10, stock_qty: 100 }];
  return rows;
}
