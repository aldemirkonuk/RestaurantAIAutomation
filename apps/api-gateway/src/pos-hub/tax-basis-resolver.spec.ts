import {
  NET_NOT_RECORDED,
  resolveCheckSubtotal,
  type CheckForTax,
  type HouseRateRow,
  type HouseTaxContext,
} from "./tax-basis-resolver";
import {
  genericAdapter,
  readTaxRate,
  squareAdapter,
  toastAdapter,
} from "./pos-adapters";

/**
 * F-1537 lane 3: a till's subtotal made pre-tax at ingest, by the house's
 * stated basis (founder 2026-10-12, S218: F1 build it, F2 only from now).
 */

const rate = (
  version: number,
  keyKind: HouseRateRow["keyKind"],
  key: string,
  r: number | null,
  effectiveFrom = "2026-01-01",
  effectiveTo: string | null = null,
): HouseRateRow => ({
  version,
  keyKind,
  key,
  rate: r,
  effectiveFrom,
  effectiveTo,
});

const inclusive = (
  rates: HouseRateRow[],
  over: Partial<HouseTaxContext> = {},
): HouseTaxContext => ({
  basis: "prices_include_tax",
  confirmedAt: "2026-10-12T06:00:00Z",
  zone: "Europe/Istanbul",
  rates,
  rateVersion: rates.length ? Math.max(...rates.map((r) => r.version)) : null,
  ...over,
});

const check = (over: Partial<CheckForTax> = {}): CheckForTax => ({
  subtotal: 270,
  total: 270,
  tip: null,
  closedAt: "2026-10-12T18:00:00Z",
  openedAt: "2026-10-12T17:00:00Z",
  lines: [
    { qty: 1, price: 100, category: "Food", inventoryId: null },
    { qty: 1, price: 200, category: "Alcohol", inventoryId: null },
  ],
  ...over,
});

const TWO_RATES = [
  rate(1, "pos_category", "Food", 0.1),
  rate(2, "pos_category", "Alcohol", 0.2),
];

describe("a house that has not said is a strict no-op", () => {
  it("unset answers as_before, so the row gets nothing new", () => {
    expect(
      resolveCheckSubtotal(check(), {
        basis: "unset",
        confirmedAt: null,
        zone: "Europe/Istanbul",
        rates: TWO_RATES,
        rateVersion: 2,
      }),
    ).toEqual({ kind: "as_before" });
  });

  it.each(["prices_exclude_tax", "not_vat_charging"] as const)(
    "%s keeps the till's subtotal to the cent and only records the basis",
    (basis) => {
      const s = resolveCheckSubtotal(check({ subtotal: 123.45 }), {
        basis,
        confirmedAt: "2026-10-12T06:00:00Z",
        zone: "America/New_York",
        rates: [],
        rateVersion: null,
      });
      expect(s).toEqual({
        kind: "stamped",
        rung: "not_inclusive",
        subtotal: 123.45,
        gross_subtotal: 123.45,
        tax_basis: basis,
        tax_rate_version: null,
        unresolved: null,
      });
    },
  );
});

describe("prices include tax: rates per line, prorated from the till's subtotal", () => {
  it("keeps a check-level discount: net is the till's subtotal times the lines' pre-tax share", () => {
    // Lines 100 (10%) + 200 (20%) = 300; the till took 30 off the check.
    const s = resolveCheckSubtotal(
      check({ subtotal: 270 }),
      inclusive(TWO_RATES),
    );
    // 270 * (100/1.1 + 200/1.2) / 300 = 231.818...
    expect(s).toMatchObject({
      rung: "rates_per_line",
      subtotal: 231.82,
      gross_subtotal: 270,
      tax_basis: "prices_include_tax",
      tax_rate_version: 2,
      unresolved: null,
    });
  });

  it("is never summed from the lines (that would drop the discount)", () => {
    const s = resolveCheckSubtotal(
      check({ subtotal: 270 }),
      inclusive(TWO_RATES),
    );
    const lineSum = 100 / 1.1 + 200 / 1.2;
    expect(s.kind === "stamped" && s.subtotal).not.toBeCloseTo(lineSum, 2);
  });

  it("a mixed-rate check with a line no rate covers is written null, with the reason", () => {
    const s = resolveCheckSubtotal(
      check(),
      inclusive([rate(1, "pos_category", "Alcohol", 0.2)]),
    );
    expect(s).toMatchObject({
      rung: "unresolved",
      subtotal: null,
      gross_subtotal: 270,
      tax_rate_version: null,
      unresolved: NET_NOT_RECORDED.mixed,
    });
  });

  it("a house item's rate wins over its till category, and a withdrawn key falls through", () => {
    const item = "11111111-1111-4111-8111-111111111111";
    const lines = [
      { qty: 1, price: 100, category: "Alcohol", inventoryId: item },
    ];
    const withItem = inclusive([
      rate(1, "pos_category", "Alcohol", 0.2),
      rate(2, "house_item", item, 0.1),
    ]);
    expect(
      resolveCheckSubtotal(check({ subtotal: 110, lines }), withItem),
    ).toMatchObject({ subtotal: 100 });
    const withdrawn = inclusive([
      rate(1, "pos_category", "Alcohol", 0.25),
      rate(2, "house_item", item, 0.1),
      rate(3, "house_item", item, null, "2026-06-01"),
    ]);
    expect(
      resolveCheckSubtotal(check({ subtotal: 125, lines }), withdrawn),
    ).toMatchObject({ subtotal: 100, tax_rate_version: 3 });
  });

  it("the till's own line rate is used before the house's", () => {
    const s = resolveCheckSubtotal(
      check({
        subtotal: 120,
        lines: [
          {
            qty: 1,
            price: 120,
            category: "Food",
            inventoryId: null,
            taxRate: 0.2,
          },
        ],
      }),
      inclusive(TWO_RATES),
    );
    expect(s).toMatchObject({ subtotal: 100, tax_rate_version: null });
  });
});

