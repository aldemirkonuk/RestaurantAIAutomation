import { Uom } from "./document-types";
import {
  applyTieOut,
  lineNetFromPrice,
  ParsedDocument,
  ParsedLine,
} from "./parsed-document";

/**
 * BT-149 / BT-150 — the `1 ks × 12 şişe` arithmetic, at the ParsedDocument layer.
 *
 * The single most expensive silent error in beverage receiving is a price stated
 * for one basis and a quantity stated in another. `142,00 / KS(12)` against a
 * quantity of `12 şişe` is 142,00, not 1.704,00; the naive `unitPrice × qty` is
 * wrong by exactly the pack size, and nothing downstream can tell.
 *
 * TWO REAL SHAPES, and they pull in OPPOSITE directions — which is why there is
 * a fixture for each and not one:
 *
 *   A. quantity in CASES, price per case-of-12 ("2 CS @ 264,00 / KS(12)").
 *      Dividing by the base without first converting the quantity into the
 *      base's unit gives 2 ÷ 12 × 264 = 44,00. The packSize conversion is what
 *      makes it 528,00.
 *   B. quantity in BOTTLES, price per case-of-12 ("12 şişe @ 142,00 / KS(12)").
 *      Ignoring the base entirely gives 12 × 142 = 1.704,00. Dividing by it
 *      makes it 142,00.
 *
 * So the rule is: express the quantity in the price base's own unit (via
 * packSize, the only conversion we have), THEN divide by the base quantity.
 * `qtyBottles` is the existing bottle-equivalent and is exactly that conversion.
 */

const line = (o: Partial<ParsedLine>): ParsedLine => {
  const qty = o.qty ?? 0;
  const uom: Uom = o.uom ?? "bottle";
  const packSize = o.packSize ?? 1;
  return {
    lineNo: 1,
    qty,
    uom,
    packSize,
    qtyBottles:
      uom === "case" || uom === "pack" || uom === "split_case"
        ? qty * packSize
        : qty,
    freeGoodsQty: 0,
    priceBaseQty: null,
    priceBaseUom: null,
    ...o,
  };
};

const doc = (lines: ParsedLine[], total: number | null): ParsedDocument => ({
  docType: "invoice",
  currency: "TRY",
  total,
  lines,
  computedLinesTotal: null,
  tieOutDelta: null,
  tiesOut: null,
  confidence: 0.8,
  warnings: [],
});

describe("lineNetFromPrice — BT-149/BT-150", () => {
  it("A. converts a case quantity into the price base's unit before dividing", () => {
    const r = lineNetFromPrice(
      line({
        qty: 2,
        uom: "case",
        packSize: 12,
        unitPrice: 264,
        priceBaseQty: 12,
        priceBaseUom: "bottle",
      }),
    );
    expect(r.problem).toBeNull();
    expect(r.net).toBe(528);
  });

  it("B. divides by the base when the quantity is already in the base's unit", () => {
    const r = lineNetFromPrice(
      line({
        qty: 12,
        uom: "bottle",
        packSize: 12,
        unitPrice: 142,
        priceBaseQty: 12,
        priceBaseUom: "bottle",
      }),
    );
    expect(r.problem).toBeNull();
    expect(r.net).toBe(142);
  });

  it("treats a per-unit price exactly as it did before the base existed", () => {
    expect(
      lineNetFromPrice(line({ qty: 24, uom: "bottle", unitPrice: 22 })).net,
    ).toBe(528);
    expect(
      lineNetFromPrice(
        line({
          qty: 2,
          uom: "case",
          packSize: 12,
          unitPrice: 264,
          priceBaseQty: 1,
        }),
      ).net,
    ).toBe(528);
  });

  it("refuses when the pack size needed for the conversion is not stated", () => {
    // packSize 1 on a CASE line means the document never said how many bottles a
    // case holds. Converting anyway would produce 2 ÷ 12 × 264 = 44,00 — a
    // confident wrong number, which is worse than a refusal.
    const r = lineNetFromPrice(
      line({
        qty: 2,
        uom: "case",
        packSize: 1,
        unitPrice: 264,
        priceBaseQty: 12,
        priceBaseUom: "bottle",
      }),
    );
    expect(r.net).toBeNull();
    expect(r.problem).toMatch(/pack size/i);
  });

  it("refuses a base in a unit that cannot be reconciled with the quantity's", () => {
    const r = lineNetFromPrice(
      line({
        qty: 2,
        uom: "keg",
        unitPrice: 300,
        priceBaseQty: 1,
        priceBaseUom: "bottle",
      }),
    );
    expect(r.net).toBeNull();
    expect(r.problem).toMatch(/keg|reconcile/i);
  });

  it("refuses a base quantity of zero rather than dividing by it", () => {
    const r = lineNetFromPrice(
      line({
        qty: 2,
        uom: "bottle",
        unitPrice: 10,
        priceBaseQty: 0,
        priceBaseUom: "bottle",
      }),
    );
    expect(r.net).toBeNull();
    expect(r.problem).toMatch(/zero|0/);
  });

  it("returns null, not zero, when the document printed no price", () => {
    const r = lineNetFromPrice(line({ qty: 24, uom: "bottle" }));
    expect(r.net).toBeNull();
    expect(r.problem).toBeNull();
  });
});

describe("applyTieOut honours the printed price base", () => {
  it("A. ties out a case-priced line whose quantity is in cases", () => {
    const d = applyTieOut(
      doc(
        [
          line({
            qty: 2,
            uom: "case",
            packSize: 12,
            unitPrice: 264,
            priceBaseQty: 12,
            priceBaseUom: "bottle",
          }),
        ],
        528,
      ),
    );
    expect(d.computedLinesTotal).toBe(528);
    expect(d.tiesOut).toBe(true);
  });

  it("B. ties out a case-priced line whose quantity is in bottles", () => {
    const d = applyTieOut(
      doc(
        [
          line({
            qty: 12,
            uom: "bottle",
            packSize: 12,
            unitPrice: 142,
            priceBaseQty: 12,
            priceBaseUom: "bottle",
          }),
        ],
        142,
      ),
    );
    // Without the base this reads 1.704,00 and the document "fails" to tie out —
    // a false alarm on a perfectly ordinary Turkish invoice.
    expect(d.computedLinesTotal).toBe(142);
    expect(d.tiesOut).toBe(true);
  });

  it("says so when a line's price base could not be applied", () => {
    const d = applyTieOut(
      doc(
        [
          line({
            qty: 2,
            uom: "case",
            packSize: 1,
            unitPrice: 264,
            priceBaseQty: 12,
            priceBaseUom: "bottle",
          }),
        ],
        528,
      ),
    );
    // Silence here is the failure mode: the line would contribute 0 and the
    // tie-out would blame the TOTAL for a problem that is in the line.
    expect(d.warnings.join(" ")).toMatch(/price base/i);
  });

  it("leaves a printed line total alone — transcribe, never compute", () => {
    const d = applyTieOut(
      doc(
        [
          line({
            qty: 12,
            uom: "bottle",
            packSize: 12,
            unitPrice: 142,
            lineTotal: 150,
            priceBaseQty: 12,
            priceBaseUom: "bottle",
          }),
        ],
        150,
      ),
    );
    expect(d.computedLinesTotal).toBe(150);
  });
});
