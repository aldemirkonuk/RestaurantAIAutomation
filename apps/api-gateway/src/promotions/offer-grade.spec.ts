import {
  COMPARISON_MAX_AGE_DAYS,
  bundleWorth,
  foldName,
  gradeOffer,
  gradeWine,
  lineMatchesWine,
  type LedgerLine,
  type OfferForGrade,
  type WineGrade,
} from "./offer-grade";

/**
 * The grade is the page's one exponential idea (DESIGN-FOUNDATION §6): a
 * marketing percentage turned into a fact about the house's own money. These
 * cases pin the rules the module says it will not bend — unit, currency,
 * bottle identity, the stated absences, landed-cost-first — and the
 * arithmetic of the sentence and the worth figure it produces.
 */

const WINDOW = 540;
/** The day the grade is struck: a fixed date, so no case reads the clock. */
const AS_OF = "2026-04-01";

function line(over: Partial<LedgerLine>): LedgerLine {
  return {
    kind: "paid",
    ref: "price_history:x",
    providerId: "vendor-a",
    providerName: "Sevilen",
    productKey: null,
    identityId: null,
    productName: "Kalecik Karası 2021",
    price: 420,
    unit: "bottle",
    currency: "TRY",
    date: "2026-03-14",
    source: "receipt_verified",
    scope: "house",
    quantity: null,
    note: null,
    ...over,
  };
}

const offer = (over: Partial<OfferForGrade> = {}): OfferForGrade => ({
  id: "offer-1",
  providerId: "vendor-a",
  wines: ["Kalecik Karası 2021"],
  discount: { percent: 12, amount: null, currency: null, freeShipping: false },
  minimum: null,
  ...over,
});

function grade(wine: string, o: OfferForGrade, ledger: LedgerLine[]): WineGrade {
  return gradeWine(wine, o, ledger, [], WINDOW, AS_OF);
}

describe("foldName", () => {
  it("folds diacritics, the Turkish dotless i, case and punctuation", () => {
    expect(foldName("Kalecik Karası 2021")).toBe("kalecik karasi 2021");
    expect(foldName("KALECİK  KARASI, 2021")).toBe("kalecik karasi 2021");
    expect(foldName("Öküzgözü")).toBe("okuzgozu");
    expect(foldName(null)).toBe("");
  });
});

describe("lineMatchesWine", () => {
  it("matches on the inventory bridge key before any name", () => {
    const l = line({ productKey: "mw-1", productName: "something else" });
    expect(lineMatchesWine(l, "Kalecik Karası 2021", "mw-1")).toBe(true);
  });
  it("matches an equal folded name", () => {
    expect(lineMatchesWine(line({ productName: "kalecik karasi 2021" }), "Kalecik Karası 2021", null)).toBe(true);
  });
  it("matches a longer ledger name that contains the offer's name, but not a four-character vintage alone", () => {
    expect(lineMatchesWine(line({ productName: "Kalecik Karası 2021 750ml" }), "Kalecik Karası 2021", null)).toBe(true);
    expect(lineMatchesWine(line({ productName: "Kalecik Karası 2021" }), "2021", null)).toBe(false);
  });
  it("does not match a different wine", () => {
    expect(lineMatchesWine(line({ productName: "Öküzgözü 2022" }), "Kalecik Karası 2021", null)).toBe(false);
  });
});