describe("the rate in force on the check's own house day", () => {
  // 2023: KDV went from 8% to 10% on 2023-07-10 (Decree 7346).
  const DECREE = inclusive(
    [
      rate(1, "house", "", 0.08, "2023-01-01", "2023-07-10"),
      rate(2, "house", "", 0.1, "2023-07-10"),
    ],
    { confirmedAt: "2023-01-01T06:00:00Z" },
  );
  const one = (closedAt: string) =>
    check({
      subtotal: 108,
      closedAt,
      openedAt: closedAt,
      lines: [{ qty: 1, price: 108, category: null, inventoryId: null }],
    });

  it("23:00 in Istanbul on 07-09 is the old rate", () => {
    expect(
      resolveCheckSubtotal(one("2023-07-09T20:00:00Z"), DECREE),
    ).toMatchObject({ subtotal: 100, tax_rate_version: 2 });
  });

  it("00:30 in Istanbul on 07-10 (still 07-09 in UTC) is the new rate", () => {
    expect(
      resolveCheckSubtotal(one("2023-07-09T21:30:00Z"), DECREE),
    ).toMatchObject({ subtotal: 98.18 });
  });

  it("a later row over the same span corrects the earlier one", () => {
    const corrected = inclusive(
      [rate(1, "house", "", 0.18), rate(2, "house", "", 0.2)],
      { confirmedAt: "2026-01-01T06:00:00Z" },
    );
    expect(
      resolveCheckSubtotal(check({ subtotal: 120, lines: [] }), corrected),
    ).toMatchObject({ rung: "single_rate", subtotal: 100 });
  });
});

describe("F2: only from now", () => {
  it("a check filed before the switch day keeps the till's figure and no stamp", () => {
    const s = resolveCheckSubtotal(
      check({
        closedAt: "2026-10-11T18:00:00Z",
        openedAt: "2026-10-11T17:00:00Z",
      }),
      inclusive(TWO_RATES),
    );
    expect(s).toEqual({
      kind: "stamped",
      rung: "before_switch",
      subtotal: 270,
      gross_subtotal: null,
      tax_basis: null,
      tax_rate_version: null,
      unresolved: null,
    });
  });

  it("a check earlier on the switch day itself is made pre-tax", () => {
    const s = resolveCheckSubtotal(
      check({
        closedAt: "2026-10-12T03:00:00Z",
        openedAt: "2026-10-12T02:00:00Z",
      }),
      inclusive(TWO_RATES, { confirmedAt: "2026-10-12T15:00:00Z" }),
    );
    expect(s).toMatchObject({ rung: "rates_per_line" });
  });
});

describe("rung 1: the tax the till states", () => {
  it("Square's subtotal is already pre-tax: no rate is divided out again", () => {
    expect(
      resolveCheckSubtotal(
        check({ subtotalPreTax: true }),
        inclusive(TWO_RATES),
      ),
    ).toMatchObject({
      rung: "till_stated",
      subtotal: 270,
      tax_rate_version: null,
    });
  });

  it("a CSV's stated tax inside the subtotal comes off it", () => {
    expect(
      resolveCheckSubtotal(
        check({ subtotal: 120, total: 125, tip: 5, tax: 20 }),
        inclusive(TWO_RATES),
      ),
    ).toMatchObject({
      rung: "till_stated",
      subtotal: 100,
      gross_subtotal: 120,
    });
  });

  it("a tax the till added on top of the subtotal is not taken off twice: null", () => {
    expect(
      resolveCheckSubtotal(
        check({ subtotal: 100, total: 120, tax: 20 }),
        inclusive(TWO_RATES),
      ),
    ).toMatchObject({ subtotal: null, unresolved: NET_NOT_RECORDED.taxOnTop });
  });

  it("a tax larger than the subtotal is null", () => {
    expect(
      resolveCheckSubtotal(
        check({ subtotal: 10, tax: 20 }),
        inclusive(TWO_RATES),
      ),
    ).toMatchObject({
      subtotal: null,
      unresolved: NET_NOT_RECORDED.taxOverSubtotal,
    });
  });
});

