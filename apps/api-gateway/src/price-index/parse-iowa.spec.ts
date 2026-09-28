import { readFileSync } from "fs";
import { join } from "path";
import { IowaRow, IowaShapeError, parseIowa } from "./parse-iowa";
import { tally } from "./price-index.types";

/**
 * Iowa Liquor Products, against a fixture of 24 REAL rows. The assertions here
 * mirror the self-test in `scripts/fetch_price_sightings.py`: the two
 * implementations must agree on what "the same posting" and "a refused row"
 * mean, or one of them is wrong.
 */
function fixture(): IowaRow[] {
  const path = join(
    __dirname,
    "__fixtures__",
    "iowa-liquor-products-2026-09-01.sample.ndjson",
  );
  return readFileSync(path, "utf-8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => JSON.parse(l) as IowaRow);
}

const FETCHED = "1970-01-01T00:00:00Z";

describe("parseIowa", () => {
  it("admits 20 of 24 rows, dated by the issuer", () => {
    const run = parseIowa(fixture(), FETCHED);
    expect(run.rowsRead).toBe(24);
    expect(run.issuedAt).toBe("2026-09-01");
    expect(run.sightings).toHaveLength(20);
  });

  it("counts the file's own contradictions and duplicates", () => {
    const run = parseIowa(fixture(), FETCHED);
    const t = tally(run.refusals);
    expect(t.case_price_inconsistent).toBe(3);
    expect(t.duplicate_item_no).toBe(1);
  });

  it("refuses the row that publishes a $1,250 bottle against a $240 case", () => {
    const run = parseIowa(fixture(), FETCHED);
    const bad = run.refusals.find((r) => r.detail.includes("1250"));
    expect(bad?.reason).toBe("case_price_inconsistent");
    // item 810000 carries bottle_volume_ml = 0 AND an inconsistent case cost;
    // it is refused by the case check before the zero volume ever matters.
    const volumeless = run.refusals.filter((r) => r.detail.includes("9.5"));
    expect(volumeless.length).toBeGreaterThanOrEqual(1);
  });

  it("keeps a 3.5L bag-in-box at its real size, never zero", () => {
    const run = parseIowa(fixture(), FETCHED);
    const bib = run.sightings.find((s) => s.externalIds.itemNo === "100015")!;
    expect(bib.sizeValue).toBe(3500);
    expect(bib.sizeUnit).toBe("ml");
    expect(bib.priceBasis).toBe("state_bottle_retail");
  });

  it("carries CC BY 4.0 attribution and the one state on every sighting", () => {
    const run = parseIowa(fixture(), FETCHED);
    expect(run.sightings.every((s) => (s.attribution ?? "").includes("CC BY 4.0"))).toBe(true);
    expect(run.sightings.every((s) => s.state === "US-IA")).toBe(true);
    expect(run.sightings.every((s) => s.sourceClass === "retail_reference")).toBe(true);
  });

  it("refuses a changed shape rather than parsing it wrong", () => {
    expect(() => parseIowa([], FETCHED)).toThrow(IowaShapeError);
    expect(() => parseIowa([{ item_no: 1 } as IowaRow], FETCHED)).toThrow(
      IowaShapeError,
    );
  });
});
