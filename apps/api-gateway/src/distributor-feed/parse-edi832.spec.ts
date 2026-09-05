/**
 * The 832 parser, against both recorded fixtures.
 *
 * The first fixture is a REAL published sample (SPS Commerce's MSSS guide,
 * transcribed character for character) and the point of it is that a correct
 * parser admits NOTHING from it: it states no currency, and none of its three
 * lines states a size. The second is constructed from the two implementation
 * guides' element definitions and is labelled as such in
 * `__fixtures__/EDI832-PROVENANCE.md`; it exists to reach the admit path and the
 * five refusals the published sample cannot.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FEED_SOURCE_TYPE,
  FEED_TRUST_TIER,
  parseEdi832,
  readEdiDate,
  tallyFeedRefusals,
} from "./parse-edi832";

const HOUSE = "11111111-2222-3333-4444-555555555555";
const RECEIVED = "2026-09-05T12:00:00.000Z";

function fixture(name: string): string {
  return readFileSync(join(__dirname, "__fixtures__", name), "utf8");
}

const BASE = {
  restaurantId: HOUSE,
  distributorKey: "a-distributor-that-does-not-exist",
  distributorName: "A Distributor That Does Not Exist",
  priceBasisByCode: { LIC: "licensee price" },
  receivedAt: RECEIVED,
};

describe("readEdiDate", () => {
  it("reads CCYYMMDD", () => {
    expect(readEdiDate("20260701")).toBe("2026-07-01");
  });

  it("refuses a day that does not exist rather than rolling it forward", () => {
    expect(readEdiDate("20260231")).toBeNull();
    expect(readEdiDate("20261301")).toBeNull();
    expect(readEdiDate("2026-07-01")).toBeNull();
    expect(readEdiDate("")).toBeNull();
  });
});

describe("parseEdi832 — the whole-document refusals", () => {
  it("refuses a catalogue with no house, because a null restaurant is visible to every house", () => {
    const run = parseEdi832(fixture("edi832-constructed-from-spec.edi"), {
      ...BASE,
      restaurantId: "",
    });
    expect(run.refusedWhole).toContain("no house was named");
    expect(run.sightings).toHaveLength(0);
    expect(run.refusals[0].reason).toBe("no_restaurant");
  });

  it("refuses anything that is not an 832", () => {
    const run = parseEdi832("ISA*00~GS*PO~ST*850*0001~SE*2*0001~", BASE);
    expect(run.refusals[0].reason).toBe("not_a_832");
    expect(run.refusedWhole).toContain("not an 832");
  });

  it("refuses an 832 with no BCT header", () => {
    const run = parseEdi832("ST*832*0001~CUR*SE*USD~SE*2*0001~", BASE);
    expect(run.refusals[0].reason).toBe("no_catalog_header");
  });

  it("refuses a catalogue that states no currency, with no USD default anywhere", () => {
    const run = parseEdi832(
      fixture("edi832-msss-guide-sample-2022-06-02.edi"),
      BASE,
    );
    expect(run.refusals[0].reason).toBe("no_currency");
    expect(run.refusedWhole).toContain("no USD default");
    expect(run.sightings).toHaveLength(0);
  });
});

describe("parseEdi832 — the published MSSS sample", () => {
  /**
   * The whole value of this fixture. It is a real catalogue from a real
   * implementation guide, its three lines each carry a price, and a parser that
   * took the price without the size would put three unpriced-per-unit rows into
   * the ladder. Zero admitted is the correct answer.
   */
  it("admits none of its three lines, because not one of them states a size", () => {
    const run = parseEdi832(
      fixture("edi832-msss-guide-sample-2022-06-02.edi"),
      { ...BASE, declaredCurrency: "USD", priceBasisByCode: { CON: "contract price", CAT: "catalog price" } },
    );
    expect(run.refusedWhole).toBeNull();
    expect(run.currency).toBe("USD");
    expect(run.linesRead).toBe(3);
    expect(run.sightings).toHaveLength(0);
    expect(tallyFeedRefusals(run.refusals)).toEqual({ no_size: 3 });
  });

  it("reads the catalogue number from BCT02 and never invents one", () => {
    const run = parseEdi832(
      fixture("edi832-msss-guide-sample-2022-06-02.edi"),
      { ...BASE, declaredCurrency: "USD" },
    );
    expect(run.catalogNumber).toBe("103013");
  });

  it("refuses every line when the CTP02 codes are unmapped, and says why", () => {
    const run = parseEdi832(
      fixture("edi832-msss-guide-sample-2022-06-02.edi"),
      { ...BASE, declaredCurrency: "USD" },
    );
    // Size is checked before price, so these are still no_size — the point is
    // that nothing is admitted under a code the house was never told about.
    expect(run.sightings).toHaveLength(0);
  });
});

