import {
  QUANTITY_RECEIVED_UNIT_UNSTATED,
  readQuantityReceived,
} from "./quantity-received-unit";
import { ORDER_UNIT_TYPES } from "./order-units";
import { toBottles, normalizeUom } from "./documents/document-types";

/**
 * `procurement_orders.quantity_received` states its unit, or refuses to.
 *
 * THE CASES, AND WHY EACH ONE EXISTS:
 *
 *  * EVERY unit in the vocabulary, driven from `ORDER_UNIT_TYPES` rather than
 *    from a hand-typed list — a unit added to the CHECK constraint and not to
 *    this module would otherwise pass through unexamined.
 *  * THE RULE PROVED AGAINST THE ARITHMETIC, not against itself. The claim is
 *    "the two writers agree exactly when the unit does not multiply", so the
 *    test asks `toBottles` — the door's own converter — whether one unit is one
 *    bottle, and requires the module's answer to match. If someone changes
 *    `toBottles` to multiply kegs, this fails; a hard-coded list would not.
 *  * AN UNRECOGNISED UNIT is refused rather than defaulted, and an ABSENT one
 *    is `bottle`. Those are opposite answers to two things that look alike, and
 *    ADR 0011 is why.
 *  * THE VALUE and the UNIT are read independently: a null count still gets a
 *    unit reading, and a countable value still gets refused on a case order.
 *  * `null` IS NOT `0`. The whole reason mobile could not use this column is
 *    that its absence looked like a number.
 */

describe("readQuantityReceived", () => {
  it("states the order's own unit whenever that unit does not multiply", () => {
    for (const unit of ORDER_UNIT_TYPES) {
      const oneUnitInBottles = toBottles(1, unit, 12);
      const multiplies = oneUnitInBottles !== 1;
      const read = readQuantityReceived(7, unit);

      // The claim under test, stated against the converter rather than against
      // a list this file also wrote.
      expect(read.uom).toBe(multiplies ? null : unit);
      expect(read.quantity).toBe(7);
      expect(read.why).not.toBe("");
    }
  });

  it("refuses case, pack and split_case by name, with the printable sentence", () => {
    for (const unit of ["case", "pack", "split_case"]) {
      const read = readQuantityReceived(36, unit);
      expect(read.uom).toBeNull();
      expect(read.why).toBe(QUANTITY_RECEIVED_UNIT_UNSTATED);
      // The number is still handed over. The refusal is about the UNIT — a
      // screen may say "36 recorded, unit unknown"; it may not pre-fill a count.
      expect(read.quantity).toBe(36);
    }
  });

  it("reads an absent unit as bottles and an unreadable one as a refusal", () => {
    // ABSENT is the identity of this arithmetic and the column's own default
    // (`unit_type` defaults to 'bottles' in the baseline), so it cannot produce
    // the silent multiplication the rule exists to prevent.
    for (const absent of [null, undefined, "", "   "]) {
      expect(readQuantityReceived(4, absent as any).uom).toBe("bottle");
    }
    // PRESENT-BUT-UNREADABLE is the opposite answer: "bxs" could mean anything.
    const bad = readQuantityReceived(4, "bxs");
    expect(bad.uom).toBeNull();
    expect(bad.why).toContain('"bxs"');
    expect(bad.why).toContain(QUANTITY_RECEIVED_UNIT_UNSTATED);
  });

  it("folds the spellings the column actually holds", () => {
    // The baseline's default is the PLURAL 'bottles'; `normalizeUom` folds it,
    // and this asserts the module goes through that folding rather than
    // comparing raw strings.
    expect(normalizeUom("bottles")).toBe("bottle");
    expect(readQuantityReceived(4, "bottles").uom).toBe("bottle");
    expect(readQuantityReceived(4, " CASES ").uom).toBeNull();
    expect(readQuantityReceived(4, "Each").uom).toBe("each");
  });

  it("keeps an empty column as null, never as a zero anybody counted", () => {
    expect(readQuantityReceived(null, "bottle").quantity).toBeNull();
    expect(readQuantityReceived(undefined, "bottle").quantity).toBeNull();
    // A genuine zero survives as a zero: somebody received none of it.
    expect(readQuantityReceived(0, "bottle").quantity).toBe(0);
    // And garbage is null rather than NaN, which would serialise to `null`
    // anyway but compare as neither equal nor unequal to anything on the way.
    expect(readQuantityReceived("not a number", "bottle").quantity).toBeNull();
    expect(readQuantityReceived("12", "bottle").quantity).toBe(12);
  });

  it("reads the value and the unit independently", () => {
    // A null count on a case order: no number AND no unit.
    const both = readQuantityReceived(null, "case");
    expect(both.quantity).toBeNull();
    expect(both.uom).toBeNull();
    // A count on a bottle order: both.
    const neither = readQuantityReceived(9, "bottle");
    expect(neither.quantity).toBe(9);
    expect(neither.uom).toBe("bottle");
  });
});
