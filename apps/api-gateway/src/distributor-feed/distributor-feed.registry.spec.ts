/**
 * The registry's honesty properties, asserted rather than trusted to review.
 *
 * These are the tests that would fail the day somebody quietly turned a
 * measured "this cannot be connected" into a button.
 */

import {
  DISTRIBUTOR_FEED_CONNECTION,
  DISTRIBUTORS,
  distributorSilenceFor,
  distributorsFor,
} from "./distributor-feed.registry";
import { FEED_SOURCE_TYPE, FEED_TRUST_TIER } from "./parse-edi832";

describe("the declared distributor connection", () => {
  it("is not offerable, and carries the reason in the same object", () => {
    expect(DISTRIBUTOR_FEED_CONNECTION.offerable).toBe(false);
    expect(DISTRIBUTOR_FEED_CONNECTION.notOfferableBecause.length).toBeGreaterThan(
      120,
    );
  });

  it("lands a class-C row in the tenant-scoped register, never the index one", () => {
    expect(DISTRIBUTOR_FEED_CONNECTION.landsInTable).toBe(
      "vendor_price_observations",
    );
    expect(DISTRIBUTOR_FEED_CONNECTION.landsInSourceType).toBe(FEED_SOURCE_TYPE);
    expect(DISTRIBUTOR_FEED_CONNECTION.landsInTrustTier).toBe(FEED_TRUST_TIER);
    expect(DISTRIBUTOR_FEED_CONNECTION.dataHandling.landsIn).toContain(
      "Not `price_index_postings`",
    );
  });

  it("answers all five data-handling questions, none of them blank", () => {
    const d = DISTRIBUTOR_FEED_CONNECTION.dataHandling;
    for (const key of [
      "reads",
      "doesNotRead",
      "landsIn",
      "visibleTo",
      "keptFor",
    ] as const) {
      expect(typeof d[key]).toBe("string");
      expect(d[key].trim().length).toBeGreaterThan(40);
    }
  });

  it("says a price list is read and orders and invoices are not", () => {
    expect(DISTRIBUTOR_FEED_CONNECTION.dataHandling.reads).toContain(
      "price list",
    );
    expect(DISTRIBUTOR_FEED_CONNECTION.dataHandling.doesNotRead).toContain(
      "orders",
    );
    expect(DISTRIBUTOR_FEED_CONNECTION.dataHandling.doesNotRead).toContain(
      "invoices",
    );
  });
});

describe("every distributor entry", () => {
  const entries = Object.values(DISTRIBUTORS);

  it("names its key on itself, so a map key and a row can never disagree", () => {
    for (const [key, entry] of Object.entries(DISTRIBUTORS)) {
      expect(entry.key).toBe(key);
    }
  });

  it("carries an availability sentence and a measured date on its access verdict", () => {
    for (const e of entries) {
      expect(e.availability.trim().length).toBeGreaterThan(80);
      expect(e.automatedAccess.measuredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(e.automatedAccess.evidence.length).toBeGreaterThan(0);
    }
  });

  it("never says 'coming soon' or promises a search nobody has scheduled", () => {
    for (const e of entries) {
      expect(e.availability.toLowerCase()).not.toContain("coming soon");
      expect(e.availability.toLowerCase()).not.toContain("until one is found");
    }
  });

  it("is unbuilt today, every one of them, with the reason on the row", () => {
    for (const e of entries) {
      expect(e.unbuilt).not.toBeNull();
      expect(e.unbuilt!.measuredOn).toBe("2026-09-05");
    }
  });

  it("carries NO code map at all, because Mudavym does not maintain the meanings", () => {
    // Amended 2026-09-05 (ADR 0126 Q3, the founder: "Manager maps it, recorded
    // on every row"). This assertion used to read
    // `expect(Object.keys(e.priceBasisByCode)).toHaveLength(0)` — an empty map
    // waiting to be filled in from a distributor guide. Shipping meanings here
    // would assert one trade level for every house at once, out of an
    // agreement this product is not party to. The field is gone; the meanings
    // live in `distributor_price_code_mappings`, per house, per sender, signed.
    for (const e of entries) {
      expect(e).not.toHaveProperty("priceBasisByCode");
    }
  });
});

describe("distributorsFor", () => {
  it("finds the three Illinois houses' distributors plus the two national ones", () => {
    const il = distributorsFor("US-IL").map((d) => d.key).sort();
    expect(il).toEqual([
      "breakthru-il",
      "libdib-national",
      "provi-marketplace",
      "rndc-il",
      "southern-glazers-il",
    ]);
  });

  it("returns nothing for a jurisdiction nobody measured, rather than the whole list", () => {
    expect(distributorsFor("US-WY")).toHaveLength(0);
    expect(distributorsFor("")).toHaveLength(0);
  });
});

describe("distributorSilenceFor", () => {
  it("names the distributors, the ban and where the price actually lives", () => {
    const s = distributorSilenceFor("US-IL")!;
    expect(s).toContain("Breakthru Beverage Illinois");
    expect(s).toContain("forbid an automated reader");
    expect(s).toContain("Your own invoices");
  });

  it("is null where nothing was measured, so an unresearched state borrows no certainty", () => {
    expect(distributorSilenceFor("US-WY")).toBeNull();
  });
});
