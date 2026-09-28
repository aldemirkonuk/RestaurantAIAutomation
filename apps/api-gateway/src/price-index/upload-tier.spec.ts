/**
 * How big a decision an uploaded book is — the arithmetic, with no database.
 *
 * The cases that matter are the ones where the answer must be
 * `second_pair_of_eyes` even though nothing looks wrong: the FIRST book, and a
 * comparison that could not be made. Both are silences, and a silence read as a
 * pass is the fault this whole tier exists inside of.
 *
 * The one case that must stay ROUTINE is the ordinary quarterly repost. If that
 * held a book every quarter, the tier would be a rule that says "always two",
 * which the founder ruled out and which ten of fifteen houses cannot satisfy.
 */

import type { PostingSighting } from "./price-index.types";
import {
  CATALOGUE_SHIFT_LIMIT,
  FINGERPRINT_CAP,
  MEDIAN_MOVE_LIMIT,
  MOVED_SHARE_LIMIT,
  SINGLE_MOVE_LIMIT,
  chooseTier,
  diffEditions,
  diffSentence,
  fingerprintKey,
  fingerprintOf,
} from "./upload-tier";

function sighting(
  code: string,
  price: number,
  over: Partial<PostingSighting> = {},
): PostingSighting {
  return {
    sourceKey: "michigan-lcc-price-book",
    sourceClass: "posted_wholesale_list",
    state: "US-MI",
    region: null,
    issuer: "Michigan Liquor Control Commission",
    issuedAt: "2025-08-03",
    priceBasis: "licensee_price",
    productName: `Product ${code}`,
    brand: "Brand",
    producer: null,
    packageDesc: null,
    containerType: null,
    sizeValue: 750,
    sizeUnit: "Milliliter",
    price,
    currency: "USD",
    priceUnit: "per bottle",
    pack: 12,
    containerCharge: null,
    isPromotion: false,
    sourceStatus: null,
    attribution: null,
    sourceUrl: "https://www.michigan.gov/lara",
    sourceRef: `mlcc:price-book:2025-08-03#liquor_code=${code}`,
    externalIds: { liquor_code: code, ada: "" },
    raw: {},
    ...over,
  };
}

function book(prices: Record<string, number>): PostingSighting[] {
  return Object.entries(prices).map(([code, price]) => sighting(code, price));
}

describe("fingerprintKey", () => {
  it("uses the issuer's own product id, not sourceRef, so an item survives a reprint", () => {
    const august = sighting("10001", 14.41);
    const november = sighting("10001", 14.99, {
      issuedAt: "2025-11-02",
      sourceRef: "mlcc:price-book:2025-11-02#liquor_code=10001",
    });
    // The two sourceRefs differ by construction — the edition date is inside
    // them — so keying on sourceRef would make every item new every quarter.
    expect(august.sourceRef).not.toBe(november.sourceRef);
    expect(fingerprintKey(august)).toBe(fingerprintKey(november));
    expect(fingerprintKey(august)).toBe("liquor_code=10001");
  });

  it("falls back to the name and the package when a source states no id", () => {
    const s = sighting("10001", 14.41, { externalIds: {} });
    expect(fingerprintKey(s)).toBe("product 10001|750|milliliter|12|licensee_price");
  });
});

describe("fingerprintOf", () => {
  it("keeps the FIRST price on a duplicate key and counts the collision", () => {
    const rows = [sighting("1", 10), sighting("1", 99), sighting("2", 20)];
    const out = fingerprintOf(rows);
    expect(out.duplicateKeys).toBe(1);
    expect(out.items).toBe(2);
    expect(out.fingerprint).toEqual({ "liquor_code=1": 10, "liquor_code=2": 20 });
  });

  it("refuses a baseline past the cap rather than truncating one", () => {
    const rows = Array.from({ length: FINGERPRINT_CAP + 1 }, (_, i) =>
      sighting(String(i), 1, { externalIds: { liquor_code: String(i) } }),
    );
    const out = fingerprintOf(rows);
    expect(out.fingerprint).toBeNull();
    expect(out.refusedBecause).toMatch(/No baseline is kept rather than a truncated one/);
  });
});

