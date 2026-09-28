/**
 * ADR 0119 phase 2 — the header price is generated, the history carries a unit,
 * fees have columns, a split case is its own line.
 *
 * Four founder decisions of 2026-09-05, one file of proof:
 *
 *   Q2  `procurement_orders.final_price` follows the line and cannot disagree
 *       with it. The database half is
 *       `20260905072000_the_header_price_echoes_the_line.sql` (a trigger pair —
 *       Postgres cannot GENERATE a column from another table, measured); the
 *       code half is `confirmDeal` writing the LINE.
 *   Q3  `allowance`, `deposit`, `freight` on the agreement line, and the total
 *       prints its working.
 *   Q4  `price_history` carries a STATED unit; nothing is converted on the way
 *       in, and an unstated agreement does not enter the series.
 *   Q6  a split case is its own agreement line, never a surcharge on the case
 *       line.
 *
 * HOW THE PRE-FIX PROOF IS DONE HERE
 * ----------------------------------
 * Nothing is reverted — this worktree is shared, and `git stash` wiped 73 files
 * from it on 2026-09-04. The pre-fix behaviours below are TRANSCRIBED VERBATIM
 * from copies made with
 *   `git show HEAD:<path> > /Users/aldemirkonuk/Projects/p4-scratch/prefix-phase2/<name>.prefix.ts`
 * at `611f7682`, and the line numbers cited are that copy's:
 *
 *   * `preFixPriceHistoryRow`   — `procurement.service.prefix.ts:1160-1205`
 *                                 (the `perBottleFromAgreedPrice` division, and
 *                                 the hardcoded `unit: "BOTTLE"`).
 *   * `preFixDoorPoUnitPrice`   — `procurement.service.prefix.ts:3453-3457`
 *                                 (the header, straight into a field
 *                                 `invoice-match.ts` documents PER BOTTLE).
 *   * `preFixConfirmDealWrites` — `procurement.service.prefix.ts:5205-5209`
 *                                 (`update.final_price = finalPrice`, with no
 *                                 write to the line at all).
 *
 * Where a function is UNCHANGED by this pass it is used live in both
 * directions, which is stronger than a transcription: `agreedOrderTotal` and
 * `resolveStatedPriceUnit` are the pre-fix behaviour, still in the tree, and
 * the new functions are asserted beside them.
 */

import {
  agreedOrderTotal,
  agreedPricePerBottleForDoor,
  agreementLineTotal,
  hasStatedFees,
  priceSeriesUnit,
  readAgreementFees,
  resolveStatedPriceUnit,
  splitCaseOwnLineRefusal,
  type AgreementFees,
  type StatedPriceUnit,
} from "./agreed-price";

const CASE_OF_12: StatedPriceUnit = { priceUom: "case", pricePackSize: 12 };
const PER_BOTTLE: StatedPriceUnit = { priceUom: "bottle", pricePackSize: 1 };
const PER_KEG: StatedPriceUnit = { priceUom: "keg", pricePackSize: 1 };

const NO_FEES: AgreementFees = {
  allowance: null,
  deposit: null,
  freight: null,
};

// ---------------------------------------------------------------------------
// The pre-fix tree, transcribed. Nothing here is imported from the working copy.
// ---------------------------------------------------------------------------

/**
 * `procurement.service.prefix.ts:1160-1205` at `611f7682` — what the row that
 * reached `price_history` actually held.
 */
function preFixPriceHistoryRow(input: {
  price: number;
  stated: StatedPriceUnit | null;
}): { price: number; unit: string } | null {
  let price = Number(input.price);
  if (input.stated) {
    // `perBottleFromAgreedPrice`, which refused an OPAQUE unit outright.
    if (input.stated.priceUom === "keg" || input.stated.priceUom === "liter") {
      return null;
    }
    price =
      input.stated.pricePackSize === 1
        ? price
        : Math.round((price / input.stated.pricePackSize) * 10000) / 10000;
  }
  if (!Number.isFinite(price) || price <= 0) return null;
  return { price: Math.round(price * 100) / 100, unit: "BOTTLE" };
}

