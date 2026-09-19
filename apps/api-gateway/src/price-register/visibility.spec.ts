/**
 * The register's one enforcement point, tested without a database.
 *
 * The whole point of `scopePriceRegisterRead` is that it is the ONE place the
 * visibility rule is written, so these tests assert the exact PostgREST
 * predicates it emits. A test that only checked "a filter was applied" would
 * pass on a filter that lets another house's rows through, which is the fault
 * this file exists to prevent.
 */
import {
  CONTRIBUTED_AGGREGATE_ONLY,
  MARKET_VISIBILITY,
  NOT_CONTRIBUTED_ONLY,
  PRICE_INDEX_POSTINGS,
  REGISTER_VISIBILITY_STATES,
  VENDOR_PRICE_OBSERVATIONS,
  scopePriceRegisterRead,
} from "./visibility";

/**
 * A PostgREST builder that records what was asked of it. Every method returns
 * the same object, exactly as the real builder returns `this`.
 */
function recorder() {
  const calls: { or: string[]; is: Array<[string, unknown]>; eq: Array<[string, unknown]> } = {
    or: [],
    is: [],
    eq: [],
  };
  const q: any = {
    or(filters: string) {
      calls.or.push(filters);
      return q;
    },
    is(column: string, value: unknown) {
      calls.is.push([column, value]);
      return q;
    },
    eq(column: string, value: unknown) {
      calls.eq.push([column, value]);
      return q;
    },
  };
  return { q, calls };
}

const HOUSE = "11111111-1111-1111-1111-111111111111";

describe("scopePriceRegisterRead — vendor_price_observations", () => {
  it("excludes the third state on EVERY scope, including the cross-house one", () => {
    const scopes = [
      { kind: "houseAndOpenMarket", restaurantId: HOUSE },
      { kind: "houseOwnRowsOnly", restaurantId: HOUSE },
      { kind: "openMarketOnly" },
      { kind: "everyHouse", because: "a stated reason" },
    ] as const;

    for (const scope of scopes) {
      const { q, calls } = recorder();
      scopePriceRegisterRead(q, VENDOR_PRICE_OBSERVATIONS, scope as any);
      expect(calls.or).toContain(NOT_CONTRIBUTED_ONLY);
      // It is applied FIRST, before any scope can widen the read.
      expect(calls.or[0]).toBe(NOT_CONTRIBUTED_ONLY);
    }
  });

  it("keeps the `visibility.is.null` arm, which is what makes the predicate a filter and not an emptier", () => {
    // Every row on the register today has a NULL visibility. A bare
    // `visibility.neq.<third>` follows SQL three-valued logic and drops them
    // all, so the ladder would go empty rather than unfiltered -- a failure
    // that looks like "no vendor sells this".
    expect(NOT_CONTRIBUTED_ONLY).toBe(
      `visibility.is.null,visibility.neq.${CONTRIBUTED_AGGREGATE_ONLY}`,
    );
    expect(NOT_CONTRIBUTED_ONLY.startsWith("visibility.is.null,")).toBe(true);
  });

  it("houseAndOpenMarket reads this house's rows plus the openly posted ones", () => {
    const { q, calls } = recorder();
    scopePriceRegisterRead(q, VENDOR_PRICE_OBSERVATIONS, {
      kind: "houseAndOpenMarket",
      restaurantId: HOUSE,
    });
    expect(calls.or).toEqual([
      NOT_CONTRIBUTED_ONLY,
      `restaurant_id.is.null,restaurant_id.eq.${HOUSE}`,
    ]);
    expect(calls.is).toEqual([]);
    expect(calls.eq).toEqual([]);
  });

  it("houseOwnRowsOnly uses a parameterised .eq() and admits no market row", () => {
    const { q, calls } = recorder();
    scopePriceRegisterRead(q, VENDOR_PRICE_OBSERVATIONS, {
      kind: "houseOwnRowsOnly",
      restaurantId: HOUSE,
    });
    expect(calls.eq).toEqual([["restaurant_id", HOUSE]]);
    expect(calls.or).toEqual([NOT_CONTRIBUTED_ONLY]);
  });

  it("openMarketOnly admits only rows belonging to no house", () => {
    const { q, calls } = recorder();
    scopePriceRegisterRead(q, VENDOR_PRICE_OBSERVATIONS, { kind: "openMarketOnly" });
    expect(calls.is).toEqual([["restaurant_id", null]]);
    expect(calls.or).toEqual([NOT_CONTRIBUTED_ONLY]);
  });

  it("everyHouse applies no tenancy predicate — and demands a reason first", () => {
    const { q, calls } = recorder();
    scopePriceRegisterRead(q, VENDOR_PRICE_OBSERVATIONS, {
      kind: "everyHouse",
      because: "the nightly re-judge has no caller and no house",
    });
    expect(calls.or).toEqual([NOT_CONTRIBUTED_ONLY]);
    expect(calls.is).toEqual([]);
    expect(calls.eq).toEqual([]);

    for (const because of ["", "   "]) {
      expect(() =>
        scopePriceRegisterRead(recorder().q, VENDOR_PRICE_OBSERVATIONS, {
          kind: "everyHouse",
          because,
        }),
      ).toThrow(/must state why/);
    }
  });

  it("refuses an id that would change the meaning of the filter string", () => {
    // `restaurant_id.eq.${id}` is interpolated, not bound. A comma or a
    // parenthesis in the id is another clause, and the widest one wins.
    for (const bad of [
      `${HOUSE},restaurant_id.not.is.null`,
      `${HOUSE})`,
      `${HOUSE} or true`,
      `"${HOUSE}"`,
    ]) {
      expect(() =>
        scopePriceRegisterRead(recorder().q, VENDOR_PRICE_OBSERVATIONS, {
          kind: "houseAndOpenMarket",
          restaurantId: bad,
        }),
      ).toThrow(/change the meaning of the filter string/);
    }
  });

  it("refuses an empty house rather than widening the read to everything", () => {
    expect(() =>
      scopePriceRegisterRead(recorder().q, VENDOR_PRICE_OBSERVATIONS, {
        kind: "houseAndOpenMarket",
        restaurantId: "",
      }),
    ).toThrow(/no restaurant id/);
  });

  it("accepts the non-UUID ids the existing suites use, deliberately", () => {
    // `price-below-average.spec.ts` asserts on `restaurant_id.eq.rest-1`. A
    // strict UUID gate here would turn a wrong-shaped id from an empty result
    // into a 500 and would tell a caller which ids parse; the narrow rule
    // refuses the injection surface and nothing else.
    const { q, calls } = recorder();
    scopePriceRegisterRead(q, VENDOR_PRICE_OBSERVATIONS, {
      kind: "houseAndOpenMarket",
      restaurantId: "rest-1",
    });
    expect(calls.or).toContain("restaurant_id.is.null,restaurant_id.eq.rest-1");
  });

  it("refuses a postings scope on the observations register", () => {
    expect(() =>
      scopePriceRegisterRead(recorder().q, VENDOR_PRICE_OBSERVATIONS, {
        kind: "includingHeldBooks",
        because: "a reason",
      }),
    ).toThrow(/holds no books/);
  });
});

