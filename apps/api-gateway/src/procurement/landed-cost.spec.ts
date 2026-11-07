/**
 * Lane 1.2 of the cost-math proposal: the one landed-cost rule.
 * Every fixture here is SYNTHETIC, not a real supplier paper (proposal §6).
 */
import {
  CHARGE_FIELDS,
  CostedLine,
  HouseTaxBasis,
  LandedCostHeader,
  LandedCostLineInput,
  UnresolvedLine,
  landedCost,
} from "./landed-cost";

const NO_HEADER: LandedCostHeader = {
  subtotal: null,
  discount_total: null,
  freight: null,
  fuel_surcharge: null,
  split_case_fee: null,
  delivery_fee: null,
  other_charges: null,
  deposit_total: null,
  tax: null,
};

const line = (o: Partial<LandedCostLineInput> = {}): LandedCostLineInput => ({
  line_no: 1,
  qty: 12,
  uom: "bottle",
  pack_size: 1,
  price_base_qty: null,
  unit_price: 10,
  line_total: 120,
  allowance: null,
  deposit: null,
  listed_bottles: 12,
  accepted_bottles: 12,
  ...o,
});

const cost = (
  h: Partial<LandedCostHeader>,
  lines: LandedCostLineInput[],
  tax_basis: HouseTaxBasis = "unset",
) => landedCost({ header: { ...NO_HEADER, ...h }, lines, tax_basis });

// Two lines worth 600 (12 @ 50) and 400 (10 @ 40).
const sixFour = () => [
  line({ qty: 12, unit_price: 50, line_total: 600 }),
  line({
    line_no: 2,
    qty: 10,
    unit_price: 40,
    line_total: 400,
    listed_bottles: 10,
    accepted_bottles: 10,
  }),
];

const costed = (l: unknown): CostedLine => {
  expect((l as CostedLine).status).toBe("costed");
  return l as CostedLine;
};
const open = (l: unknown): UnresolvedLine => {
  expect((l as UnresolvedLine).status).toBe("unresolved");
  return l as UnresolvedLine;
};

describe("landedCost: charges and discount shared by net line value (F3)", () => {
  it("freight 100 on lines worth 600 and 400 is shared 60 / 40", () => {
    const [a, b] = cost({ freight: 100 }, sixFour()).lines.map(costed);
    expect(a.charge_share).toBeCloseTo(60, 6);
    expect(b.charge_share).toBeCloseTo(40, 6);
    expect(a.landed_value).toBeCloseTo(660, 6);
    expect(b.landed_value).toBeCloseTo(440, 6);
    expect(a.landed_cost_per_bottle).toBeCloseTo(55, 6);
    expect(a.basis).toContain(
      "60.00 of the paper's freight, shared by line value",
    );
  });

  it("a header discount of 50 on the same lines is shared like a charge: -30 / -20", () => {
    const [a, b] = cost({ discount_total: 50 }, sixFour()).lines.map(costed);
    expect(a.discount_share).toBeCloseTo(-30, 6);
    expect(b.discount_share).toBeCloseTo(-20, 6);
    expect(a.landed_value).toBeCloseTo(570, 6);
    expect(b.landed_value).toBeCloseTo(380, 6);
  });

  it("every charge column counts, and a line that is not stock carries none", () => {
    const r = cost(
      {
        freight: 40,
        fuel_surcharge: 10,
        split_case_fee: 20,
        delivery_fee: 15,
        other_charges: 15,
      },
      [
        ...sixFour(),
        line({
          line_no: 3,
          stocked: false,
          qty: 1,
          unit_price: 500,
          line_total: 500,
        }),
      ],
    );
    expect(r.charges_total).toBe(100);
    expect(costed(r.lines[0]).charge_share).toBeCloseTo(60, 6);
    expect(r.lines[2].status).toBe("not_stocked");
  });
});