/** `procurement.service.prefix.ts:3453-3457` at `611f7682`. */
function preFixDoorPoUnitPrice(orderRow: {
  final_price?: number | null;
  negotiated_price?: number | null;
  quoted_price?: number | null;
}): number | null {
  return (
    orderRow.final_price ??
    orderRow.negotiated_price ??
    orderRow.quoted_price ??
    null
  );
}

/** `procurement.service.prefix.ts:5205-5209` at `611f7682`. */
function preFixConfirmDealWrites(finalPrice: number | null): {
  header: Record<string, unknown>;
  line: Record<string, unknown> | null;
} {
  const header: Record<string, unknown> = {};
  if (finalPrice != null) {
    header.negotiated_price = finalPrice;
    header.final_price = finalPrice;
  }
  return { header, line: null };
}

// ===========================================================================
// Q4 — the price series states its unit
// ===========================================================================
describe("Q4 — price_history carries the unit the price was quoted in", () => {
  it("records a case price AS a case price, where the pre-fix tree divided it", () => {
    // $420 per case of 12, agreed.
    const before = preFixPriceHistoryRow({ price: 420, stated: CASE_OF_12 });
    expect(before).toEqual({ price: 35, unit: "BOTTLE" });

    const after = priceSeriesUnit({ kind: "stated", stated: CASE_OF_12 });
    expect(after.ok).toBe(true);
    if (!after.ok) throw new Error("unreachable");
    expect(after.unit).toBe("case");
    // The number is untouched — the writer inserts `args.price` unchanged now.
    expect(after.note).toContain("not converted");
  });

  it("takes a keg price, which the pre-fix tree refused outright", () => {
    expect(preFixPriceHistoryRow({ price: 180, stated: PER_KEG })).toBeNull();

    const after = priceSeriesUnit({ kind: "stated", stated: PER_KEG });
    expect(after.ok).toBe(true);
    if (!after.ok) throw new Error("unreachable");
    expect(after.unit).toBe("keg");
  });

  it("REFUSES an agreement that states no unit, where the pre-fix tree filed it as a bottle", () => {
    // This is the reversal, and it is the whole of Q4 in one assertion: before,
    // a price nobody had given a unit to entered a per-bottle series anyway.
    expect(preFixPriceHistoryRow({ price: 38, stated: null })).toEqual({
      price: 38,
      unit: "BOTTLE",
    });

    const after = priceSeriesUnit({ kind: "unstated" });
    expect(after.ok).toBe(false);
    if (after.ok) throw new Error("unreachable");
    expect(after.reason).toContain("states no unit for its price");
  });

  it("writes lowercase, the one vocabulary the CHECK accepts", () => {
    // `price_history_unit_check` accepts the seven singulars and nothing else,
    // so the old `'BOTTLE'` spelling would now be a 23514 rather than a second
    // series nothing joins to.
    const after = priceSeriesUnit({
      kind: "bottle_equivalent",
      because: "computeMatch converted every document to bottle-equivalents.",
    });
    expect(after.ok).toBe(true);
    if (!after.ok) throw new Error("unreachable");
    expect(after.unit).toBe("bottle");
    expect(after.unit).not.toBe("BOTTLE");
    // The reason travels onto the row, so the claim is auditable rather than
    // asserted.
    expect(after.note).toContain("bottle-equivalents");
  });

  it("keeps a per-bottle agreement recording exactly what it recorded before", () => {
    const before = preFixPriceHistoryRow({ price: 38, stated: PER_BOTTLE });
    const after = priceSeriesUnit({ kind: "stated", stated: PER_BOTTLE });
    expect(before?.price).toBe(38);
    expect(after.ok && after.unit).toBe("bottle");
  });
});

