import { readFileSync } from "fs";
import { join } from "path";
import { OregonRow, OregonShapeError, parseOregon } from "./parse-oregon";

/**
 * Oregon OLCC Monthly Pricing, against a fixture of 12 REAL rows — the cleanest
 * file measured (0 refusals). Mirrors the Python self-test.
 */
function fixture(): OregonRow[] {
  const path = join(
    __dirname,
    "__fixtures__",
    "oregon-olcc-pricing-2026-09-01.sample.json",
  );
  return JSON.parse(readFileSync(path, "utf-8")) as OregonRow[];
}

const FETCHED = "1970-01-01T00:00:00Z";

describe("parseOregon", () => {
  it("admits all 12 rows, dated by asofdate", () => {
    const run = parseOregon(fixture(), FETCHED);
    expect(run.rowsRead).toBe(12);
    expect(run.issuedAt).toBe("2026-09-01");
    expect(run.sightings).toHaveLength(12);
    expect(run.refusals).toHaveLength(0);
  });

  it("parses a 1.75 L size to 1750 ml", () => {
    const run = parseOregon(fixture(), FETCHED);
    const crow = run.sightings.find((s) => s.externalIds.itemcode === "0152H");
    expect(crow?.sizeValue).toBe(1750);
    expect(crow?.sizeUnit).toBe("ml");
  });

  it("names the OLCC shelf-price basis and records no licence", () => {
    const run = parseOregon(fixture(), FETCHED);
    expect(run.sightings[0].priceBasis).toContain("OLCC posted shelf price");
    expect(run.sightings.every((s) => s.attribution === null)).toBe(true);
    expect(run.sightings.every((s) => s.state === "US-OR")).toBe(true);
  });

  it("refuses a changed shape", () => {
    expect(() => parseOregon([], FETCHED)).toThrow(OregonShapeError);
    expect(() => parseOregon([{ itemcode: "x" } as OregonRow], FETCHED)).toThrow(
      OregonShapeError,
    );
  });
});