describe("landedCost: the reconcile step", () => {
  it("a line_total already net of its allowance is not reduced twice", () => {
    // 12 x 10 = 120 gross; allowance 10; the paper prints 110, already net.
    const a = costed(
      cost({}, [line({ allowance: 10, line_total: 110 })]).lines[0],
    );
    expect(a.net_line_value).toBeCloseTo(110, 6);
    expect(a.basis).toContain("not taken off again");
  });

  it("a line_total that is the gross has its allowance taken off once", () => {
    const a = costed(
      cost({}, [line({ allowance: 10, line_total: 120 })]).lines[0],
    );
    expect(a.net_line_value).toBeCloseTo(110, 6);
  });

  it("with no line_total printed, value = qty x price / price base - allowance", () => {
    // 24 bottles at 142.00 per 12 = 284.00, less 4.00.
    const a = costed(
      cost({}, [
        line({
          qty: 24,
          unit_price: 142,
          price_base_qty: 12,
          line_total: null,
          allowance: 4,
          listed_bottles: 24,
          accepted_bottles: 24,
        }),
      ]).lines[0],
    );
    expect(a.net_line_value).toBeCloseTo(280, 6);
    expect(a.basis).toContain("no line total is printed");
  });

  it("a line whose qty x price, allowance and line_total do not reconcile is unresolved", () => {
    const lines = [
      line({ line_no: 4, allowance: 10, line_total: 105 }),
      line({ line_no: 5 }),
    ];
    const quiet = cost({}, lines);
    expect(open(quiet.lines[0]).unresolved).toContain("Line 4 does not add up");
    expect(open(quiet.lines[0]).unresolved).toContain("prints 105.00");
    // With nothing to share, the other line's cost does not depend on it.
    expect(costed(quiet.lines[1]).net_line_value).toBeCloseTo(120, 6);
    // With freight to share, nothing on the paper can be final.
    expect(open(cost({ freight: 20 }, lines).lines[1]).unresolved).toContain(
      "Line 4 could not be priced",
    );
  });

  it("a total with an allowance but no quantity and price is unresolved, not guessed", () => {
    const r = cost({}, [
      line({ qty: null, unit_price: null, allowance: 5, line_total: 115 }),
    ]);
    expect(open(r.lines[0]).unresolved).toContain("before or after");
  });
});

describe("landedCost: deposits and tax are never value (F14)", () => {
  it("deposit_total, a line deposit and tax never reach any value", () => {
    const r = cost(
      { deposit_total: 30, tax: 48 },
      [
        line({ deposit: 6, line_total: 126 }), // the total folds in its deposit
        line({ line_no: 2, deposit: 6, line_total: 120 }), // printed beside it
      ],
      "prices_exclude_kdv",
    );
    for (const l of r.lines.map(costed)) {
      expect(l.net_line_value).toBeCloseTo(120, 6);
      expect(l.landed_value).toBeCloseTo(120, 6);
      expect(l.landed_cost_per_bottle).toBeCloseTo(10, 6);
    }
    expect(r.charges_total).toBe(0);
    expect(r.left_out).toContain(
      "a deposit of 30.00, line deposits of 12.00, tax of 48.00",
    );
    expect(r.tax_basis).toBe("prices_exclude_kdv");
  });

  it("a 7161 deposit filed on deposit_total stays out of cost (pinned to deposit_total)", () => {
    // Synthetic TR paper: 7161 is a returnable-crate deposit, filed on deposit_total.
    const [a, b] = cost({ deposit_total: 24, tax: 21.6 }, sixFour()).lines.map(
      costed,
    );
    expect(a.landed_value).toBeCloseTo(600, 6);
    expect(b.landed_value).toBeCloseTo(400, 6);
    expect(CHARGE_FIELDS).not.toContain("deposit_total");
    expect(CHARGE_FIELDS).not.toContain("tax");
    // The guard's other half: the same 24 filed as other_charges IS cost, so
    // the column intake files a 7161 on is the contract.
    expect(
      costed(cost({ other_charges: 24 }, sixFour()).lines[0]).landed_value,
    ).toBeCloseTo(614.4, 6);
  });
});

describe("landedCost: bottles", () => {
  it("12 paid at 10 plus 1 free dilute to 9.2308 a bottle for the item", () => {
    const r = cost({}, [
      line({ item_key: "wine-a" }),
      line({
        line_no: 2,
        item_key: "wine-a",
        qty: 1,
        unit_price: 0,
        line_total: 0,
        listed_bottles: 1,
        accepted_bottles: 1,
      }),
    ]);
    expect(costed(r.lines[1]).basis).toContain("free goods");
    const item = r.items[0];
    expect(item.status === "costed" && item.accepted_bottles).toBe(13);
    expect(item.status === "costed" && item.landed_cost_per_bottle).toBeCloseTo(
      9.2308,
      4,
    );
  });

  it("billed 12 x 22 with 10 accepted costs 22.00 a bottle, not 26.40 (F2)", () => {
    const a = costed(
      cost({}, [
        line({ unit_price: 22, line_total: 264, accepted_bottles: 10 }),
      ]).lines[0],
    );
    expect(a.accepted_landed_value).toBeCloseTo(220, 6);
    expect(a.landed_cost_per_bottle).toBeCloseTo(22, 6);
    expect(a.basis).toContain("the 2 not accepted are left out of cost");
  });

  it("more bottles accepted than the line lists is unresolved", () => {
    const r = cost({}, [line({ accepted_bottles: 13 })]);
    expect(open(r.lines[0]).unresolved).toContain(
      "have no price on this paper",
    );
  });
});
