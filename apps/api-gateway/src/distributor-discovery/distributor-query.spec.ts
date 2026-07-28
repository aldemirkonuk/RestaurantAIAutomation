import {
  escapeLikeWildcards,
  groupFacetCounts,
  normalizeBbox,
  parseFacets,
} from "./distributor-query";

describe("escapeLikeWildcards", () => {
  it("escapes the wildcards a user can type by accident", () => {
    // Without this, searching "100%" matches every vendor.
    expect(escapeLikeWildcards("100%")).toBe("100\\%");
    expect(escapeLikeWildcards("a_b")).toBe("a\\_b");
  });

  it("escapes backslash so a literal backslash stays literal", () => {
    expect(escapeLikeWildcards("a\\b")).toBe("a\\\\b");
  });

  it("leaves ordinary search terms untouched", () => {
    expect(escapeLikeWildcards("Skurnik Wines & Spirits")).toBe("Skurnik Wines & Spirits");
  });
});

describe("parseFacets", () => {
  it("returns null for an absent or empty selection", () => {
    expect(parseFacets(undefined)).toBeNull();
    expect(parseFacets([])).toBeNull();
  });

  it("groups values of the same kind together", () => {
    expect(parseFacets(["region:burgundy", "region:rhone", "varietal:pinot-noir"])).toEqual({
      region: ["burgundy", "rhone"],
      varietal: ["pinot-noir"],
    });
  });

  it("de-duplicates repeated values", () => {
    expect(parseFacets(["region:burgundy", "region:burgundy"])).toEqual({
      region: ["burgundy"],
    });
  });

  it("keeps slugs containing hyphens intact", () => {
    expect(parseFacets(["price_band:under-20"])).toEqual({ price_band: ["under-20"] });
  });

  it("drops malformed entries rather than producing an empty kind", () => {
    expect(parseFacets(["region:", ":burgundy", "nocolon"])).toBeNull();
  });
});

describe("normalizeBbox", () => {
  it("accepts a well-formed viewport", () => {
    expect(normalizeBbox({ minLng: -74.1, minLat: 40.6, maxLng: -73.9, maxLat: 40.8 })).toEqual({
      minLng: -74.1,
      minLat: 40.6,
      maxLng: -73.9,
      maxLat: 40.8,
    });
  });

  it("drops a partial bbox instead of half-applying it", () => {
    // A dropped param must not silently narrow the result set.
    expect(normalizeBbox({ minLng: -74.1, minLat: 40.6, maxLng: -73.9 })).toBeNull();
  });

  it("rejects a degenerate or inverted box", () => {
    expect(normalizeBbox({ minLng: -73.9, minLat: 40.6, maxLng: -74.1, maxLat: 40.8 })).toBeNull();
    expect(normalizeBbox({ minLng: -74, minLat: 40.6, maxLng: -74, maxLat: 40.8 })).toBeNull();
  });
});

describe("groupFacetCounts", () => {
  it("groups flat rows by kind", () => {
    expect(
      groupFacetCounts([
        { facet_kind: "region", facet_slug: "burgundy", facet_value: "Burgundy", vendors: 4 },
        { facet_kind: "region", facet_slug: "rhone", facet_value: "Rhône", vendors: 2 },
        { facet_kind: "varietal", facet_slug: "syrah", facet_value: "Syrah", vendors: 1 },
      ]),
    ).toEqual({
      region: [
        { slug: "burgundy", value: "Burgundy", vendors: 4 },
        { slug: "rhone", value: "Rhône", vendors: 2 },
      ],
      varietal: [{ slug: "syrah", value: "Syrah", vendors: 1 }],
    });
  });

  it("tolerates an empty result", () => {
    expect(groupFacetCounts([])).toEqual({});
  });
});
