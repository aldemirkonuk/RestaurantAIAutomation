/**
 * ADR 0119 phase 0 — the confirmation mail states the order's own unit.
 *
 * `confirmDeal` mailed the vendor "${quantity} bottles of X at $P per bottle"
 * for every order, while `procurement_orders.quantity` is a count in the
 * order's `unit_type` and `final_price` names no unit at all. A five-case order
 * of a twelve-pack told the vendor five bottles for a sixty-bottle delivery and
 * priced a case as a bottle.
 *
 * `preFixSentence` below is the sentence the pre-fix tree built, transcribed
 * verbatim from `git show HEAD:apps/api-gateway/src/procurement/`
 * `procurement.service.ts` lines 4804-4810 at `d870800d` (a COPY — no git state
 * was changed). Each of the four cases is asserted against BOTH builders.
 *
 * Three of the four fail against the pre-fix builder. The BOTTLE case passes
 * against it, and that is the point rather than a weak test: the old sentence
 * was not wrong at random, it was right for exactly one unit and asserted that
 * unit for all seven. It is marked `preFixAgrees` and asserted to still match,
 * so the fix is proven not to have moved the one case that was already correct.
 */
import { describeConfirmedOrderTerms } from "./procurement.service";

/** The pre-fix builder, verbatim from HEAD:4804-4810. */
function preFixSentence(input: {
  quantity: number;
  wineName: string;
  finalPrice: number | null;
}): string {
  const { quantity, wineName, finalPrice } = input;
  const priceLine =
    finalPrice != null
      ? ` at $${Number(finalPrice).toFixed(2)} per bottle`
      : "";
  return `We'd like to confirm our order: ${quantity} bottles of ${wineName}${priceLine}.`;
}

const WINE = "Château Test 2019";

describe("confirmDeal — the confirmation mail states the order's own unit", () => {
  const cases: Array<{
    name: string;
    input: Parameters<typeof describeConfirmedOrderTerms>[0];
    expected: string;
    /** True for the one unit the pre-fix sentence happened to be right about. */
    preFixAgrees?: boolean;
  }> = [
    {
      name: "a case order with a known pack names the pack and prices per case",
      input: {
        quantity: 5,
        unitType: "case",
        bottlesPerUnit: 12,
        wineName: WINE,
        finalPrice: 120,
      },
      expected:
        "We'd like to confirm our order: 5 cases (12 bottles each) of Château Test 2019 at $120.00 per case.",
    },
    {
      name: "a case order with an unknown pack says the pack is not on record",
      input: {
        quantity: 5,
        unitType: "case",
        bottlesPerUnit: null,
        wineName: WINE,
        finalPrice: 120,
      },
      expected:
        "We'd like to confirm our order: 5 cases of Château Test 2019 at $120.00 per case." +
        " Our records do not state how many bottles are in a case, so please confirm the pack size.",
    },
    {
      name: "a bottle order says bottles and prices per bottle, with no pack question",
      input: {
        quantity: 24,
        unitType: "bottle",
        bottlesPerUnit: 1,
        wineName: WINE,
        finalPrice: 22,
      },
      expected:
        "We'd like to confirm our order: 24 bottles of Château Test 2019 at $22.00 per bottle.",
      preFixAgrees: true,
    },
    {
      name: "a keg order says kegs and prices per keg, never per bottle",
      input: {
        quantity: 2,
        unitType: "keg",
        bottlesPerUnit: null,
        wineName: WINE,
        finalPrice: 180,
      },
      expected:
        "We'd like to confirm our order: 2 kegs of Château Test 2019 at $180.00 per keg." +
        " Our records do not state how many bottles are in a keg, so please confirm the pack size.",
    },
  ];

  for (const c of cases) {
    it(c.name, () => {
      expect(describeConfirmedOrderTerms(c.input)).toBe(c.expected);
    });

    it(
      c.preFixAgrees
        ? `${c.name} — and the pre-fix tree already did (unchanged)`
        : `${c.name} — the pre-fix tree did not`,
      () => {
        if (c.preFixAgrees) expect(preFixSentence(c.input)).toBe(c.expected);
        else expect(preFixSentence(c.input)).not.toBe(c.expected);
      },
    );
  }

  it("never says 'bottle' for a unit that is not the bottle", () => {
    for (const unitType of ["case", "keg", "pack", "split_case", "liter"]) {
      const sentence = describeConfirmedOrderTerms({
        quantity: 3,
        unitType,
        bottlesPerUnit: 12,
        wineName: WINE,
        finalPrice: 99,
      });
      expect(sentence).toContain(`per ${unitType}`);
      expect(sentence).not.toContain("per bottle");
    }
  });

  it("claims no unit at all when the order states none", () => {
    expect(
      describeConfirmedOrderTerms({
        quantity: 4,
        unitType: null,
        bottlesPerUnit: null,
        wineName: WINE,
        finalPrice: 50,
      }),
    ).toBe(
      "We'd like to confirm our order: 4 units of Château Test 2019 at $50.00 per unit." +
        " Our records do not state how many bottles are in a unit, so please confirm the pack size.",
    );
  });

  it("omits the price clause entirely when no price was agreed", () => {
    expect(
      describeConfirmedOrderTerms({
        quantity: 1,
        unitType: "case",
        bottlesPerUnit: 6,
        wineName: WINE,
        finalPrice: null,
      }),
    ).toBe(
      "We'd like to confirm our order: 1 case (6 bottles each) of Château Test 2019.",
    );
  });
});
