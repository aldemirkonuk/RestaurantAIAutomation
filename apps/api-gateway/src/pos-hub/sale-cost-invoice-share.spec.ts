import { pickSaleCostSource } from "./sale-cost";
import { resolveUnitCost } from "../analytics/inventory-cost";
import { readFileSync } from "fs";
import { join } from "path";

/**
 * r109 invoices: "from checked papers" must mean the bottles were priced off a
 * checked invoice. `has_invoice_cost` is true when ANY live lot is invoiced and
 * an order-delivered lot carries the PO price as 'estimated', so the WAC of a
 * shelf that mixes the two is partial, not checked.
 */
describe("a shelf of one invoiced lot and one estimated lot", () => {
  // 6 bottles at 10.00 (checked invoice) + 60 at 12.00 (PO estimate)
  const rollup = { wac: "11.818182", has_invoice_cost: true, wac_qty: 66, live_qty: 66, invoice_qty: 6 };

  it("is costed as partial, not as invoice_lot_wac", () => {
    expect(resolveUnitCost({ last_purchase_price: null }, rollup).costBasis).toBe("invoice_lot_wac_partial");
    expect(pickSaleCostSource({ last_purchase_price: null }, rollup, [])?.basis).toBe("invoice_lot_wac_partial");
  });

  it("stays invoice_lot_wac when every priced bottle is invoiced", () => {
    expect(resolveUnitCost(null, { ...rollup, invoice_qty: 66 }).costBasis).toBe("invoice_lot_wac");
  });

  it("stays invoice_lot_wac when the caller did not select invoice_qty", () => {
    const { invoice_qty: _omit, ...old } = rollup;
    expect(resolveUnitCost(null, old).costBasis).toBe("invoice_lot_wac");
  });

  it("the till's cost lookup selects invoice_qty", () => {
    const src = readFileSync(join(__dirname, "pos-hub.service.ts"), "utf8");
    expect(src).toMatch(/from\("inventory_lot_rollup"\)\s*\.select\("[^"]*\binvoice_qty\b/);
  });
});