describe("gradeWine — the sentence's arithmetic", () => {
  it("12% off the vendor's last price, 4% above what Vendor B charged — the founder's example", () => {
    // 420 × 0.88 = 369.6; Vendor B at 355 → +4.1%
    const ledger = [
      line({ ref: "price_history:a", price: 420 }),
      line({ ref: "price_history:b", providerId: "vendor-b", providerName: "Vendor B", price: 355, date: "2026-03-02" }),
    ];
    const g = grade("Kalecik Karası 2021", offer(), ledger);
    expect(g.verdict).toBe("above");
    expect(g.baseline?.ref).toBe("price_history:a");
    expect(g.offered).toEqual(
      expect.objectContaining({ price: 369.6, unit: "bottle", currency: "TRY" }),
    );
    expect(g.bestElsewhere?.providerName).toBe("Vendor B");
    expect(g.deltaPct).toBe(4.1);
  });

  it("beats when the offered price is below every other vendor's", () => {
    const ledger = [
      line({ ref: "price_history:a", price: 400 }),
      line({ ref: "price_history:b", providerId: "vendor-b", providerName: "Vendor B", price: 380 }),
    ];
    const g = grade("Kalecik Karası 2021", offer(), ledger);
    expect(g.verdict).toBe("beats");
    expect(g.deltaPct).toBe(-7.4);
  });

  it("matches within half a percent", () => {
    const ledger = [
      line({ ref: "price_history:a", price: 100 }),
      line({ ref: "price_history:b", providerId: "vendor-b", price: 88.2 }),
    ];
    expect(grade("Kalecik Karası 2021", offer(), ledger).verdict).toBe("matches");
  });

  it("uses the vendor's MOST RECENT paid line as the baseline, preferring paid over a sighting on the same day", () => {
    const ledger = [
      line({ ref: "price_history:old", price: 500, date: "2026-01-10" }),
      line({ ref: "price_history:new", price: 420, date: "2026-03-14" }),
      line({ ref: "vendor_price_observations:s", kind: "sighting", price: 999, date: "2026-03-14", source: "invoice" }),
    ];
    const g = grade("Kalecik Karası 2021", offer(), ledger);
    expect(g.baseline?.ref).toBe("price_history:new");
  });

  it("a sighting stands in for the baseline only when this vendor has no paid line at all", () => {
    const ledger = [
      line({ ref: "vendor_price_observations:s", kind: "sighting", price: 500, date: "2026-03-14", source: "invoice" }),
    ];
    const g = grade("Kalecik Karası 2021", offer(), ledger);
    expect(g.baseline?.ref).toBe("vendor_price_observations:s");
  });

  it("LANDED COST FIRST (ADR 0054 rule 6): a receipt_verified line wins the baseline over a newer order_confirmed one", () => {
    const ledger = [
      line({ ref: "price_history:landed", price: 400, date: "2026-01-10", source: "receipt_verified" }),
      line({ ref: "price_history:agreed", price: 450, date: "2026-03-14", source: "order_confirmed" }),
    ];
    const g = grade("Kalecik Karası 2021", offer(), ledger);
    expect(g.baseline?.ref).toBe("price_history:landed");
    expect(g.offered?.derivation).toContain("landed price");
    expect(g.offered?.derivation).not.toContain("AGREED");
  });

  it("falls back to an agreed-only baseline when no receipt_verified line exists, and says so in the derivation", () => {
    const ledger = [line({ ref: "price_history:agreed", price: 420, source: "order_confirmed" })];
    const g = grade("Kalecik Karası 2021", offer(), ledger);
    expect(g.baseline?.ref).toBe("price_history:agreed");
    expect(g.offered?.derivation).toContain("AGREED price — never checked against an invoice");
  });

  it("landed cost first also governs bestElsewhere: a receipt_verified line from the other vendor wins over its own cheaper order_confirmed line", () => {
    const ledger = [
      line({ ref: "price_history:a", price: 420 }),
      line({ ref: "price_history:b1", providerId: "vendor-b", price: 300, source: "order_confirmed" }),
      line({ ref: "price_history:b2", providerId: "vendor-b", price: 355, source: "receipt_verified" }),
    ];
    const g = grade("Kalecik Karası 2021", offer(), ledger);
    expect(g.bestElsewhere?.ref).toBe("price_history:b2");
  });

  it("never compares across units — the case line is skipped with its reason, never converted", () => {
    const ledger = [
      line({ ref: "price_history:a", price: 420 }),
      line({ ref: "price_history:b", providerId: "vendor-b", price: 4000, unit: "case" }),
    ];
    const g = grade("Kalecik Karası 2021", offer(), ledger);
    expect(g.verdict).toBe("no_elsewhere");
    expect(g.bestElsewhere).toBeNull();
    expect(g.skipped).toEqual([
      { ref: "price_history:b", reason: expect.stringContaining("not comparable across units") },
    ]);
  });

  it("never pools two different bottle identities under one unit (ADR 0124 Q5) — skipped with its reason", () => {
    const ledger = [
      line({ ref: "price_history:a", price: 420, identityId: "id-750" }),
      line({ ref: "price_history:b", providerId: "vendor-b", price: 210, identityId: "id-375" }),
    ];
    const g = grade("Kalecik Karası 2021", offer(), ledger);
    expect(g.verdict).toBe("no_elsewhere");
    expect(g.skipped).toEqual([
      { ref: "price_history:b", reason: expect.stringContaining("different bottle identity") },
    ]);
  });

  it("never compares across currencies, and a missing currency is a reason rather than a zero", () => {
    const ledger = [
      line({ ref: "price_history:a", price: 420 }),
      line({ ref: "price_history:b", providerId: "vendor-b", price: 300, currency: "USD" }),
      line({ ref: "price_history:c", providerId: "vendor-c", price: 300, currency: null }),
    ];
    const g = grade("Kalecik Karası 2021", offer(), ledger);
    expect(g.verdict).toBe("no_elsewhere");
    expect(g.skipped.map((s) => s.ref).sort()).toEqual(["price_history:b", "price_history:c"]);
    expect(g.skipped.find((s) => s.ref === "price_history:c")?.reason).toContain("not recorded");
  });

  it("an amount off needs the same money as the baseline", () => {
    const ledger = [line({ ref: "price_history:a", price: 420, currency: "TRY" })];
    const g = grade(
      "Kalecik Karası 2021",
      offer({ discount: { percent: null, amount: 5, currency: "USD", freeShipping: false } }),
      ledger,
    );
    expect(g.offered).toBeNull();
    expect(g.verdict).toBe("not_a_price");
    expect(g.skipped[0].reason).toContain("not the same money");
  });

  it("an amount off in the same money is taken from the baseline", () => {
    const ledger = [
      line({ ref: "price_history:a", price: 420, currency: "TRY" }),
      line({ ref: "price_history:b", providerId: "vendor-b", price: 400, currency: "TRY" }),
    ];
    const g = grade(
      "Kalecik Karası 2021",
      offer({ discount: { percent: null, amount: 30, currency: "TRY", freeShipping: false } }),
      ledger,
    );
    expect(g.offered?.price).toBe(390);
    expect(g.verdict).toBe("beats");
  });

  it("no baseline: the house never bought this wine from this vendor — the most recent house line is the reference", () => {
    const ledger = [
      line({ ref: "price_history:b", providerId: "vendor-b", providerName: "Vendor B", price: 355, date: "2026-03-02" }),
    ];
    const g = grade("Kalecik Karası 2021", offer(), ledger);
    expect(g.verdict).toBe("no_baseline");
    expect(g.baseline).toBeNull();
    expect(g.offered).toBeNull();
    expect(g.reference?.providerName).toBe("Vendor B");
  });

  it("unknown wine: nothing in the ledger names it", () => {
    const g = grade("Öküzgözü 2022", offer(), [line({})]);
    expect(g.verdict).toBe("unknown_wine");
    expect(g.matchedAs).toBeNull();
  });

  it("the open market is context beside the verdict, never the verdict", () => {
    const ledger = [
      line({ ref: "price_history:a", price: 420 }),
      line({
        ref: "vendor_price_observations:m",
        kind: "sighting",
        providerId: null,
        providerName: null,
        price: 300,
        scope: "open_market",
        source: "website_scrape",
      }),
    ];
    const g = grade("Kalecik Karası 2021", offer(), ledger);
    expect(g.market?.ref).toBe("vendor_price_observations:m");
    expect(g.verdict).toBe("no_elsewhere");
  });
});