describe("rungs 3 and 4", () => {
  it("one whole-house rate divides a check with no lines", () => {
    expect(
      resolveCheckSubtotal(
        check({ subtotal: 110, lines: [] }),
        inclusive([rate(4, "house", "", 0.1)]),
      ),
    ).toMatchObject({
      rung: "single_rate",
      subtotal: 100,
      tax_rate_version: 4,
    });
  });

  it("a check with no lines and two rates is null", () => {
    expect(
      resolveCheckSubtotal(check({ lines: [] }), inclusive(TWO_RATES)),
    ).toMatchObject({ subtotal: null, unresolved: NET_NOT_RECORDED.mixed });
  });

  it("a single category rate is not a statement about the rest: null", () => {
    expect(
      resolveCheckSubtotal(
        check({ lines: [] }),
        inclusive([rate(1, "pos_category", "Alcohol", 0.2)]),
      ),
    ).toMatchObject({ subtotal: null });
  });

  it("no rate at all is null, said as such", () => {
    expect(resolveCheckSubtotal(check(), inclusive([]))).toMatchObject({
      subtotal: null,
      unresolved: NET_NOT_RECORDED.noRate,
    });
  });

  it("no time zone: the check's day is unknown, so null", () => {
    expect(
      resolveCheckSubtotal(check(), inclusive(TWO_RATES, { zone: null })),
    ).toMatchObject({ subtotal: null, unresolved: NET_NOT_RECORDED.noZone });
  });

  it("no subtotal from the till stays null, stamped", () => {
    expect(
      resolveCheckSubtotal(check({ subtotal: null }), inclusive(TWO_RATES)),
    ).toMatchObject({ rung: "no_subtotal", subtotal: null, unresolved: null });
  });
});

describe("adapters: what the till states about tax", () => {
  it("the generic/CSV feed reads an optional check tax and per-line percent rates", () => {
    const [c] = genericAdapter.normalize({
      externalCheckId: "c1",
      subtotal: "1.200,00",
      tax: "200,00",
      items: [{ name: "Rakı", qty: 1, price: 1200, tax_rate: "%20" }],
    });
    expect(c.tax).toBe(200);
    expect(c.items[0].taxRate).toBeCloseTo(0.2, 10);
    expect(c.taxRateUnread).toBeUndefined();
  });

  it("a feed that names no tax reads exactly as before: no new keys", () => {
    const [c] = genericAdapter.normalize({
      externalCheckId: "c1",
      subtotal: 10,
      items: [{ name: "Tea", qty: 1, price: 10 }],
    });
    expect("tax" in c).toBe(false);
    expect("taxRateUnread" in c).toBe(false);
    expect("taxRate" in c.items[0]).toBe(false);
  });

  it.each(["0.20", 0.2, 100, -5, "1,000", "abc"])(
    "a line rate of %p is not guessed at: the check carries taxRateUnread",
    (v) => {
      const [c] = genericAdapter.normalize({
        externalCheckId: "c1",
        items: [{ name: "Wine", qty: 1, price: 10, tax_rate: v }],
      });
      expect(c.taxRateUnread).toEqual({ field: "items[0].tax_rate", value: v });
    },
  );

  it("0 is a real rate (zero-rated), and 8,25 is 8.25 percent", () => {
    expect(readTaxRate(0)).toEqual({ rate: 0 });
    expect(readTaxRate("8,25").rate).toBeCloseTo(0.0825, 10);
  });

  it("an unreadable check tax is named like any unread amount", () => {
    const [c] = genericAdapter.normalize({
      externalCheckId: "c1",
      tax: "1.250",
    });
    expect(c.moneyUnread).toEqual({ field: "tax", value: "1.250" });
  });

  it("Square says its subtotal is already pre-tax", () => {
    const [c] = squareAdapter.normalize({
      id: "o1",
      net_amounts: {
        total_money: { amount: 1200 },
        tax_money: { amount: 200 },
      },
    });
    expect(c.subtotal).toBe(10);
    expect(c.subtotalPreTax).toBe(true);
  });

  it("Toast's stated tax waits for a captured payload (ADR 0105 D4)", () => {
    const [c] = toastAdapter.normalize({
      guid: "t1",
      amount: 120,
      taxAmount: 20,
      totalAmount: 120,
      selections: [{ displayName: "Wine", quantity: 1, price: 120, tax: 20 }],
    });
    expect(c.subtotal).toBe(120);
    expect(c.tax).toBeUndefined();
    expect(c.subtotalPreTax).toBeUndefined();
    expect(c.items[0].taxRate).toBeUndefined();
  });
});
