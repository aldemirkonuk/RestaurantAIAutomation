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
import { PriceCodeMeaning } from "./price-code-mappings";

/**
 * A manager's statement, as `liveMappingsByCode` builds it (ADR 0126 Q3). The
 * bare string this file used to pass stopped compiling on purpose: a meaning
 * with no author and no mapping id is exactly what the founder's answer
 * replaced.
 */
const MAPPING_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const said = (basis: string, id: string | null = MAPPING_ID): PriceCodeMeaning => ({
  mappingId: id,
  priceBasis: basis,
  declaredByName: "Ada Manager",
  declaredAt: "2026-09-05T09:00:00.000Z",
});

const HOUSE = "11111111-2222-3333-4444-555555555555";
const RECEIVED = "2026-09-05T12:00:00.000Z";

function fixture(name: string): string {
  return readFileSync(join(__dirname, "__fixtures__", name), "utf8");
}

const BASE = {
  restaurantId: HOUSE,
  distributorKey: "a-distributor-that-does-not-exist",
  distributorName: "A Distributor That Does Not Exist",
  priceBasisByCode: { LIC: said("licensee price") },
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

/**
 * The file's own CUR against the manager's typed declaration (the founder,
 * 2026-09-06, batch 62 Q2: "Refuse the file, naming both").
 *
 * Until that answer the file's CUR silently won and the declaration was
 * discarded with no trace in the response. Either one of them is wrong and
 * nothing here can tell which: reading either prices a whole catalogue in a
 * currency somebody did not mean, and the number reaches the market box as
 * real money. Agreement and absence are unchanged.
 */
describe("parseEdi832 — the file's CUR against the house's declaration", () => {
  const constructed = () => fixture("edi832-constructed-from-spec.edi");

  it("refuses the WHOLE file on a disagreement, naming both", () => {
    const run = parseEdi832(constructed(), {
      ...BASE,
      declaredCurrency: "EUR",
    });
    expect(run.refusals[0].reason).toBe("currency_disagreement");
    expect(run.refusedWhole).toContain("the file states USD");
    expect(run.refusedWhole).toContain("the declaration says EUR");
    expect(run.refusedWhole).toContain("nothing was read");
    expect(run.sightings).toHaveLength(0);
    // Not silently resolved to either one: the run carries NO currency at all.
    expect(run.currency).toBeNull();
    expect(run.linesRead).toBe(0);
    expect(run.refusals[0].detail).toContain("USD");
    expect(run.refusals[0].detail).toContain("EUR");
  });

  it("reads the file when the two AGREE, and does not mention the declaration", () => {
    const run = parseEdi832(constructed(), {
      ...BASE,
      declaredCurrency: "usd",
    });
    expect(run.refusedWhole).toBeNull();
    expect(run.currency).toBe("USD");
    expect(run.linesRead).toBeGreaterThan(0);
  });

  it("reads the file when NOTHING was declared and it states its own", () => {
    const run = parseEdi832(constructed(), BASE);
    expect(run.refusedWhole).toBeNull();
    expect(run.currency).toBe("USD");
    expect(run.linesRead).toBeGreaterThan(0);
  });

  it("takes the declaration when the file states none — unchanged", () => {
    const run = parseEdi832(
      fixture("edi832-msss-guide-sample-2022-06-02.edi"),
      { ...BASE, declaredCurrency: "TRY" },
    );
    expect(run.refusedWhole).toBeNull();
    expect(run.currency).toBe("TRY");
  });

  it("ignores a malformed declaration against a file that states its own", () => {
    const run = parseEdi832(constructed(), { ...BASE, declaredCurrency: "US" });
    expect(run.refusedWhole).toBeNull();
    expect(run.currency).toBe("USD");
  });
});

/**
 * The file against ITSELF (audit of 19ab0258, finding 6).
 *
 * The reader used to take `segs.find(s => s.tag === "CUR")` — the first CUR
 * segment — so a second one that disagreed was dropped with no trace: a file
 * carrying `CUR*SE*USD~` then `CUR*SE*EUR~` read silently as USD. These cases
 * pin the refusal, and the three edge cases the audit probed and found
 * unpinned: a lowercase code IN THE FILE, whitespace around the code, and a CUR
 * segment whose currency element is empty.
 */
describe("parseEdi832 — a file that disagrees with itself about its currency", () => {
  const constructed = () => fixture("edi832-constructed-from-spec.edi");
  /** Replace the fixture's single CUR line with whatever these cases need. */
  const withCur = (...lines: string[]) =>
    constructed().replace("CUR*SE*USD~", lines.join("\n"));

  it("refuses the WHOLE file when two CUR segments disagree, naming every currency seen", () => {
    const run = parseEdi832(withCur("CUR*SE*USD~", "CUR*SE*EUR~"), BASE);
    expect(run.refusals[0].reason).toBe("currency_disagreement");
    expect(run.refusedWhole).toContain("USD and EUR");
    expect(run.refusedWhole).toContain("nothing was read");
    expect(run.refusals[0].detail).toContain("USD");
    expect(run.refusals[0].detail).toContain("EUR");
    // Neither one silently wins, and not a single line is read.
    expect(run.currency).toBeNull();
    expect(run.sightings).toHaveLength(0);
    expect(run.linesRead).toBe(0);
  });

  it("names all three when three disagree", () => {
    const run = parseEdi832(
      withCur("CUR*SE*USD~", "CUR*SE*EUR~", "CUR*SE*TRY~"),
      BASE,
    );
    expect(run.refusedWhole).toContain("USD and EUR and TRY");
    expect(run.refusedWhole).toContain("3 different currencies");
    expect(run.currency).toBeNull();
  });

  it("reads the file when two CUR segments AGREE", () => {
    const run = parseEdi832(withCur("CUR*SE*USD~", "CUR*SE*USD~"), BASE);
    expect(run.refusedWhole).toBeNull();
    expect(run.currency).toBe("USD");
    expect(run.linesRead).toBeGreaterThan(0);
  });

  it("normalises a lowercase code in the FILE before comparing, so it is not a disagreement", () => {
    const run = parseEdi832(withCur("CUR*SE*usd~", "CUR*SE*USD~"), BASE);
    expect(run.refusedWhole).toBeNull();
    expect(run.currency).toBe("USD");
    // And a lone lowercase CUR still reads as the upper-case code.
    expect(parseEdi832(withCur("CUR*SE*eur~"), BASE).currency).toBe("EUR");
  });

  it("normalises whitespace around the code before comparing", () => {
    const run = parseEdi832(withCur("CUR*SE* USD ~", "CUR*SE*USD~"), BASE);
    expect(run.refusedWhole).toBeNull();
    expect(run.currency).toBe("USD");
    expect(parseEdi832(withCur("CUR*SE*  try  ~"), BASE).currency).toBe("TRY");
  });

  it("treats a CUR with an EMPTY currency element as no CUR at all", () => {
    // Alone: the file states no currency, and there is no USD default.
    const alone = parseEdi832(withCur("CUR*SE*~"), BASE);
    expect(alone.refusals[0].reason).toBe("no_currency");
    expect(alone.currency).toBeNull();

    // Alone, with a declaration: the declaration stands, exactly as "no CUR".
    const declared = parseEdi832(withCur("CUR*SE*~"), {
      ...BASE,
      declaredCurrency: "TRY",
    });
    expect(declared.refusedWhole).toBeNull();
    expect(declared.currency).toBe("TRY");

    // Beside a real one: it is dropped, not counted as a second, blank opinion.
    const beside = parseEdi832(withCur("CUR*SE*~", "CUR*SE*EUR~"), BASE);
    expect(beside.refusedWhole).toBeNull();
    expect(beside.currency).toBe("EUR");
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
      { ...BASE, declaredCurrency: "USD", priceBasisByCode: { CON: said("contract price"), CAT: said("catalog price") } },
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

  it("stamps the manager statement that admitted the row, on the row (ADR 0126 Q3)", () => {
    const [first] = run().sightings;
    expect(first.priceCode).toBe("LIC");
    expect(first.priceCodeMappingId).toBe(MAPPING_ID);
    expect(first.priceCodeDeclaredByName).toBe("Ada Manager");
    expect(first.priceCodeDeclaredAt).toBe("2026-09-05T09:00:00.000Z");
    // And the readable sentence beside it, for a panel or a report.
    expect(first.raw).toMatchObject({
      priceCodeMapping: {
        mappingId: MAPPING_ID,
        attribution:
          'Priced as "licensee price" because this house mapped the sender\'s code LIC by Ada Manager on 2026-09-05.',
      },
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
      priceBasisByCode: { LIC: said("licensee price"), MSR: said("suggested retail") },
    });
    expect(r.sightings).toHaveLength(0);
    expect(r.refusals[0].reason).toBe("unmapped_price_basis");
    expect(r.refusals[0].detail).toContain("2 mapped prices");
  });
});