describe("gradeWine — worth (sketch 113 direction B, the size-driving figure)", () => {
  it("is withheld — never zero — when there is no other vendor to be worth anything against", () => {
    const ledger = [line({ ref: "price_history:a", price: 420, quantity: 40 })];
    const g = grade("Kalecik Karası 2021", offer(), ledger);
    expect(g.verdict).toBe("no_elsewhere");
    expect(g.worth).toBeNull();
  });

  it("is withheld when the window holds no purchase quantity for this wine, even with a bestElsewhere line", () => {
    const ledger = [
      line({ ref: "price_history:a", price: 420, quantity: null }),
      line({ ref: "price_history:b", providerId: "vendor-b", price: 380, quantity: null }),
    ];
    const g = grade("Kalecik Karası 2021", offer(), ledger);
    expect(g.verdict).toBe("beats");
    expect(g.worth).toBeNull();
  });

  it("sums quantity across EVERY vendor's matched lines in the baseline's unit — the house's own buying rate, not one vendor's", () => {
    // offered = 420 * 0.88 = 369.6; bestElsewhere (vendor-b) = 380 → beats by 10.4 per bottle
    const ledger = [
      line({ ref: "price_history:a", price: 420, quantity: 12, date: "2026-03-14" }),
      line({ ref: "price_history:a2", price: 420, quantity: 8, date: "2026-02-01" }),
      line({ ref: "price_history:b", providerId: "vendor-b", price: 380, quantity: 20, date: "2026-01-01" }),
      // a case-unit line for the same wine must NOT be pooled into the bottle quantity
      line({ ref: "price_history:case", price: 4000, unit: "case", quantity: 99 }),
    ];
    const g = grade("Kalecik Karası 2021", offer(), ledger);
    expect(g.verdict).toBe("beats");
    expect(g.worth?.currency).toBe("TRY");
    expect(g.worth?.quantity).toBe(40);
    expect(g.worth?.invoiceLines).toBe(3);
    expect(g.worth?.windowDays).toBe(WINDOW);
    // (380 - 369.6) * 40 = 416
    expect(g.worth?.amount).toBeCloseTo(416, 2);
  });

  it("a quantity floor never inflates: an unrecorded (null) quantity line contributes nothing to the sum", () => {
    const ledger = [
      line({ ref: "price_history:a", price: 420, quantity: 5 }),
      line({ ref: "price_history:a2", price: 420, quantity: null }),
      line({ ref: "price_history:b", providerId: "vendor-b", price: 380, quantity: 1 }),
    ];
    const g = grade("Kalecik Karası 2021", offer(), ledger);
    expect(g.worth?.quantity).toBe(6);
    expect(g.worth?.invoiceLines).toBe(2);
  });
});

