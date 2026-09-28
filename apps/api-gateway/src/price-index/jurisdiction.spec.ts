import { normalizeJurisdiction } from "./price-index.registry";
import {
  countryOf,
  foldName,
  jurisdictionCovers,
  marketSilenceFor,
  normalizeNonUsJurisdiction,
  priceScopeOf,
} from "./jurisdiction";

/**
 * The codes, and the one rule that decides which source speaks for which house.
 *
 * The cases below are the three real non-US tenants, read off the production
 * rows on 2026-09-05 (a read, never a write) — Muğla/Türkiye, Antalya/Türkiye
 * with no province, England/United Kingdom — plus the containment rule that
 * keeps an England-and-Wales series away from a house that might be in
 * Scotland.
 */
describe("normalizeJurisdiction — the estate's real values", () => {
  it("resolves the exact strings the three non-US houses hold", () => {
    expect(normalizeJurisdiction("Muğla")).toBe("TR-48"); // Chez Community
    expect(normalizeJurisdiction("Türkiye")).toBe("TR"); // The Old House Pub
    expect(normalizeJurisdiction("England")).toBe("GB-ENG"); // ADMIN 1
    expect(normalizeJurisdiction("United Kingdom")).toBe("GB");
  });

  it("still resolves every US form it did before", () => {
    expect(normalizeJurisdiction("MI")).toBe("US-MI");
    expect(normalizeJurisdiction("Michigan")).toBe("US-MI");
    expect(normalizeJurisdiction("us-ca")).toBe("US-CA");
    expect(normalizeJurisdiction("California")).toBe("US-CA");
  });

  it("resolves the country spellings the column actually holds", () => {
    // Measured on `restaurants.country`, 2026-09-05: 'United States' x6,
    // 'USA' x2, 'US' x1, 'united States' x1, 'Türkiye' x2, 'United Kingdom' x1.
    expect(normalizeJurisdiction("United States")).toBe("US");
    expect(normalizeJurisdiction("united States")).toBe("US");
    expect(normalizeJurisdiction("USA")).toBe("US");
    expect(normalizeJurisdiction("US")).toBe("US");
  });

  it("folds diacritics and case, because free text is free", () => {
    expect(foldName("Muğla")).toBe("mugla");
    expect(normalizeNonUsJurisdiction("MUĞLA")).toBe("TR-48");
    expect(normalizeNonUsJurisdiction("mugla")).toBe("TR-48");
    expect(normalizeNonUsJurisdiction("İstanbul")).toBe("TR-34");
    expect(normalizeNonUsJurisdiction("turkiye")).toBe("TR");
  });

  it("hands an ISO key straight back", () => {
    expect(normalizeNonUsJurisdiction("TR-48")).toBe("TR-48");
    expect(normalizeNonUsJurisdiction("gb-eng")).toBe("GB-ENG");
    expect(normalizeNonUsJurisdiction("GB-UKM")).toBe("GB-UKM");
  });

  it("returns null for a place it has researched no source for", () => {
    // Not a world list: a code here would imply somebody had looked.
    expect(normalizeJurisdiction("Atlantis")).toBeNull();
    expect(normalizeJurisdiction("France")).toBeNull();
    expect(normalizeJurisdiction("")).toBeNull();
    expect(normalizeJurisdiction(null)).toBeNull();
  });

  it("knows all 81 Turkish provinces, not only the two with a house", () => {
    expect(normalizeNonUsJurisdiction("Adana")).toBe("TR-01");
    expect(normalizeNonUsJurisdiction("Antalya")).toBe("TR-07");
    expect(normalizeNonUsJurisdiction("Düzce")).toBe("TR-81");
  });

  it("only produces keys the register's state CHECK can hold, or a country", () => {
    // price_index_postings.state is CHECK (state ~ '^[A-Z]{2}-[A-Z0-9]{1,3}$'),
    // so a bare country code can never be written. Every REGIONAL key this
    // module produces must satisfy it, or a parser keyed on one would fail at
    // 06:00 rather than in a test.
    const pattern = /^[A-Z]{2}-[A-Z0-9]{1,3}$/;
    for (const key of ["TR-48", "TR-07", "TR-81", "GB-ENG", "GB-SCT", "GB-WLS", "GB-NIR", "GB-EAW", "GB-UKM"]) {
      expect(pattern.test(key)).toBe(true);
    }
    for (const bare of ["TR", "GB", "US"]) {
      expect(pattern.test(bare)).toBe(false);
    }
  });
});

describe("jurisdictionCovers — containment, and it is not symmetric", () => {
  it("covers a subdivision from its own country code", () => {
    expect(jurisdictionCovers("TR", "TR-48")).toBe(true);
    expect(jurisdictionCovers("GB", "GB-ENG")).toBe(true);
  });

  it("covers England from a UK-wide and an England-and-Wales instrument", () => {
    expect(jurisdictionCovers("GB-UKM", "GB-ENG")).toBe(true);
    expect(jurisdictionCovers("GB-EAW", "GB-ENG")).toBe(true);
    expect(jurisdictionCovers("GB-EAW", "GB-WLS")).toBe(true);
  });

  it("does NOT cover Scotland from an England-and-Wales instrument", () => {
    expect(jurisdictionCovers("GB-EAW", "GB-SCT")).toBe(false);
    expect(jurisdictionCovers("GB-GBN", "GB-NIR")).toBe(false);
  });

  it("does NOT cover a house known only as its country from a subdivision", () => {
    // The house may be in Scotland; guessing the other way invents a market.
    expect(jurisdictionCovers("GB-EAW", "GB")).toBe(false);
    expect(jurisdictionCovers("GB-UKM", "GB")).toBe(false);
  });

  it("never crosses a border", () => {
    expect(jurisdictionCovers("TR", "GB-ENG")).toBe(false);
    expect(jurisdictionCovers("GB-UKM", "TR-48")).toBe(false);
    expect(jurisdictionCovers("US", "GB-ENG")).toBe(false);
  });
});

describe("priceScopeOf — why a country-level answer differs by country", () => {
  it("calls the United States subnational and the other two national", () => {
    expect(priceScopeOf("US")).toBe("subnational");
    expect(priceScopeOf("US-MI")).toBe("subnational");
    expect(priceScopeOf("GB")).toBe("national");
    expect(priceScopeOf("TR-48")).toBe("national");
  });

  it("is null for a country nobody has researched", () => {
    expect(priceScopeOf("ZZ")).toBeNull();
  });
});

describe("marketSilenceFor — the sentence, not an em dash", () => {
  it("names the cause for Türkiye and does not call the tax a price", () => {
    const tr = marketSilenceFor("TR-48")!;
    expect(tr).toContain("no price-posting regime");
    expect(tr).toContain("ÖTV");
    expect(tr).toContain("a tax, not a price");
    expect(tr).toContain("own invoices");
  });

  it("names the cause for the United Kingdom", () => {
    const gb = marketSilenceFor("GB-ENG")!;
    expect(gb).toContain("no price-posting regime");
    expect(gb).toContain("per trade account");
    expect(gb).toContain("a tax, not a price");
  });

  it("says nothing it has not researched", () => {
    expect(marketSilenceFor("US-MI")).toBeNull();
  });
});

describe("countryOf", () => {
  it("splits an ISO key at the hyphen and leaves a bare code alone", () => {
    expect(countryOf("GB-ENG")).toBe("GB");
    expect(countryOf("TR-48")).toBe("TR");
    expect(countryOf("TR")).toBe("TR");
  });
});