describe("scopePriceRegisterRead — price_index_postings", () => {
  it("openMarketOnly applies ADR 0128's admission predicate and nothing else", () => {
    const { q, calls } = recorder();
    scopePriceRegisterRead(q, PRICE_INDEX_POSTINGS, { kind: "openMarketOnly" });
    expect(calls.or).toEqual([MARKET_VISIBILITY]);
    expect(MARKET_VISIBILITY).toBe("uploaded_by.is.null,admitted_at.not.is.null");
  });

  it("includingHeldBooks applies no predicate — and demands a reason", () => {
    const { q, calls } = recorder();
    scopePriceRegisterRead(q, PRICE_INDEX_POSTINGS, {
      kind: "includingHeldBooks",
      because: "the review path decides about a book that is still held",
    });
    expect(calls.or).toEqual([]);
    expect(() =>
      scopePriceRegisterRead(recorder().q, PRICE_INDEX_POSTINGS, {
        kind: "includingHeldBooks",
        because: "",
      }),
    ).toThrow(/must state why/);
  });

  it("throws for a house scope: this table carries no restaurant_id", () => {
    // Silently ignoring the scope would read the whole register while the
    // caller believed it had asked for one house.
    for (const scope of [
      { kind: "houseAndOpenMarket", restaurantId: HOUSE },
      { kind: "houseOwnRowsOnly", restaurantId: HOUSE },
      { kind: "everyHouse", because: "a reason" },
    ] as const) {
      expect(() =>
        scopePriceRegisterRead(recorder().q, PRICE_INDEX_POSTINGS, scope as any),
      ).toThrow(/no meaning on price_index_postings/);
    }
  });
});

describe("the constants the migration and the guard both depend on", () => {
  it("names the three visibility states the CHECK admits", () => {
    expect(REGISTER_VISIBILITY_STATES).toEqual([
      "house",
      "open_market",
      "contributed_aggregate_only",
    ]);
    expect(CONTRIBUTED_AGGREGATE_ONLY).toBe("contributed_aggregate_only");
  });

  it("names the two tables exactly as the migrations spell them", () => {
    expect(VENDOR_PRICE_OBSERVATIONS).toBe("vendor_price_observations");
    expect(PRICE_INDEX_POSTINGS).toBe("price_index_postings");
  });

  it("refuses something that is not a query rather than returning it unscoped", () => {
    for (const notAQuery of [null, undefined, {}, "a string", 7]) {
      expect(() =>
        scopePriceRegisterRead(notAQuery as any, VENDOR_PRICE_OBSERVATIONS, {
          kind: "openMarketOnly",
        }),
      ).toThrow(/not a PostgREST query/);
    }
  });
});