describe("gradeWine — the comparison price must be recent (ADR 0165 rule 3)", () => {
  const withElsewhere = (elsewhereDate: string | null) => [
    line({ ref: "price_history:a", price: 420, quantity: 12, date: "2026-03-14" }),
    line({ ref: "price_history:b", providerId: "vendor-b", providerName: "Kavaklidere", price: 380, quantity: 20, date: elsewhereDate }),
  ];

  it("sizes on a comparison price exactly at the limit, and states the date, age and limit beside the figure", () => {
    // 2026-04-01 minus 180 days = 2025-10-03
    const g = grade("Kalecik Karası 2021", offer(), withElsewhere("2025-10-03"));
    expect(g.worth).not.toBeNull();
    expect(g.worth?.comparisonDate).toBe("2025-10-03");
    expect(g.worth?.comparisonAgeDays).toBe(COMPARISON_MAX_AGE_DAYS);
    expect(g.worth?.maxAgeDays).toBe(COMPARISON_MAX_AGE_DAYS);
    expect(g.worthWithheld).toBeNull();
  });

  it("withholds the worth one day past the limit, naming the vendor, the age and the cutoff — and leaves the verdict alone", () => {
    const g = grade("Kalecik Karası 2021", offer(), withElsewhere("2025-10-02"));
    expect(g.verdict).toBe("beats");
    expect(g.worth).toBeNull();
    expect(g.worthWithheld).toContain("Kavaklidere");
    expect(g.worthWithheld).toContain("181 days old");
    expect(g.worthWithheld).toContain(`${COMPARISON_MAX_AGE_DAYS} days`);
  });

  it("withholds when the comparison line has no date — it cannot be shown to be current", () => {
    const g = grade("Kalecik Karası 2021", offer(), withElsewhere(null));
    expect(g.worth).toBeNull();
    expect(g.worthWithheld).toContain("no date");
  });

  it("withholds when the comparison line is dated after the day of grading", () => {
    const g = grade("Kalecik Karası 2021", offer(), withElsewhere("2026-04-02"));
    expect(g.worth).toBeNull();
    expect(g.worthWithheld).toContain("after today");
  });

  it("leaves worthWithheld null when the worth is simply not producible (no other vendor) — nothing was refused", () => {
    const g = grade("Kalecik Karası 2021", offer(), [line({ ref: "price_history:a", quantity: 40 })]);
    expect(g.worth).toBeNull();
    expect(g.worthWithheld).toBeNull();
  });
});