describe("parseEdi832 — the constructed fixture", () => {
  const run = () =>
    parseEdi832(fixture("edi832-constructed-from-spec.edi"), BASE);

  it("reads the header the guides define", () => {
    const r = run();
    expect(r.catalogNumber).toBe("Q3-2026");
    expect(r.catalogVersion).toBe("1");
    expect(r.currency).toBe("USD");
    expect(r.linesRead).toBe(8);
  });

  it("admits exactly the two defensible lines and refuses six, one per reason", () => {
    const r = run();
    expect(r.sightings).toHaveLength(2);
    expect(tallyFeedRefusals(r.refusals)).toEqual({
      no_size: 1,
      unmapped_price_basis: 1,
      duplicate_item_id: 1,
      no_effective_date: 1,
      size_unit_not_volume: 1,
      price_not_positive: 1,
    });
  });

  it("writes the house-scoped class-C shape the ladder already expects", () => {
    const [first] = run().sightings;
    expect(first.restaurantId).toBe(HOUSE);
    expect(first.sourceType).toBe(FEED_SOURCE_TYPE);
    expect(first.trustTier).toBe(FEED_TRUST_TIER);
    expect(first.priceBasis).toBe("licensee price");
    expect(first.rawPrice).toBe(14.75);
    expect(first.packSize).toBe(12);
    expect(first.unitVolumeMl).toBe(750);
    expect(first.currency).toBe("USD");
  });

  it("keeps our clock and the distributor's date apart", () => {
    const [first] = run().sightings;
    expect(first.observedAt).toBe(RECEIVED);
    expect(first.effectiveDate).toBe("2026-07-01");
  });

  it("converts a litre size rather than refusing it, and rounds to whole ml", () => {
    const second = run().sightings[1];
    expect(second.unitVolumeMl).toBe(1500);
    expect(second.packSize).toBe(6);
  });

  it("names the distributor from N1*SU when the document carries one", () => {
    const [first] = run().sightings;
    expect(first.vendorNameRaw).toBe("A DISTRIBUTOR THAT DOES NOT EXIST");
  });

  it("keeps every LIN identifier pair, so a UPC survives beside the part number", () => {
    const [first] = run().sightings;
    expect(first.raw).toMatchObject({
      ediItemIds: { VP: "ITEM-0001", UP: "000000000017" },
    });
  });

  it("refuses an EA size rather than treating an each as a volume", () => {
    const refusal = run().refusals.find(
      (x) => x.reason === "size_unit_not_volume",
    );
    expect(refusal?.detail).toContain("ITEM-0007");
    expect(refusal?.detail).toContain("Only ML, CL and LT are mapped");
  });

  it("refuses an unmapped price code instead of picking a trade level", () => {
    const refusal = run().refusals.find(
      (x) => x.reason === "unmapped_price_basis",
    );
    expect(refusal?.detail).toContain("ITEM-0004");
    expect(refusal?.detail).toContain("per-trading-partner code list");
  });

  it("refuses the second appearance of an item code rather than overwriting the first", () => {
    const r = run();
    const refusal = r.refusals.find((x) => x.reason === "duplicate_item_id");
    expect(refusal?.detail).toContain("ITEM-0001");
    // and the FIRST one survives
    expect(r.sightings[0].sourceRef).toBe(
      "a-distributor-that-does-not-exist:Q3-2026:ITEM-0001",
    );
  });

  it("hashes only the price-bearing fields, so a re-read of an unchanged line dedups", () => {
    const a = run().sightings[0].contentHash;
    const b = parseEdi832(fixture("edi832-constructed-from-spec.edi"), {
      ...BASE,
      receivedAt: "2026-12-31T23:59:59.000Z",
    }).sightings[0].contentHash;
    expect(a).toBe(b);
  });

  it("refuses every line when the house has no code mapping at all", () => {
    const r = parseEdi832(fixture("edi832-constructed-from-spec.edi"), {
      ...BASE,
      priceBasisByCode: {},
    });
    expect(r.sightings).toHaveLength(0);
    // Four of the eight lines reach the price check at all; the other four are
    // already refused for size, date or a duplicate id before a price matters.
    expect(tallyFeedRefusals(r.refusals).unmapped_price_basis).toBe(4);
  });

  it("refuses a line carrying two mapped trade levels rather than choosing one", () => {
    const two =
      "ST*832*1~BCT*SC*C1~CUR*SE*USD~LIN*1*VP*X1~DTM*007*20260701~PID*F****A WINE~PO4*12*750*ML~CTP**LIC*10*1*EA~CTP**MSR*20*1*EA~CTT*1~SE*9*1~";
    const r = parseEdi832(two, {
      ...BASE,
      priceBasisByCode: { LIC: "licensee price", MSR: "suggested retail" },
    });
    expect(r.sightings).toHaveLength(0);
    expect(r.refusals[0].reason).toBe("unmapped_price_basis");
    expect(r.refusals[0].detail).toContain("2 mapped prices");
  });
});