// ===========================================================================
// Q3 — the money outside the price is named, and the total shows its working
// ===========================================================================
describe("Q3 — allowance, deposit and freight are named on the agreement", () => {
  const fiveCasesOfTwelve = {
    price: 420,
    stated: CASE_OF_12,
    bottlesTotal: 60,
    quantity: 5,
    unitType: "case" as const,
    opaque: false,
  };

  it("totals goods only when no fee is stated — byte for byte the pre-fix figure", () => {
    const before = agreedOrderTotal(fiveCasesOfTwelve);
    const after = agreementLineTotal({ ...fiveCasesOfTwelve, fees: NO_FEES });
    expect(before.ok && before.total).toBe(2100);
    expect(after.ok && after.total).toBe(2100);
    // Not merely the same number: the same SENTENCE, so no row's working
    // changes for an agreement that names no fee.
    expect(after.ok && after.working).toBe(before.ok ? before.note : null);
  });

  it("deducts an allowance and adds a deposit and freight, in that order", () => {
    const after = agreementLineTotal({
      ...fiveCasesOfTwelve,
      fees: { allowance: 100, deposit: 30, freight: 48 },
    });
    expect(after.ok).toBe(true);
    if (!after.ok) throw new Error("unreachable");
    expect(after.goods).toBe(2100);
    expect(after.total).toBe(2078);
    expect(after.working).toContain("Goods $2100.00");
    expect(after.working).toContain("less allowance $100.00");
    expect(after.working).toContain("plus deposit $30.00");
    expect(after.working).toContain("plus freight $48.00");
    // And it STOPS there: every caller prints the figure itself, and a working
    // that carried the total printed it twice on the ledger row.
    expect(after.working).not.toContain("= $2078.00");
    expect(after.working.trim().endsWith("plus freight $48.00.")).toBe(true);
  });

  it("keeps the goods figure separately, so a fee can never be read as a price rise", () => {
    const after = agreementLineTotal({
      ...fiveCasesOfTwelve,
      fees: { allowance: null, deposit: 30, freight: null },
    });
    if (!after.ok) throw new Error("unreachable");
    // The pre-fix tree had nowhere to put the $30, so a desk that wanted it
    // recorded had to raise the unit price — $2130 / 60 bottles = $35.50, a
    // permanent price rise on a deposit that will be refunded.
    expect(after.goods).toBe(2100);
    expect(after.total).toBe(2130);
    expect(after.goods / 60).toBeCloseTo(35, 10);
  });

  it("tells an unstated fee from a stated zero, both ways", () => {
    expect(readAgreementFees({ deposit: null })).toEqual(NO_FEES);
    expect(readAgreementFees({ deposit: 0 }).deposit).toBe(0);
    expect(hasStatedFees(readAgreementFees({ deposit: 0 }))).toBe(true);
    expect(hasStatedFees(readAgreementFees({ deposit: null }))).toBe(false);
    // A stated zero really is a claim, and it prints as one.
    const zero = agreementLineTotal({
      ...fiveCasesOfTwelve,
      fees: { allowance: null, deposit: 0, freight: null },
    });
    expect(zero.ok && zero.working).toContain("plus deposit $0.00");
  });

  it("reads a garbled fee as ABSENT rather than as zero", () => {
    // "$0.00 of deposit was agreed" is a claim about a vendor. A typo is not.
    expect(readAgreementFees({ deposit: "not a number" }).deposit).toBeNull();
    expect(readAgreementFees({ freight: -5 }).freight).toBeNull();
    expect(readAgreementFees({ allowance: "25.00" }).allowance).toBe(25);
  });

  it("refuses the uncountable order before it applies any fee", () => {
    // A fee cannot rescue a total that has no goods figure: the refusal is the
    // answer, not $0 plus freight.
    const after = agreementLineTotal({
      price: 180,
      stated: PER_KEG,
      bottlesTotal: 60,
      quantity: 5,
      unitType: "case",
      opaque: false,
      fees: { allowance: null, deposit: null, freight: 48 },
    });
    expect(after.ok).toBe(false);
    if (after.ok) throw new Error("unreachable");
    expect(after.reason).toBe("price_unit_not_countable");
  });
});