describe("gradeOffer — the offer must qualify before it can size a box (ADR 0165 rule 1)", () => {
  const ledger = (orders: Array<Partial<LedgerLine>>): LedgerLine[] => [
    line({ ref: "price_history:base", price: 420, quantity: 1, date: "2026-03-14" }),
    line({ ref: "price_history:else", providerId: "vendor-b", price: 380, quantity: 1, date: "2026-03-01" }),
    ...orders.map((o, i) => line({ ref: `price_history:o${i}`, providerId: "vendor-b", price: 380, ...o })),
  ];
  const run = (minimum: { quantity: number | null; unit: string | null } | null, orders: Array<Partial<LedgerLine>>, wines = ["Kalecik Karası 2021"]) =>
    gradeOffer(offer({ minimum, wines }), ledger(orders), [], WINDOW, AS_OF);

  it("states no qualification, and keeps the worth, when the offer names no minimum", () => {
    const g = run(null, [{ quantity: 6, date: "2026-02-01" }]);
    expect(g.qualification).toBeNull();
    expect(g.wines[0].worth).not.toBeNull();
  });

  it("qualifies when one order reaches the minimum in its unit — and keeps the worth", () => {
    const g = run({ quantity: 12, unit: "bottle" }, [{ quantity: 12, date: "2026-02-01" }]);
    expect(g.qualification?.state).toBe("qualifies");
    expect(g.qualification?.largestOrder).toBeGreaterThanOrEqual(12);
    expect(g.qualification?.reason).toBeNull();
    expect(g.wines[0].worth).not.toBeNull();
  });

  it("does NOT qualify a steady small buyer: many small orders never add up to one big order", () => {
    const small = Array.from({ length: 8 }, (_, i) => ({ quantity: 3, date: `2026-01-0${i + 1}` }));
    const g = run({ quantity: 12, unit: "bottle" }, small);
    expect(g.qualification?.state).toBe("not_shown");
    expect(g.qualification?.largestOrder).toBe(3);
    expect(g.qualification?.reason).toContain("not shown");
    expect(g.wines[0].worth).toBeNull();
    expect(g.wines[0].worthWithheld).toBe(g.qualification?.reason);
    // the verdict is untouched: qualification gates the size, not the fact
    expect(g.wines[0].verdict).toBe("beats");
  });

  it("counts an order as one vendor on one day: two lines the same day, same vendor, are one order", () => {
    const g = run({ quantity: 12, unit: "bottle" }, [
      { quantity: 6, date: "2026-02-01" },
      { ref: "price_history:o1b", quantity: 6, date: "2026-02-01" },
    ]);
    expect(g.qualification?.state).toBe("qualifies");
  });

  it("does not pool two vendors, or two days, into one order", () => {
    const g = run({ quantity: 12, unit: "bottle" }, [
      { quantity: 6, date: "2026-02-01" },
      { ref: "price_history:o1b", providerId: "vendor-c", quantity: 6, date: "2026-02-01" },
      { ref: "price_history:o1c", quantity: 6, date: "2026-02-02" },
    ]);
    expect(g.qualification?.state).toBe("not_shown");
    expect(g.qualification?.largestOrder).toBe(6);
  });

  it("sums the offer's NAMED wines inside one order, but no wine the offer does not name", () => {
    const wines = ["Kalecik Karası 2021", "Öküzgözü 2022"];
    const orders = [
      { quantity: 6, date: "2026-02-01" },
      { ref: "price_history:o1", productName: "Öküzgözü 2022", quantity: 6, date: "2026-02-01" },
      { ref: "price_history:o2", productName: "Narince 2023", quantity: 50, date: "2026-02-01" },
    ];
    expect(run({ quantity: 12, unit: "bottle" }, orders, wines).qualification?.state).toBe("qualifies");
    expect(run({ quantity: 13, unit: "bottle" }, orders, wines).qualification?.state).toBe("not_shown");
  });

  it("never converts units: a big CASE order does not satisfy a minimum stated in bottles", () => {
    const g = run({ quantity: 12, unit: "bottle" }, [{ quantity: 99, unit: "case", price: 4000, date: "2026-02-01" }]);
    expect(g.qualification?.state).toBe("not_shown");
  });

  it("an unrecorded (null) quantity counts for nothing, so the state can only understate", () => {
    const g = run({ quantity: 12, unit: "bottle" }, [{ quantity: null, date: "2026-02-01" }]);
    expect(g.qualification?.state).toBe("not_shown");
  });

  it("a minimum with no unit cannot be compared: worth withheld with the reason, and no order size is claimed", () => {
    const g = run({ quantity: 12, unit: null }, [{ quantity: 500, date: "2026-02-01" }]);
    expect(g.qualification?.state).toBe("unit_unknown");
    expect(g.qualification?.largestOrder).toBeNull();
    expect(g.qualification?.reason).toContain("without saying bottles or cases");
    expect(g.wines[0].worth).toBeNull();
    expect(g.wines[0].worthWithheld).toBe(g.qualification?.reason);
  });

  it("a unit outside the seven the ledger holds is treated as no unit", () => {
    expect(run({ quantity: 12, unit: "pallet" }, [{ quantity: 500, date: "2026-02-01" }]).qualification?.state).toBe(
      "unit_unknown",
    );
  });

  it("a bundle's rollup is withheld when the offer does not qualify (no partial worth survives)", () => {
    const wines = ["Kalecik Karası 2021"];
    const g = run({ quantity: 12, unit: null }, [{ quantity: 500, date: "2026-02-01" }], wines);
    expect(bundleWorth(g.wines)).toBeNull();
  });

  it("a non-positive minimum states no qualification (the caller normalises, the grader still does not divide by it)", () => {
    expect(run({ quantity: 0, unit: "bottle" }, [{ quantity: 1, date: "2026-02-01" }]).qualification).toBeNull();
  });
});

