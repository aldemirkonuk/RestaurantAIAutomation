/**
 * The per-bottle duty line — and the two measured reasons it cannot be a number
 * for anybody in this product today.
 *
 * The founder, 2026-09-05 (batch 51): *"a per-bottle duty line derivable and
 * printed with its basis"*. Derivable is what this file delivers; printable
 * needs two inputs this repository does not have, and each refusal names which.
 */

import { LITRES_PER_US_GALLON, derivability, perBottleDuty } from "./duty";
import { SERIES } from "./commodity.registry";

const HMRC = SERIES["hmrc.alcohol_duty.spirits_and_wine_8_5_to_22"];
const IL = SERIES["il_dor.liquor_gallonage_tax.above_20_abv"];
const GIB = SERIES["gib.otv_iii_a.asgari_maktu"];

/** A rate, as the register holds it, plus the value a person brings. */
function rateOf(entry: typeof HMRC, value: number) {
  return {
    valueKind: entry.valueKind,
    value,
    currency: entry.currency,
    denominator: entry.dutyDenominator ?? ("unstated" as const),
    issuer: entry.issuer,
    effectiveFrom: entry.effectiveFrom ?? null,
    unit: entry.unit,
  };
}

const TYPED = {
  sizeMl: 750,
  sizeSource: "typed_by_a_person" as const,
  abvPercent: 40,
  abvSource: "typed_by_a_person" as const,
};

describe("HMRC: per litre of PURE ALCOHOL", () => {
  it("derives the figure and states the whole working", () => {
    // GBP 30.62 per litre of pure alcohol, 750 ml at 40% = 0.3 litres of pure
    // alcohol = GBP 9.19. The rate is the one price-sources.md:295 records for
    // wine and spirits 8.5-22%; the arithmetic is this file's.
    const out = perBottleDuty(rateOf(HMRC, 30.62), TYPED);
    expect(out.derived).toBe(true);
    if (!out.derived) return;
    expect(out.amount).toBe(9.19);
    expect(out.currency).toBe("GBP");
    expect(out.basis).toMatch(/HM Revenue & Customs/);
    expect(out.basis).toMatch(/in force from 2026-02-01/);
    expect(out.basis).toMatch(/0\.3 litres of pure alcohol/);
    // The line says what it is NOT, because a duty figure beside a bottle reads
    // as a price to anybody who is not looking closely.
    expect(out.basis).toMatch(/Duty only; no VAT, no margin, no price/);
  });

  it("REFUSES without a strength, and names the column a person has to fill", () => {
    // The column exists as of 2026-09-05 (the founder's batch-57 answer) and is
    // null on every row until somebody states one, which is the real state of
    // every bottle today.
    const out = perBottleDuty(rateOf(HMRC, 30.62), { ...TYPED, abvPercent: null });
    expect(out.derived).toBe(false);
    if (out.derived) return;
    expect(out.reason).toBe("no_strength");
    expect(out.detail).toMatch(/nobody has stated one/);
    expect(out.detail).toMatch(/master_wine_library\.abv_percent/);
  });

  it("a STATED 0.0% is a real strength and prints a duty of zero", () => {
    // NULL is "nobody said"; 0.0 is a person stating a de-alcoholised product.
    // HMRC's own 0-1.2% band is GBP 0.00, so refusing this would refuse a
    // correct answer -- and it would make the two states render alike.
    const out = perBottleDuty(rateOf(HMRC, 0), { ...TYPED, abvPercent: 0 });
    expect(out.derived).toBe(true);
    if (!out.derived) return;
    expect(out.amount).toBe(0);
  });

  it("REFUSES a negative strength, which is not a strength", () => {
    const out = perBottleDuty(rateOf(HMRC, 30.62), { ...TYPED, abvPercent: -1 });
    expect(out.derived).toBe(false);
    if (!out.derived) expect(out.reason).toBe("no_strength");
  });

  it("REFUSES a defaulted strength, not only a missing one", () => {
    const out = perBottleDuty(rateOf(HMRC, 30.62), {
      ...TYPED,
      abvSource: "column_default",
    });
    expect(out.derived).toBe(false);
    if (!out.derived) expect(out.reason).toBe("strength_is_a_default");
  });
});

