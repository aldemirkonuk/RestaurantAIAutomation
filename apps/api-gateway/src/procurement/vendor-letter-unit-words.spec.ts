import { describeConfirmedOrderTerms } from "./procurement.service";
import {
  describeAgreedPrice,
  oneUnitWord,
  perUnitWords,
  unitCountWords,
} from "./agreed-price";

/**
 * The order confirmation a vendor receives says its units in words.
 *
 * `procurement_orders.unit_type` and `procurement_order_items.price_uom` store
 * `split_case` and `each`. The letter printed the code as it came: "3
 * split_cases of …  at ₺120.00 per split_case", "5 eachs", "₺4.00 per each",
 * and "how many bottles are in a split_case". A supplier read a column value
 * (2026-11-13 audit, r21). Every other unit's sentence is unchanged, which the
 * last case pins.
 */

const WINE = "Kalecik Karası";
const CODE = /split_case|\beachs\b|per each/;

describe("the vendor's order confirmation says each unit in words", () => {
  it("split cases with a stated per-split-case price", () => {
    const s = describeConfirmedOrderTerms({
      quantity: 3,
      unitType: "split_case",
      bottlesPerUnit: 6,
      wineName: WINE,
      finalPrice: 120,
      statedPriceUnit: { priceUom: "split_case", pricePackSize: 6 },
      currency: "TRY",
    });
    expect(s).toBe(
      `We'd like to confirm our order: 3 split cases (6 bottles each) of ${WINE} at ₺120.00 per split case (6 bottles).`,
    );
  });

  it("split cases with no stated unit, and no known pack", () => {
    const s = describeConfirmedOrderTerms({
      quantity: 1,
      unitType: "split_case",
      bottlesPerUnit: null,
      wineName: WINE,
      finalPrice: 120,
      currency: "TRY",
    });
    expect(s).toBe(
      `We'd like to confirm our order: 1 split case of ${WINE} at ₺120.00 per split case.` +
        " Our records do not state how many bottles are in a split case, so please confirm the pack size.",
    );
    expect(s).not.toMatch(/split_case/);
  });

  it("an order counted each is a plain count, priced each", () => {
    const s = describeConfirmedOrderTerms({
      quantity: 5,
      unitType: "each",
      bottlesPerUnit: null,
      wineName: WINE,
      finalPrice: 4,
      statedPriceUnit: { priceUom: "each", pricePackSize: 1 },
      currency: "TRY",
    });
    // A single item holds no pack, so the letter neither brackets one nor asks.
    expect(s).toBe(`We'd like to confirm our order: 5 of ${WINE} at ₺4.00 each.`);
  });

  it("the stated price alone never says per each or per split_case", () => {
    expect(describeAgreedPrice({ price: 4, stated: { priceUom: "each", pricePackSize: 1 } })).toBe(
      "4.00 each",
    );
    expect(
      describeAgreedPrice({ price: 120, stated: { priceUom: "split_case", pricePackSize: 6 } }),
    ).toBe("120.00 per split case (6 bottles)");
  });

  it("the helpers", () => {
    expect(perUnitWords("split_case")).toBe("per split case");
    expect(perUnitWords("each")).toBe("each");
    expect(unitCountWords(5, "each")).toBe("5");
    expect(unitCountWords(1, "split_case")).toBe("1 split case");
    expect(oneUnitWord("split_case")).toBe("split case");
  });

  it("every other unit's sentence is what it was", () => {
    for (const unit of ["bottle", "case", "keg", "pack", "liter"]) {
      const s = describeConfirmedOrderTerms({
        quantity: 2,
        unitType: unit,
        bottlesPerUnit: unit === "bottle" ? 1 : 12,
        wineName: WINE,
        finalPrice: 10,
        currency: "TRY",
      });
      const pack = unit === "bottle" ? "" : " (12 bottles each)";
      expect(s).toBe(
        `We'd like to confirm our order: 2 ${unit}s${pack} of ${WINE} at ₺10.00 per ${unit}.`,
      );
      expect(s).not.toMatch(CODE);
    }
  });
});