describe("chooseTier", () => {
  it("holds the FIRST book — there is nothing to weigh it against", () => {
    const diff = diffEditions(null, { a: 1 });
    const v = chooseTier(diff);
    expect(v.tier).toBe("second_pair_of_eyes");
    expect(v.reasons).toEqual(["first_book"]);
    expect(v.sentences[0]).toMatch(/first edition of this book the register has ever held/);
  });

  it("holds a book whose comparison could not be MADE, and says which", () => {
    const diff = {
      ...diffEditions(null, null),
      incomparableBecause:
        "the last admitted edition of this book could not be read, so this one could not be weighed against it. This is unknown, not a first book.",
    };
    const v = chooseTier(diff);
    expect(v.tier).toBe("second_pair_of_eyes");
    expect(v.reasons).toEqual(["diff_untestable"]);
    expect(v.sentences[0]).toMatch(
      /A comparison that could not be made is not a comparison that passed/,
    );
  });

  it("lets an ordinary quarterly repost stand on one person's upload", () => {
    // 100 items; 10 of them move 2 percent. Inside every band.
    const prior: Record<string, number> = {};
    const next: Record<string, number> = {};
    for (let i = 0; i < 100; i += 1) {
      prior[`code=${i}`] = 20;
      next[`code=${i}`] = i < 10 ? 20.4 : 20;
    }
    const diff = diffEditions({ fingerprint: prior, editionDate: "2025-05-04" }, next);
    const v = chooseTier(diff);
    expect(diff.moved).toBe(10);
    expect(diff.movedShare).toBeCloseTo(0.1);
    expect(v.tier).toBe("routine");
    expect(v.reasons).toEqual([]);
  });

  it("holds a book where MOST of the catalogue repriced", () => {
    const prior: Record<string, number> = {};
    const next: Record<string, number> = {};
    for (let i = 0; i < 100; i += 1) {
      prior[`code=${i}`] = 20;
      next[`code=${i}`] = i < 40 ? 20.6 : 20;
    }
    const v = chooseTier(
      diffEditions({ fingerprint: prior, editionDate: "2025-05-04" }, next),
    );
    expect(v.tier).toBe("second_pair_of_eyes");
    expect(v.reasons).toContain("most_of_the_book_moved");
    expect(v.sentences.join(" ")).toContain(
      `${(MOVED_SHARE_LIMIT * 100).toFixed(1)}%`,
    );
  });

  it("holds a book whose catalogue changed size like a different book", () => {
    const prior: Record<string, number> = {};
    for (let i = 0; i < 100; i += 1) prior[`code=${i}`] = 20;
    const next: Record<string, number> = {};
    for (let i = 0; i < 70; i += 1) next[`code=${i}`] = 20;
    const diff = diffEditions({ fingerprint: prior, editionDate: "2025-05-04" }, next);
    expect(diff.catalogueShift).toBeCloseTo(-0.3);
    expect(Math.abs(diff.catalogueShift as number)).toBeGreaterThan(
      CATALOGUE_SHIFT_LIMIT,
    );
    expect(chooseTier(diff).reasons).toContain("catalogue_size_moved");
  });

  it("holds a book where ONE price moved a long way, which no average would show", () => {
    const prior: Record<string, number> = {};
    const next: Record<string, number> = {};
    for (let i = 0; i < 1000; i += 1) {
      prior[`code=${i}`] = 20;
      next[`code=${i}`] = 20;
    }
    next["code=7"] = 20 * (1 + SINGLE_MOVE_LIMIT + 0.1);
    const diff = diffEditions({ fingerprint: prior, editionDate: "2025-05-04" }, next);
    // The aggregate is untouched: 1 in 1000 moved.
    expect(diff.movedShare).toBeCloseTo(0.001);
    expect(diff.medianAbsMove).toBe(0);
    const v = chooseTier(diff);
    expect(v.tier).toBe("second_pair_of_eyes");
    expect(v.reasons).toEqual(["one_price_moved_a_lot"]);
    expect(v.sentences[0]).toContain("code=7");
  });

  it("records EVERY band that tripped, not the first", () => {
    const prior: Record<string, number> = {};
    const next: Record<string, number> = {};
    for (let i = 0; i < 100; i += 1) prior[`code=${i}`] = 20;
    for (let i = 0; i < 60; i += 1) next[`code=${i}`] = 40;
    const v = chooseTier(
      diffEditions({ fingerprint: prior, editionDate: "2025-05-04" }, next),
    );
    expect(v.reasons).toEqual([
      "catalogue_size_moved",
      "most_of_the_book_moved",
      "the_middle_of_the_book_moved",
      "one_price_moved_a_lot",
    ]);
    expect(v.sentences).toHaveLength(4);
  });

  it("never divides by a prior price of zero", () => {
    const diff = diffEditions(
      { fingerprint: { a: 0, b: 10 }, editionDate: "2025-05-04" },
      { a: 5, b: 10 },
    );
    expect(diff.matched).toBe(1);
    expect(diff.maxAbsMove).toBe(0);
    expect(chooseTier(diff).tier).toBe("routine");
  });
});

describe("diffSentence", () => {
  it("names the biggest move even when the book is routine", () => {
    const prior: Record<string, number> = {};
    const next: Record<string, number> = {};
    for (let i = 0; i < 100; i += 1) {
      prior[`code=${i}`] = 20;
      next[`code=${i}`] = 20;
    }
    next["code=3"] = 20 * (1 + MEDIAN_MOVE_LIMIT);
    const diff = diffEditions({ fingerprint: prior, editionDate: "2025-05-04" }, next);
    expect(chooseTier(diff).tier).toBe("routine");
    expect(diffSentence(diff)).toContain("The biggest move in this book: code=3");
    expect(diffSentence(diff)).toContain("Against the 2025-05-04 edition");
  });
});

describe("the real Michigan fixture, as a book", () => {
  it("is a first book against nothing, and routine against itself", () => {
    const rows = book({ "1": 10, "2": 20, "3": 30 });
    const first = fingerprintOf(rows).fingerprint as Record<string, number>;
    expect(chooseTier(diffEditions(null, first)).tier).toBe("second_pair_of_eyes");
    expect(
      chooseTier(
        diffEditions({ fingerprint: first, editionDate: "2025-08-03" }, first),
      ).tier,
    ).toBe("routine");
  });
});