describe("Illinois: per GALLON of liquid", () => {
  it("converts exactly, and needs no strength at all", () => {
    // USD 8.55 per gallon, 750 ml: 8.55 / 3.785411784 * 0.75 = 1.694... -> 1.69
    const out = perBottleDuty(rateOf(IL, 8.55), { ...TYPED, abvPercent: null, abvSource: null });
    expect(out.derived).toBe(true);
    if (!out.derived) return;
    expect(out.amount).toBe(1.69);
    expect(out.currency).toBe("USD");
    expect(out.basis).toMatch(/1 US gallon = 3.785411784 litres, exactly/);
  });

  it("uses the exact definition of a US gallon", () => {
    expect(LITRES_PER_US_GALLON).toBe(3.785411784);
  });

  it("REFUSES a size that came from the column DEFAULT", () => {
    // `master_wine_library.bottle_size_ml integer DEFAULT 750 NOT NULL`.
    // A duty computed from a default is a number nobody chose, printed as this
    // bottle's tax -- the `restaurants.currency DEFAULT 'USD'` defect with a
    // figure attached.
    const out = perBottleDuty(rateOf(IL, 8.55), {
      ...TYPED,
      sizeSource: "column_default",
    });
    expect(out.derived).toBe(false);
    if (out.derived) return;
    expect(out.reason).toBe("size_is_a_default");
    expect(out.detail).toMatch(/bottle_size_ml DEFAULT 750/);
  });

  it("REFUSES a missing size", () => {
    const out = perBottleDuty(rateOf(IL, 8.55), { ...TYPED, sizeMl: null });
    expect(out.derived).toBe(false);
    if (!out.derived) expect(out.reason).toBe("no_size");
  });
});

describe("GİB: the issuer does not state what the figure is per", () => {
  it("REFUSES the derivation outright, and says the rate itself is fine", () => {
    // price-sources.md:269, verbatim: "The unit is not stated on the face of the
    // table and is NOT asserted here". Press reporting divides by 100, which
    // IMPLIES per litre of pure alcohol; that was never confirmed against Law
    // 4760. Guessing here is a tax figure wrong by a factor of a hundred.
    const out = perBottleDuty(rateOf(GIB, 1919.1384), TYPED);
    expect(out.derived).toBe(false);
    if (out.derived) return;
    expect(out.reason).toBe("denominator_unstated");
    expect(out.detail).toMatch(/does not state what this figure is per/);
    expect(out.detail).toMatch(/The rate is real and dated/);
  });
});

describe("what is refused before any bottle is looked at", () => {
  it("an index number is not a tax", () => {
    const out = perBottleDuty(
      { ...rateOf(HMRC, 30.62), valueKind: "index_number" },
      TYPED,
    );
    expect(out.derived).toBe(false);
    if (!out.derived) expect(out.reason).toBe("not_a_rate");
  });

  it("a rate with no currency yields no money", () => {
    const out = perBottleDuty({ ...rateOf(HMRC, 30.62), currency: null }, TYPED);
    expect(out.derived).toBe(false);
    if (!out.derived) expect(out.reason).toBe("no_currency");
  });
});

describe("derivability: the sentence the panel prints per series", () => {
  it("separates 'not published' from 'not typed in yet'", () => {
    // Two different facts, and only the second is fixable by a person.
    const gib = derivability({
      valueKind: "rate",
      denominator: "unstated",
      issuer: GIB.issuer,
    });
    expect(gib.supported).toBe(false);
    expect(gib.sentence).toMatch(/is not published and is not guessed/);

    const hmrc = derivability({
      valueKind: "rate",
      denominator: "litre_of_pure_alcohol",
      issuer: HMRC.issuer,
    });
    expect(hmrc.supported).toBe(true);
    expect(hmrc.sentence).toMatch(/size x strength x rate/);
    expect(hmrc.sentence).toMatch(/never the library's 750 ml column default/);

    const il = derivability({
      valueKind: "rate",
      denominator: "gallon_of_liquid",
      issuer: IL.issuer,
    });
    expect(il.supported).toBe(true);
    expect(il.sentence).toMatch(/never the library's 750 ml column default/);
  });

  it("says nothing at all for a series that is not a rate", () => {
    const out = derivability({
      valueKind: "index_number",
      denominator: "unstated",
      issuer: "FAO",
    });
    expect(out.supported).toBe(false);
    expect(out.sentence).toMatch(/Not a rate/);
  });
});
