import {
  foldName,
  gradeOffer,
  gradeWine,
  lineMatchesWine,
  type LedgerLine,
  type OfferForGrade,
} from "./offer-grade";

/**
 * The grade is the page's one exponential idea (DESIGN-FOUNDATION §6): a
 * marketing percentage turned into a fact about the house's own money. These
 * cases pin the rules the module says it will not bend — unit, currency, the
 * stated absences — and the arithmetic of the one sentence it produces.
 */

function line(over: Partial<LedgerLine>): LedgerLine {
  return {
    kind: "paid",
    ref: "price_history:x",
    providerId: "vendor-a",
    providerName: "Sevilen",
    productKey: null,
    productName: "Kalecik Karası 2021",
    price: 420,
    unit: "bottle",
    currency: "TRY",
    date: "2026-03-14",
    source: "receipt_verified",
    scope: "house",
    note: null,
    ...over,
  };
}

const offer = (over: Partial<OfferForGrade> = {}): OfferForGrade => ({
  id: "offer-1",
  providerId: "vendor-a",
  wines: ["Kalecik Karası 2021"],
  discount: { percent: 12, amount: null, currency: null, freeShipping: false },
  ...over,
});

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
    const g = gradeWine("Kalecik Karası 2021", offer(), ledger, []);
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
    const g = gradeWine("Kalecik Karası 2021", offer(), ledger, []);
    expect(g.verdict).toBe("beats");
    expect(g.deltaPct).toBe(-7.4);
  });

  it("matches within half a percent", () => {
    const ledger = [
      line({ ref: "price_history:a", price: 100 }),
      line({ ref: "price_history:b", providerId: "vendor-b", price: 88.2 }),
    ];
    expect(gradeWine("Kalecik Karası 2021", offer(), ledger, []).verdict).toBe("matches");
  });

  it("uses the vendor's MOST RECENT paid line as the baseline, preferring paid over a sighting on the same day", () => {
    const ledger = [
      line({ ref: "price_history:old", price: 500, date: "2026-01-10" }),
      line({ ref: "price_history:new", price: 420, date: "2026-03-14" }),
      line({ ref: "vendor_price_observations:s", kind: "sighting", price: 999, date: "2026-03-14", source: "invoice" }),
    ];
    const g = gradeWine("Kalecik Karası 2021", offer(), ledger, []);
    expect(g.baseline?.ref).toBe("price_history:new");
  });

  it("never compares across units — the case line is skipped with its reason, never converted", () => {
    const ledger = [
      line({ ref: "price_history:a", price: 420 }),
      line({ ref: "price_history:b", providerId: "vendor-b", price: 4000, unit: "case" }),
    ];
    const g = gradeWine("Kalecik Karası 2021", offer(), ledger, []);
    expect(g.verdict).toBe("no_elsewhere");
    expect(g.bestElsewhere).toBeNull();
    expect(g.skipped).toEqual([
      { ref: "price_history:b", reason: expect.stringContaining("not comparable across units") },
    ]);
  });

  it("never compares across currencies, and a missing currency is a reason rather than a zero", () => {
    const ledger = [
      line({ ref: "price_history:a", price: 420 }),
      line({ ref: "price_history:b", providerId: "vendor-b", price: 300, currency: "USD" }),
      line({ ref: "price_history:c", providerId: "vendor-c", price: 300, currency: null }),
    ];
    const g = gradeWine("Kalecik Karası 2021", offer(), ledger, []);
    expect(g.verdict).toBe("no_elsewhere");
    expect(g.skipped.map((s) => s.ref).sort()).toEqual(["price_history:b", "price_history:c"]);
    expect(g.skipped.find((s) => s.ref === "price_history:c")?.reason).toContain("not recorded");
  });

  it("an amount off needs the same money as the baseline", () => {
    const ledger = [line({ ref: "price_history:a", price: 420, currency: "TRY" })];
    const g = gradeWine(
      "Kalecik Karası 2021",
      offer({ discount: { percent: null, amount: 5, currency: "USD", freeShipping: false } }),
      ledger,
      [],
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
    const g = gradeWine(
      "Kalecik Karası 2021",
      offer({ discount: { percent: null, amount: 30, currency: "TRY", freeShipping: false } }),
      ledger,
      [],
    );
    expect(g.offered?.price).toBe(390);
    expect(g.verdict).toBe("beats");
  });

  it("no baseline: the house never bought this wine from this vendor — the most recent house line is the reference", () => {
    const ledger = [
      line({ ref: "price_history:b", providerId: "vendor-b", providerName: "Vendor B", price: 355, date: "2026-03-02" }),
    ];
    const g = gradeWine("Kalecik Karası 2021", offer(), ledger, []);
    expect(g.verdict).toBe("no_baseline");
    expect(g.baseline).toBeNull();
    expect(g.offered).toBeNull();
    expect(g.reference?.providerName).toBe("Vendor B");
  });

  it("unknown wine: nothing in the ledger names it", () => {
    const g = gradeWine("Öküzgözü 2022", offer(), [line({})], []);
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
    const g = gradeWine("Kalecik Karası 2021", offer(), ledger, []);
    expect(g.market?.ref).toBe("vendor_price_observations:m");
    expect(g.verdict).toBe("no_elsewhere");
  });
});

describe("gradeOffer — the offer-level states", () => {
  it("an empty ledger is its own state, not a list of unknown wines", () => {
    const g = gradeOffer(offer(), [], []);
    expect(g.status).toBe("no_ledger_lines");
    expect(g.wines).toEqual([]);
  });
  it("free shipping alone is not a price", () => {
    const g = gradeOffer(
      offer({ discount: { percent: null, amount: null, currency: null, freeShipping: true } }),
      [line({})],
      [],
    );
    expect(g.status).toBe("not_a_price");
  });
  it("an offer that names no wine cannot be graded, and says so", () => {
    const g = gradeOffer(offer({ wines: [] }), [line({})], []);
    expect(g.status).toBe("no_wines");
  });
  it("tallies the verdicts and states the house's history with the vendor", () => {
    const ledger = [
      line({ ref: "price_history:a", price: 420, date: "2026-03-14" }),
      line({ ref: "price_history:b", providerId: "vendor-b", price: 355 }),
      line({ ref: "price_history:c", productName: "Öküzgözü 2022", price: 300, date: "2026-02-01" }),
      line({ ref: "price_history:d", providerId: "vendor-b", productName: "Öküzgözü 2022", price: 290 }),
    ];
    const g = gradeOffer(offer({ wines: ["Kalecik Karası 2021", "Öküzgözü 2022", "Narince 2023"] }), ledger, []);
    expect(g.status).toBe("graded");
    expect(g.tally).toEqual({ beats: 1, matches: 0, above: 1, ungraded: 1 });
    expect(g.vendor).toEqual({ lastPurchaseDate: "2026-03-14", paidLines: 2 });
  });
  it("dedups a wine the mail names twice", () => {
    const g = gradeOffer(offer({ wines: ["Kalecik Karası 2021", "Kalecik Karası 2021 "] }), [line({})], []);
    expect(g.wines).toHaveLength(1);
  });
});
