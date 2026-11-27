/**
 * Lane 1.2 of the cost-math proposal: the one landed-cost rule.
 * Every fixture here is SYNTHETIC, not a real supplier paper (proposal §6).
 */
import {
  CHARGE_FIELDS,
  CostedLine,
  HouseTax,
  LandedCostHeader,
  LandedCostLineInput,
  UnresolvedLine,
  landedCost,
  shareByLargestRemainder,
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
  charges_tax_basis: null,
  charges_vat_rate_percent: null,
};

const UNSET: HouseTax = { tax_basis: "unset", reclaims_input_tax: null };
const RECLAIMS: HouseTax = {
  tax_basis: "prices_include_tax",
  reclaims_input_tax: true,
};
const DOES_NOT_RECLAIM: HouseTax = {
  tax_basis: "prices_include_tax",
  reclaims_input_tax: false,
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
  price_tax_basis: null,
  vat_rate_percent: null,
  listed_bottles: 12,
  accepted_bottles: 12,
  ...o,
});

const cost = (
  h: Partial<LandedCostHeader>,
  lines: LandedCostLineInput[],
  house: HouseTax = UNSET,
) => landedCost({ header: { ...NO_HEADER, ...h }, lines, house });

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

describe("landedCost: deposits are never value (F14)", () => {
  it("deposit_total and a line deposit never reach any value; a reclaimed tax added outside the price does not either", () => {
    const taxed = {
      price_tax_basis: "excludes_tax" as const,
      vat_rate_percent: 20,
    };
    const r = cost(
      { deposit_total: 30, tax: 48 },
      [
        line({ deposit: 6, line_total: 126, ...taxed }), // the total folds in its deposit
        line({ line_no: 2, deposit: 6, line_total: 120, ...taxed }), // printed beside it
      ],
      RECLAIMS,
    );
    for (const l of r.lines.map(costed)) {
      expect(l.net_line_value).toBeCloseTo(120, 6);
      expect(l.landed_value).toBeCloseTo(120, 6);
      expect(l.landed_cost_per_bottle).toBeCloseTo(10, 6);
    }
    expect(r.charges_total).toBe(0);
    expect(r.left_out).toBe(
      "Not cost: a deposit of 30.00, line deposits of 12.00. Deposits come back.",
    );
    expect(r.tax_said).toBe("Cost is before tax, since the house reclaims it.");
    expect(r.house).toBe(RECLAIMS);
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

describe("landedCost: tax follows the line's basis and the house's reclaim (ADR 0359 C3)", () => {
  // The same 10 bottles, printed two ways: 10 at 11.80 with 18 % KDV inside,
  // or 10 at 10.00 with 18 % KDV added on the paper. Header tax 18 either way.
  const inside = () =>
    line({
      qty: 10,
      unit_price: 11.8,
      line_total: 118,
      listed_bottles: 10,
      accepted_bottles: 10,
      price_tax_basis: "includes_tax",
      vat_rate_percent: 18,
    });
  const outside = () =>
    line({
      qty: 10,
      unit_price: 10,
      line_total: 100,
      listed_bottles: 10,
      accepted_bottles: 10,
      price_tax_basis: "excludes_tax",
      vat_rate_percent: 18,
    });

  it("KDV printed inside the price is taken out for a house that reclaims it: 10.00 a bottle, stamped net (QA round 4, #780)", () => {
    const r = cost({ tax: 18 }, [inside()], RECLAIMS);
    const a = costed(r.lines[0]);
    expect(a.net_line_value).toBeCloseTo(118, 6);
    expect(a.cost_value).toBeCloseTo(100, 6);
    expect(a.tax_taken_out).toBeCloseTo(18, 6);
    expect(a.landed_cost_per_bottle).toBeCloseTo(10, 6);
    expect(a.cost_tax_basis).toBe("net");
    expect(a.basis).toContain(
      "the 18.00 of tax inside its price is taken out, since the house reclaims it",
    );
    expect(r.tax_said).toBe(
      "Tax of 18.00 printed inside the prices is taken out of cost, since the house reclaims it.",
    );
    // The false sentence QA found: nothing may say the tax was simply "not cost".
    expect(r.left_out).not.toContain("tax");
  });

  it("KDV printed outside the price gives the same 10.00 a bottle for a house that reclaims it", () => {
    const r = cost({ tax: 18 }, [outside()], RECLAIMS);
    const a = costed(r.lines[0]);
    expect(a.cost_value).toBeCloseTo(100, 6);
    expect(a.tax_taken_out).toBeCloseTo(0, 6);
    expect(a.landed_cost_per_bottle).toBeCloseTo(10, 6);
    expect(a.cost_tax_basis).toBe("net");
    expect(r.tax_said).toBe("Cost is before tax, since the house reclaims it.");
  });

  it("a house that does not reclaim keeps the KDV in cost either way: 11.80 a bottle, stamped gross_cost", () => {
    for (const l of [inside(), outside()]) {
      const r = cost({ tax: 18 }, [l], DOES_NOT_RECLAIM);
      const a = costed(r.lines[0]);
      expect(a.cost_value).toBeCloseTo(118, 6);
      expect(a.tax_in_cost).toBeCloseTo(18, 6);
      expect(a.landed_cost_per_bottle).toBeCloseTo(11.8, 6);
      expect(a.cost_tax_basis).toBe("gross_cost");
      expect(r.tax_said).toBe(
        "Tax of 18.00 is in cost, since the house does not reclaim it.",
      );
    }
  });

  it("a house that does not charge VAT cannot reclaim it, whatever its reclaim answer says", () => {
    const a = costed(
      cost({ tax: 18 }, [inside()], {
        tax_basis: "not_vat_charging",
        reclaims_input_tax: true,
      }).lines[0],
    );
    expect(a.landed_cost_per_bottle).toBeCloseTo(11.8, 6);
    expect(a.cost_tax_basis).toBe("gross_cost");
  });

  it("a house with no answer costs as printed and its stamp is null, with the reason", () => {
    const unset = cost({ tax: 18 }, [inside()], UNSET);
    expect(costed(unset.lines[0]).landed_cost_per_bottle).toBeCloseTo(11.8, 6);
    expect(costed(unset.lines[0]).cost_tax_basis).toBeNull();
    expect(unset.tax_said).toContain("the house has not set its tax basis");
    const noReclaimAnswer = cost({ tax: 18 }, [outside()], {
      tax_basis: "prices_include_tax",
      reclaims_input_tax: null,
    });
    expect(costed(noReclaimAnswer.lines[0]).cost_value).toBeCloseTo(100, 6);
    expect(costed(noReclaimAnswer.lines[0]).cost_tax_basis).toBeNull();
    expect(noReclaimAnswer.tax_said).toContain(
      "has not said whether it reclaims the tax it pays",
    );
  });

  it("a reclaiming house's line with no rate, or no basis, is costed as printed and not stamped net", () => {
    const noRate = costed(
      cost({}, [{ ...inside(), vat_rate_percent: null }], RECLAIMS).lines[0],
    );
    expect(noRate.cost_value).toBeCloseTo(118, 6);
    expect(noRate.cost_tax_basis).toBeNull();
    expect(noRate.basis).toContain("the paper prints no tax rate for it");
    const noBasis = costed(
      cost({}, [{ ...inside(), price_tax_basis: null }], RECLAIMS).lines[0],
    );
    expect(noBasis.cost_tax_basis).toBeNull();
    expect(noBasis.basis).toContain(
      "the paper does not say whether its price includes tax",
    );
  });

  it("a header tax that the lines' rates do not reach leaves every line unresolved", () => {
    const r = cost({ tax: 20 }, [inside()], RECLAIMS);
    expect(open(r.lines[0]).unresolved).toBe(
      "The paper prints tax of 20.00, but its lines' rates come to 18.00, so no line's cost can be final.",
    );
    expect(r.tax_said).toBe(
      "The paper's tax could not be treated, since none of its lines could be costed.",
    );
    // The audit's probe: tax 25 on a 100.00 line at 20 % excluded.
    const probe = cost(
      { tax: 25 },
      [
        line({
          line_total: 100,
          unit_price: 100 / 12,
          price_tax_basis: "excludes_tax",
          vat_rate_percent: 20,
        }),
      ],
      RECLAIMS,
    );
    expect(open(probe.lines[0]).unresolved).toContain(
      "The paper prints tax of 25.00, but its lines' rates come to 20.00",
    );
    expect(probe.tax_said).toBe(
      "The paper's tax could not be treated, since none of its lines could be costed.",
    );
  });

  it("the tax on freight that the paper states is counted in what tax_said reports (audit, #815)", () => {
    const keeps = cost(
      {
        freight: 10,
        charges_tax_basis: "excludes_tax",
        charges_vat_rate_percent: 20,
      },
      [
        line({
          line_total: 100,
          unit_price: 100 / 12,
          price_tax_basis: "excludes_tax",
          vat_rate_percent: 20,
        }),
      ],
      DOES_NOT_RECLAIM,
    );
    expect(costed(keeps.lines[0]).landed_value).toBeCloseTo(132, 6);
    expect(keeps.tax_said).toBe(
      "Tax of 22.00 is in cost, since the house does not reclaim it.",
    );
    const reclaims = cost(
      {
        freight: 12,
        charges_tax_basis: "includes_tax",
        charges_vat_rate_percent: 20,
        tax: 22,
      },
      [line({ price_tax_basis: "includes_tax", vat_rate_percent: 20 })],
      RECLAIMS,
    );
    expect(costed(reclaims.lines[0]).landed_value).toBeCloseTo(110, 6);
    expect(reclaims.tax_said).toBe(
      "Tax of 22.00 printed inside the prices is taken out of cost, since the house reclaims it.",
    );
    // Only the freight carries a rate, and no line can be costed.
    const untreated = cost(
      {
        freight: 10,
        discount_total: 500,
        charges_tax_basis: "excludes_tax",
        charges_vat_rate_percent: 20,
      },
      [line({ vat_rate_percent: 0 })],
      RECLAIMS,
    );
    open(untreated.lines[0]);
    expect(untreated.tax_said).toBe(
      "The paper's tax could not be treated, since none of its lines could be costed.",
    );
  });

  it("freight printed with KDV inside is shared before tax for a house that reclaims", () => {
    const lines = sixFour().map((l) => ({
      ...l,
      price_tax_basis: "excludes_tax" as const,
      vat_rate_percent: 18,
    }));
    const r = cost(
      {
        freight: 11.8,
        charges_tax_basis: "includes_tax",
        charges_vat_rate_percent: 18,
        tax: 181.8,
      },
      lines,
      RECLAIMS,
    );
    const [a, b] = r.lines.map(costed);
    expect(a.charge_share).toBeCloseTo(6, 6);
    expect(b.charge_share).toBeCloseTo(4, 6);
    expect(a.cost_tax_basis).toBe("net");
  });

  it("a line that carries a share of freight whose tax the paper does not state is not stamped", () => {
    const r = cost({ freight: 10 }, [outside()], RECLAIMS);
    const a = costed(r.lines[0]);
    expect(a.landed_value).toBeCloseTo(110, 6);
    expect(a.cost_tax_basis).toBeNull();
    expect(r.tax_said).toBe(
      "The price of 1 line is costed before tax, since the house reclaims it. 1 line carries a share of the paper's charges or discount whose tax is not known, so what its cost holds is not stated.",
    );
  });

  it("a line whose own tax is treated is never said to be costed as printed because its freight's tax is not known (audit, #812)", () => {
    // 120.00 with 20 % inside, plus freight 10 with no tax stated.
    const inclusive = line({
      price_tax_basis: "includes_tax",
      vat_rate_percent: 20,
    });
    const reclaims = cost({ freight: 10 }, [inclusive], RECLAIMS);
    const a = costed(reclaims.lines[0]);
    expect(a.cost_value).toBeCloseTo(100, 6);
    expect(a.tax_taken_out).toBeCloseTo(20, 6);
    expect(a.cost_tax_basis).toBeNull();
    expect(a.basis).toContain("the 20.00 of tax inside its price is taken out");
    expect(reclaims.tax_said).toBe(
      "Tax of 20.00 printed inside the prices is taken out of cost, since the house reclaims it. 1 line carries a share of the paper's charges or discount whose tax is not known, so what its cost holds is not stated.",
    );
    const keeps = cost(
      { freight: 10 },
      [
        {
          ...inclusive,
          price_tax_basis: "excludes_tax",
          line_total: 100,
          unit_price: 100 / 12,
        },
      ],
      DOES_NOT_RECLAIM,
    );
    expect(costed(keeps.lines[0]).tax_in_cost).toBeCloseTo(20, 6);
    expect(keeps.tax_said).toBe(
      "Tax of 20.00 is in cost, since the house does not reclaim it. 1 line carries a share of the paper's charges or discount whose tax is not known, so what its cost holds is not stated.",
    );
  });

  it("a paper none of whose lines could be costed never says nothing on it carries tax (audit, #812)", () => {
    const badRate = cost(
      {},
      [{ ...inside(), vat_rate_percent: 118 }],
      RECLAIMS,
    );
    open(badRate.lines[0]);
    expect(badRate.tax_said).toBe(
      "The paper's tax could not be treated, since none of its lines could be costed.",
    );
    const bigDiscount = cost(
      { discount_total: 500, tax: 18 },
      [outside()],
      RECLAIMS,
    );
    open(bigDiscount.lines[0]);
    expect(bigDiscount.tax_said).toBe(
      "The paper's tax could not be treated, since none of its lines could be costed.",
    );
    // A paper with no tax anywhere still says so.
    const untaxed = cost(
      {},
      [{ ...outside(), vat_rate_percent: 0 }],
      DOES_NOT_RECLAIM,
    );
    expect(untaxed.tax_said).toBe("Nothing on this paper carries tax.");
  });

  it("an item whose lines do not agree on what their cost holds is stamped null", () => {
    const r = cost(
      {},
      [
        { ...outside(), item_key: "wine-a" },
        {
          ...outside(),
          line_no: 2,
          item_key: "wine-a",
          vat_rate_percent: null,
        },
      ],
      DOES_NOT_RECLAIM,
    );
    expect(costed(r.lines[0]).cost_tax_basis).toBe("gross_cost");
    expect(costed(r.lines[1]).cost_tax_basis).toBeNull();
    const item = r.items[0];
    expect(item.status === "costed" && item.cost_tax_basis).toBeNull();
  });

  it("a tax rate that is not a rate is unresolved", () => {
    const r = cost({}, [{ ...inside(), vat_rate_percent: 118 }], RECLAIMS);
    expect(open(r.lines[0]).unresolved).toContain(
      "prints a tax rate that is not a rate",
    );
  });
});

describe("shareByLargestRemainder (QA round 15, finding 3)", () => {
  it("adds back to the total in cents and moves no part more than a cent", () => {
    expect(shareByLargestRemainder(1, [30, 30, 30])).toEqual([0.34, 0.33, 0.33]);
    expect(shareByLargestRemainder(4.9, [10000])).toEqual([4.9]);
    const parts = shareByLargestRemainder(10.07, [3, 7, 11, 13]);
    expect(Math.round(parts.reduce((s, p) => s + p, 0) * 100)).toBe(1007);
    parts.forEach((p, i) =>
      expect(Math.abs(p - (10.07 * [3, 7, 11, 13][i]) / 34)).toBeLessThan(0.01),
    );
  });
  it("gives nothing to a line of no value and nothing out of nothing", () => {
    expect(shareByLargestRemainder(1, [0, 50, 50])).toEqual([0, 0.5, 0.5]);
    expect(shareByLargestRemainder(0, [1, 2])).toEqual([0, 0]);
  });
});