// ===========================================================================
// Q6 — a split case is its own line
// ===========================================================================
describe("Q6 — a split case is its own agreement line", () => {
  it("refuses whole cases quoted at a split-case price", () => {
    // PRE-FIX: nothing anywhere refused this. `resolveStatedPriceUnit` is
    // UNCHANGED by this pass and still accepts the pair on its own terms —
    // which is the point: the pair was never the problem, the pairing with a
    // case QUANTITY was, and no code looked at the two together.
    const pair = resolveStatedPriceUnit({
      priceUom: "split_case",
      pricePackSize: 6,
    });
    expect(pair.ok).toBe(true);

    const refusal = splitCaseOwnLineRefusal({
      priceUom: "split_case",
      unitType: "case",
    });
    expect(refusal).not.toBeNull();
    expect(refusal).toContain("its own price");
    expect(refusal).toContain("never a surcharge on the case line");
  });

  it("refuses a split case quoted at the full case price", () => {
    expect(
      splitCaseOwnLineRefusal({ priceUom: "case", unitType: "split_case" }),
    ).toContain("on its own line");
  });

  it("leaves the split case its own line, and the ordinary pairs alone", () => {
    // A broken case, priced as the broken case it is — the shape Q6 says to
    // write.
    expect(
      splitCaseOwnLineRefusal({ priceUom: "split_case", unitType: "split_case" }),
    ).toBeNull();
    // A broken case bought as loose bottles, priced per split case.
    expect(
      splitCaseOwnLineRefusal({ priceUom: "split_case", unitType: "bottle" }),
    ).toBeNull();
    // And the case that must never stop working: cases bought at a bottle
    // price, which Connecticut posts as two separate numbers for one wine.
    expect(
      splitCaseOwnLineRefusal({ priceUom: "bottle", unitType: "case" }),
    ).toBeNull();
    expect(splitCaseOwnLineRefusal({ priceUom: null, unitType: "case" })).toBeNull();
  });
});

// ===========================================================================
// Q2 — the header follows the line, and the door compares like with like
// ===========================================================================
describe("Q2 — confirmDeal stops writing the header price", () => {
  it("wrote the header and nothing else, before", () => {
    const before = preFixConfirmDealWrites(36.5);
    expect(before.header.final_price).toBe(36.5);
    expect(before.line).toBeNull();
    // Which is the divergence: the header moved to 36.50 and the LINE — what
    // the invoice matcher and the price register both read — kept whatever it
    // had. The database now refuses that write with 23514
    // (`trg_procurement_header_price_is_an_echo`), measured in
    // `$SP/pglite-probe/apply-and-probe.mjs`.
  });
});

describe("Q2/Q3 — the receiving door compares like with like", () => {
  it("compared a CASE price against a per-bottle invoice price, before", () => {
    // `invoice-match.ts` documents `poUnitPrice` as PER BOTTLE and compares it
    // directly against `invoiceUnitPrice`. The header names no unit at all.
    const before = preFixDoorPoUnitPrice({ final_price: 420 });
    expect(before).toBe(420);
    // Billed $35.00 a bottle, exactly as agreed. The pre-fix door saw
    // 420 vs 35 — a `price_variance`, the loudest verdict it can reach, on an
    // order where nothing was wrong.
    expect(Math.abs((before as number) - 35)).toBeGreaterThan(0.01);
  });

  it("now reads the agreed price per bottle, from the line's own pair", () => {
    const after = agreedPricePerBottleForDoor({
      price: 420,
      stated: CASE_OF_12,
    });
    expect(after.ok).toBe(true);
    if (!after.ok) throw new Error("unreachable");
    expect(after.perBottle).toBe(35);
    expect(Math.abs(after.perBottle - 35)).toBeLessThan(0.01);
    expect(after.note).toContain("per case of 12");
  });

  it("makes NO price comparison for a keg agreement, rather than a wrong one", () => {
    const after = agreedPricePerBottleForDoor({ price: 180, stated: PER_KEG });
    expect(after.ok).toBe(false);
    if (after.ok) throw new Error("unreachable");
    expect(after.reason).toContain("is not a number of bottles");
  });

  it("leaves an order that states no unit exactly as the door always read it", () => {
    // The door must not close on every order placed before phase 1.
    const before = preFixDoorPoUnitPrice({ final_price: 38 });
    const after = agreedPricePerBottleForDoor({ price: 38, stated: null });
    expect(after.ok && after.perBottle).toBe(before);
  });

  it("refuses rather than comparing when the order carries no price at all", () => {
    const after = agreedPricePerBottleForDoor({ price: null, stated: null });
    expect(after.ok).toBe(false);
    if (after.ok) throw new Error("unreachable");
    expect(after.reason).toContain("no agreed price");
  });
});
