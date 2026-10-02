import { applyTieOut, ParsedDocument } from "./parsed-document";

/**
 * Regression for receipts-audit.md BLOCKER 1: editLine recomputes the
 * tie-out through applyTieOut with a MINIMAL cast object. applyTieOut
 * spreads `doc.warnings` on the does-not-tie-out branch, so a cast that
 * omitted it threw `TypeError: undefined is not iterable` precisely when an
 * edit BROKE the tie-out — after the line had already been written. This
 * spec pins the exact shape editLine builds (charges + lines + warnings and
 * nothing else) against both branches.
 */
function editLineCast(over: Partial<Record<string, unknown>>): ParsedDocument {
  return {
    total: 100,
    freight: null,
    fuelSurcharge: null,
    splitCaseFee: null,
    deliveryFee: null,
    depositTotal: null,
    tax: null,
    otherCharges: null,
    discountTotal: null,
    lines: [{ qty: 2, unitPrice: 50, lineTotal: 100, allowance: null }],
    warnings: [],
    ...over,
  } as unknown as ParsedDocument;
}

describe("editLine's applyTieOut cast", () => {
  it("survives the does-not-tie-out branch (the audit's crash path)", () => {
    const out = applyTieOut(editLineCast({ lines: [{ qty: 1, unitPrice: 40, lineTotal: 40, allowance: null }] }));
    expect(out.tiesOut).toBe(false);
    expect(out.tieOutDelta).toBe(60);
    expect(out.warnings.length).toBe(1);
  });

  it("ties out within tolerance on matching lines", () => {
    const out = applyTieOut(editLineCast({}));
    expect(out.tiesOut).toBe(true);
    expect(out.tieOutDelta).toBe(0);
  });

  it("a missing stated total is untestable, never a failure", () => {
    const out = applyTieOut(editLineCast({ total: null }));
    expect(out.tiesOut).toBeNull();
    expect(out.tieOutDelta).toBeNull();
  });
});

/**
 * RECEIPTS-W5 (founder walk-through, 2026-10-01): a document that prints its
 * tax only as a VAT breakdown row read as "off by" exactly that tax, because
 * the tie-out added `tax` (null) and never looked at the breakdown.
 */
describe("a tax stated only in the VAT breakdown", () => {
  const breakdown = (amounts: Array<number | null>) =>
    amounts.map((amount) => ({ rate: 8.625, taxableBase: 100, amount }));

  it("ties out when the breakdown carries the tax the header left empty", () => {
    const out = applyTieOut(
      editLineCast({ total: 108.63, taxBreakdown: breakdown([8.63]) }),
    );
    expect(out.tiesOut).toBe(true);
    expect(out.tieOutDelta).toBe(0);
  });

  it("never counts the tax twice when the header has it too", () => {
    const out = applyTieOut(
      editLineCast({ total: 108.63, tax: 8.63, taxBreakdown: breakdown([8.63]) }),
    );
    expect(out.tieOutDelta).toBe(0);
  });

  it("a breakdown row with no amount is partial, so it is not used", () => {
    const out = applyTieOut(
      editLineCast({ total: 108.63, taxBreakdown: breakdown([8.63, null]) }),
    );
    expect(out.tiesOut).toBe(false);
    expect(out.tieOutDelta).toBe(8.63);
  });
});
