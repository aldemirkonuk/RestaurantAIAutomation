import { readFileSync } from "fs";
import { join } from "path";
import {
  CaliforniaPosting,
  CaliforniaShapeError,
  parseCalifornia,
} from "./parse-california";
import { tally } from "./price-index.types";

/**
 * California ABC beer postings, against a fixture of 13 REAL rows fetched from
 * the public AppSync endpoint on 2026-09-04 (see PROVENANCE). The rows were
 * chosen to exercise every refusal; their values were not touched.
 */
function fixture(): CaliforniaPosting[] {
  const path = join(
    __dirname,
    "__fixtures__",
    "california-abc-beer-2026-09-04.sample.json",
  );
  return JSON.parse(readFileSync(path, "utf-8")) as CaliforniaPosting[];
}

const FETCHED = "1970-01-01T00:00:00Z";

describe("parseCalifornia", () => {
  it("reads all rows and admits only current (Active) postings", () => {
    const run = parseCalifornia(fixture(), FETCHED);
    expect(run.rowsRead).toBe(13);
    // 8 Active, non-duplicate postings survive; 4 superseded + 1 duplicate go.
    expect(run.sightings).toHaveLength(8);
    expect(run.issuedAt).toBe("2026-03-10");
  });

  it("counts the source's own defects rather than dropping them silently", () => {
    const run = parseCalifornia(fixture(), FETCHED);
    const t = tally(run.refusals);
    // Old + Inactive + Old(Manufacturers) + Old = 4 superseded.
    expect(t.superseded).toBe(4);
    // The last row repeats the first at the same price — a duplicate posting.
    expect(t.duplicate_posting).toBe(1);
    expect(run.refusals).toHaveLength(5);
  });

  it("stores the price AS POSTED — no 750ml normalisation of beer", () => {
    const run = parseCalifornia(fixture(), FETCHED);
    const ml = run.sightings.find(
      (s) => s.externalIds.postingId === "7475103",
    )!;
    expect(ml.price).toBe(52.7);
    expect(ml.sizeValue).toBe(375);
    expect(ml.sizeUnit).toBe("Milliliter"); // not converted to ml/750
    expect(ml.priceUnit).toBe("per package");
    expect(ml.pack).toBeNull(); // '4 x 6 Pack' is descriptive, no honest integer
    expect(ml.priceBasis).toBe("Retailers");
    expect(ml.state).toBe("US-CA");
    expect(ml.region).toBe("Santa Clara");
    expect(ml.sourceClass).toBe("posted_wholesale_list");
    // ABC declares no licence for this data: attribution is unstated, not blank-permissive.
    expect(ml.attribution).toBeNull();
  });

  it("keeps a keg's gallon size and its separate container charge", () => {
    const run = parseCalifornia(fixture(), FETCHED);
    const keg = run.sightings.find(
      (s) => s.externalIds.postingId === "7899168",
    )!;
    expect(keg.sizeUnit).toBe("Gallon");
    expect(keg.containerCharge).toBe(50);
  });

  it("labels a different trade level rather than mixing it with the retailer price", () => {
    const run = parseCalifornia(fixture(), FETCHED);
    const wholesale = run.sightings.find(
      (s) => s.externalIds.postingId === "4439271",
    )!;
    expect(wholesale.priceBasis).toBe("Wholesalers");
  });

  it("refuses an unrecognisable shape rather than guessing", () => {
    expect(() => parseCalifornia([], FETCHED)).toThrow(CaliforniaShapeError);
    expect(() =>
      parseCalifornia([{ foo: 1 } as unknown as CaliforniaPosting], FETCHED),
    ).toThrow(CaliforniaShapeError);
  });
});