describe("gradeOffer — the offer-level states", () => {
  it("an empty ledger is its own state, not a list of unknown wines", () => {
    const g = gradeOffer(offer(), [], [], WINDOW, AS_OF);
    expect(g.status).toBe("no_ledger_lines");
    expect(g.wines).toEqual([]);
  });
  it("free shipping alone is not a price", () => {
    const g = gradeOffer(
      offer({ discount: { percent: null, amount: null, currency: null, freeShipping: true } }),
      [line({})],
      [],
      WINDOW,
      AS_OF,
    );
    expect(g.status).toBe("not_a_price");
  });
  it("an offer that names no wine cannot be graded, and says so", () => {
    const g = gradeOffer(offer({ wines: [] }), [line({})], [], WINDOW, AS_OF);
    expect(g.status).toBe("no_wines");
  });
  it("tallies the verdicts and states the house's history with the vendor", () => {
    const ledger = [
      line({ ref: "price_history:a", price: 420, date: "2026-03-14" }),
      line({ ref: "price_history:b", providerId: "vendor-b", price: 355 }),
      line({ ref: "price_history:c", productName: "Öküzgözü 2022", price: 300, date: "2026-02-01" }),
      line({ ref: "price_history:d", providerId: "vendor-b", productName: "Öküzgözü 2022", price: 290 }),
    ];
    const g = gradeOffer(offer({ wines: ["Kalecik Karası 2021", "Öküzgözü 2022", "Narince 2023"] }), ledger, [], WINDOW, AS_OF);
    expect(g.status).toBe("graded");
    expect(g.tally).toEqual({ beats: 1, matches: 0, above: 1, ungraded: 1 });
    expect(g.vendor).toEqual({ lastPurchaseDate: "2026-03-14", paidLines: 2 });
  });
  it("dedups a wine the mail names twice", () => {
    const g = gradeOffer(offer({ wines: ["Kalecik Karası 2021", "Kalecik Karası 2021 "] }), [line({})], [], WINDOW, AS_OF);
    expect(g.wines).toHaveLength(1);
  });
});

describe("bundleWorth — the aggregate rollup for a bundle offer (sketch 113, bundles as their own shape)", () => {
  it("is null when the offer names no wine the ledger could even attempt to match", () => {
    expect(bundleWorth([grade("Öküzgözü 2022", offer({ wines: ["Öküzgözü 2022"] }), [])])).toBeNull();
  });

  it("is withheld — not partially summed — the instant ONE named line has no worth", () => {
    const ledgerWithWorth = [
      line({ ref: "price_history:a", price: 420, quantity: 10 }),
      line({ ref: "price_history:b", providerId: "vendor-b", price: 380, quantity: 5 }),
    ];
    const graded = grade("Kalecik Karası 2021", offer(), ledgerWithWorth);
    expect(graded.worth).not.toBeNull();
    // A second wine on the same bundle offer with no other vendor at all — no worth.
    const noWorth = grade("Narince 2023", offer({ wines: ["Narince 2023"] }), [
      line({ ref: "price_history:c", productName: "Narince 2023", price: 200 }),
    ]);
    expect(noWorth.worth).toBeNull();
    expect(bundleWorth([graded, noWorth])).toBeNull();
  });

  it("sums every named line's worth when every one of them has a worth, in the same currency", () => {
    const ledgerA = [
      line({ ref: "price_history:a", price: 420, quantity: 10 }),
      line({ ref: "price_history:b", providerId: "vendor-b", price: 380, quantity: 5 }),
    ];
    const a = grade("Kalecik Karası 2021", offer(), ledgerA);
    const ledgerB = [
      line({ ref: "price_history:c", productName: "Narince 2023", price: 300, quantity: 4 }),
      line({
        ref: "price_history:d",
        providerId: "vendor-b",
        productName: "Narince 2023",
        price: 260,
        quantity: 3,
      }),
    ];
    const b = grade("Narince 2023", offer({ wines: ["Narince 2023"] }), ledgerB);
    expect(a.worth).not.toBeNull();
    expect(b.worth).not.toBeNull();
    const total = bundleWorth([a, b]);
    expect(total).not.toBeNull();
    expect(total?.linesCounted).toBe(2);
    expect(total?.amount).toBeCloseTo((a.worth!.amount + b.worth!.amount), 2);
  });
});
